import { Octokit } from 'octokit';
import type {
  GitHubClient,
  RepoRef,
  PrMeta,
  PrDetail,
  PrStatus,
  GitHubReviewPayload,
  CreateReviewCommentInput,
  PrReviewComment,
  OpenPrPayload,
  CommitFilesPayload,
  IssueMeta,
} from '@devdigest/shared';
import { parseLinkedIssueRef } from '../../lib/linked-issue.js';
import {
  withRetry,
  withTimeout,
  TimeoutError,
  defaultIsRetryable,
} from '../../platform/resilience.js';

// GitHub p99 is sub-second; a hung socket is a stall, not slow progress. Keep
// the per-attempt timeout short so a transient stop degrades in ~TIMEOUT, not
// ~30s, and a single fresh retry (below) covers the worst-case at ~2×TIMEOUT.
const TIMEOUT = 10_000;

function mapStatus(state: string, merged: boolean | undefined): PrStatus {
  if (merged) return 'merged';
  if (state === 'closed') return 'closed';
  return 'open';
}

/** Minimal fetch signature so this wrapper is testable with a fake `fetchImpl`. */
type FetchLike = (url: string, opts?: RequestInit) => Promise<Response>;

/**
 * A `fetch` wrapper that gives each call its own per-attempt timeout and
 * NORMALIZES a timeout-abort into our `TimeoutError`.
 *
 * Why normalize: when we DON'T already have a caller signal we inject
 * `AbortSignal.timeout(ms)`. On expiry `globalThis.fetch` rejects with a
 * DOMException whose `name` is `'TimeoutError'` per the WHATWG spec (verified on
 * Node v22/undici) — but that DOMException is NOT our `resilience.TimeoutError`
 * class and carries no `status`/`code`, so neither `defaultIsRetryable` nor the
 * adapter's `e instanceof TimeoutError` predicate would catch it → the timeout
 * would never retry (and would race the outer `withTimeout`). Rather than match
 * the runtime-specific DOMException name, we detect OUR timeout signal firing
 * (`timeout.aborted`) and re-throw our `TimeoutError`. Then the existing
 * `instanceof TimeoutError` checks (retry predicate + `describeGithubError`)
 * work uniformly, and the race with `withTimeout` is harmless (both paths → our
 * retryable `TimeoutError`). A caller-supplied signal is passed through
 * untouched (we only own the timeout we created).
 */
export function timeoutNormalizingFetch(fetchImpl: FetchLike, ms: number): FetchLike {
  return async (url, opts) => {
    const timeout = opts?.signal ? null : AbortSignal.timeout(ms);
    try {
      return await fetchImpl(url, { ...opts, signal: opts?.signal ?? timeout! });
    } catch (e) {
      if (timeout?.aborted) throw new TimeoutError(ms);
      throw e;
    }
  };
}

/**
 * GitHubClient over Octokit REST — thin. PAT auth (fine-grained).
 * Reads PR list/detail/files/commits/issue; posts reviews; opens PRs.
 */
export class OctokitGitHubClient implements GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    // octokit@4 is batteries-included: it bundles @octokit/plugin-retry and
    // @octokit/plugin-throttling, which on a transient 5xx / secondary-rate-limit
    // retry+sleep with backoff INSIDE our single `withTimeout` window — that
    // double retry (Octokit × ours) exhausts the timeout into a no-status
    // TimeoutError. So we disable BOTH built-ins and own resilience ourselves:
    //   - retry  { enabled: false } → registers no hooks (verified in installed
    //     plugin-retry@7.2.1 source: hooks attach only when state.enabled).
    //     NOTE: `{ retries: 0 }` would NOT disable it (hooks still register);
    //     `enabled: false` is the correct off switch.
    //   - throttle { enabled: false } → early `return {}` in throttling@10, so
    //     no onRateLimit/onSecondaryRateLimit handlers are needed and a
    //     rate-limit surfaces as an error we can log (not a silent sleep).
    //   - request.fetch uses `timeoutNormalizingFetch`, which injects a FRESH
    //     AbortSignal.timeout(TIMEOUT) per fetch (verified: RequestRequestOptions
    //     .fetch?: Fetch, signal?: AbortSignal — a fresh signal per call is
    //     REQUIRED; a static one would abort every call after the first timeout)
    //     AND normalizes the resulting timeout-abort into our `TimeoutError`.
    //     The native rejection is a DOMException ('TimeoutError' name per spec),
    //     NOT our class and with no status/code — so without normalization the
    //     retry predicate + describeGithubError would miss it. Normalizing makes
    //     the fetch-level timeout retryable and correctly logged, independent of
    //     the DOMException name, and harmless against the outer withTimeout race.
    this.octokit = new Octokit({
      auth: token,
      retry: { enabled: false },
      throttle: { enabled: false },
      request: {
        fetch: timeoutNormalizingFetch(globalThis.fetch, TIMEOUT),
      },
    });
  }

  /**
   * Single resilience seam for every GitHub call: a short per-attempt timeout
   * plus ONE fresh retry. With Octokit's own retry disabled there's no double
   * retry, so worst-case latency is ~2×TIMEOUT. A `TimeoutError` is treated as
   * retryable HERE ONLY (a local predicate, NOT the global `defaultIsRetryable`)
   * so the LLM/job paths keep their no-retry-on-timeout default — the retry runs
   * on a fresh connection/abort-signal and recovers transient socket stalls.
   */
  private call<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(() => withTimeout(fn(), TIMEOUT), {
      retries: 1,
      isRetryable: (e) => e instanceof TimeoutError || defaultIsRetryable(e),
    });
  }

  async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
    return this.call(async () => {
      // Fetch open + recently merged/closed (most-recently-updated first) so
      // the list shows which PRs are merged vs still open — not just open.
      const res = await this.octokit.rest.pulls.list({
        owner: repo.owner,
        repo: repo.name,
        state: 'all',
        sort: 'updated',
        direction: 'desc',
        per_page: 50,
      });
      return res.data.map((pr) => ({
        number: pr.number,
        title: pr.title,
        author: pr.user?.login ?? 'unknown',
        branch: pr.head.ref,
        base: pr.base.ref,
        head_sha: pr.head.sha,
        additions: 0,
        deletions: 0,
        files_count: 0, // not present on the list payload; populated by getPullRequest
        status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
        opened_at: pr.created_at,
        updated_at: pr.updated_at,
      }));
    });
  }

  async getPullRequest(repo: RepoRef, n: number): Promise<PrDetail> {
    return this.call(async () => {
      const { data: pr } = await this.octokit.rest.pulls.get({
        owner: repo.owner,
        repo: repo.name,
        pull_number: n,
      });
      const { data: files } = await this.octokit.rest.pulls.listFiles({
        owner: repo.owner,
        repo: repo.name,
        pull_number: n,
        per_page: 100,
      });
      const { data: commits } = await this.octokit.rest.pulls.listCommits({
        owner: repo.owner,
        repo: repo.name,
        pull_number: n,
        per_page: 100,
      });
      const linkedIssue = await this.resolveLinkedIssue(repo, pr.body ?? '');
      return {
        number: pr.number,
        title: pr.title,
        author: pr.user?.login ?? 'unknown',
        branch: pr.head.ref,
        base: pr.base.ref,
        head_sha: pr.head.sha,
        additions: pr.additions,
        deletions: pr.deletions,
        files_count: pr.changed_files,
        status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
        opened_at: pr.created_at,
        updated_at: pr.updated_at,
        body: pr.body,
        files: files.map((f) => ({
          path: f.filename,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch,
        })),
        commits: commits.map((c) => ({
          sha: c.sha,
          message: c.commit.message,
          author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
          committed_at: c.commit.author?.date,
        })),
        linked_issue: linkedIssue,
      };
    });
  }

  /** linked issue via regex on PR body (#123 / closes #123). */
  private async resolveLinkedIssue(repo: RepoRef, body: string): Promise<IssueMeta | undefined> {
    const n = parseLinkedIssueRef(body);
    if (n == null) return undefined;
    try {
      return await this.getIssue(repo, n);
    } catch {
      return undefined;
    }
  }

  async postReview(
    repo: RepoRef,
    n: number,
    review: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    return this.call(async () => {
      const res = await this.octokit.rest.pulls.createReview({
        owner: repo.owner,
        repo: repo.name,
        pull_number: n,
        body: review.body,
        event: review.event,
        comments: review.comments?.map((c) => ({
          path: c.path,
          line: c.line,
          body: c.body,
        })),
      });
      return { id: String(res.data.id) };
    });
  }

  /** Shape an Octokit review-comment payload into our DTO. */
  private mapReviewComment(c: {
    id: number;
    path: string;
    line?: number | null;
    original_line?: number | null;
    side?: string | null;
    body: string;
    user: { login: string } | null;
    created_at: string;
    html_url: string;
    in_reply_to_id?: number;
  }): PrReviewComment {
    return {
      id: c.id,
      path: c.path,
      line: c.line ?? null,
      original_line: c.original_line ?? null,
      side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      body: c.body,
      user: c.user?.login ?? 'unknown',
      created_at: c.created_at,
      html_url: c.html_url,
      in_reply_to_id: c.in_reply_to_id ?? null,
      // GitHub drops `line` when the comment can no longer be placed on the diff.
      is_outdated: c.line == null,
    };
  }

  async listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]> {
    return this.call(async () => {
      const res = await this.octokit.rest.pulls.listReviewComments({
        owner: repo.owner,
        repo: repo.name,
        pull_number: n,
        per_page: 100,
      });
      return res.data.map((c) => this.mapReviewComment(c));
    });
  }

  async createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    return this.call(async () => {
      if (input.inReplyTo != null) {
        const res = await this.octokit.rest.pulls.createReplyForReviewComment({
          owner: repo.owner,
          repo: repo.name,
          pull_number: n,
          comment_id: input.inReplyTo,
          body: input.body,
        });
        return this.mapReviewComment(res.data);
      }
      const res = await this.octokit.rest.pulls.createReviewComment({
        owner: repo.owner,
        repo: repo.name,
        pull_number: n,
        commit_id: input.commitId,
        path: input.path,
        line: input.line,
        side: input.side ?? 'RIGHT',
        body: input.body,
      });
      return this.mapReviewComment(res.data);
    });
  }

  async openPullRequest(repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }> {
    return this.call(async () => {
      const res = await this.octokit.rest.pulls.create({
        owner: repo.owner,
        repo: repo.name,
        title: payload.title,
        head: payload.head,
        base: payload.base,
        body: payload.body,
      });
      return { url: res.data.html_url };
    });
  }

  async commitFiles(
    repo: RepoRef,
    payload: CommitFilesPayload,
  ): Promise<{ branch: string }> {
    return this.call(async () => {
      const owner = repo.owner;
      const name = repo.name;
      const g = this.octokit.rest.git;

      // Parent commit: the target branch if it already exists, else the base.
      let parentSha: string;
      let branchExists = false;
      try {
        const ref = await g.getRef({ owner, repo: name, ref: `heads/${payload.branch}` });
        parentSha = ref.data.object.sha;
        branchExists = true;
      } catch {
        const baseRef = await g.getRef({ owner, repo: name, ref: `heads/${payload.base}` });
        parentSha = baseRef.data.object.sha;
      }

      // New tree layered on the parent's tree (so unrelated files are kept).
      const parentCommit = await g.getCommit({ owner, repo: name, commit_sha: parentSha });
      const tree = await g.createTree({
        owner,
        repo: name,
        base_tree: parentCommit.data.tree.sha,
        tree: payload.files.map((f) => ({
          path: f.path,
          mode: '100644',
          type: 'blob',
          content: f.contents,
        })),
      });

      const commit = await g.createCommit({
        owner,
        repo: name,
        message: payload.message,
        tree: tree.data.sha,
        parents: [parentSha],
      });

      if (branchExists) {
        await g.updateRef({
          owner,
          repo: name,
          ref: `heads/${payload.branch}`,
          sha: commit.data.sha,
          force: true,
        });
      } else {
        await g.createRef({
          owner,
          repo: name,
          ref: `refs/heads/${payload.branch}`,
          sha: commit.data.sha,
        });
      }
      return { branch: payload.branch };
    });
  }

  async findOpenPr(repo: RepoRef, branch: string): Promise<{ url: string } | null> {
    return this.call(async () => {
      const res = await this.octokit.rest.pulls.list({
        owner: repo.owner,
        repo: repo.name,
        state: 'open',
        head: `${repo.owner}:${branch}`,
        per_page: 1,
      });
      const pr = res.data[0];
      return pr ? { url: pr.html_url } : null;
    });
  }

  async getIssue(repo: RepoRef, n: number): Promise<IssueMeta> {
    return this.call(async () => {
      const res = await this.octokit.rest.issues.get({
        owner: repo.owner,
        repo: repo.name,
        issue_number: n,
      });
      return {
        number: res.data.number,
        title: res.data.title,
        body: res.data.body,
        state: res.data.state,
      };
    });
  }

  async currentLogin(): Promise<string> {
    return this.call(async () => {
      const res = await this.octokit.rest.users.getAuthenticated();
      return res.data.login;
    });
  }
}
