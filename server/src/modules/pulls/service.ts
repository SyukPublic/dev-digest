import type { FastifyBaseLogger } from 'fastify';
import type {
  PrMeta,
  PrDetail,
  PrReviewComment,
  PrCommentInput,
  GitHubClient,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { PullsRepository } from './repository.js';
import type { PullRow, RepoRow } from '../../db/rows.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { BACKFILL_LIMIT } from './constants.js';
import { totalCostByPr } from './cost.js';
import { findingCountsByPr } from './findings-summary.js';
import { latestScoreByPr, toPrMeta, toPrDetail } from './helpers.js';

/**
 * F1 — pulls service. Business logic for importing/reading pull requests:
 *   - list (local-first sync from GitHub + diff-stat backfill + list rollups)
 *   - detail (local-first refresh from GitHub, else persisted)
 *   - inline review comments (proxied live to GitHub)
 *
 * No HTTP and no raw SQL live here: persistence goes through `pullsRepo`,
 * cross-domain reads through `reposRepo` / `reviewRepo`, pure transforms through
 * helpers.ts. GitHub is best-effort everywhere EXCEPT where a write is requested
 * (posting a comment), so already-imported/seeded data stays viewable offline.
 */
export class PullsService {
  private pulls: PullsRepository;

  constructor(private container: Container) {
    this.pulls = container.pullsRepo;
  }

  /** Repos table is reached through the shared container facade, not a
   *  cross-module repository import (row types come from db/rows). */
  private get repos() {
    return this.container.reposRepo;
  }

  /**
   * Sync a repo's PR list from GitHub into the local store (idempotent upsert).
   * The caller supplies a resolved client and decides error policy — the list
   * endpoint swallows failures (local-first), polling surfaces them.
   * Returns the number of PRs synced.
   */
  syncFromGitHub(workspaceId: string, repo: RepoRow, gh: GitHubClient): Promise<number> {
    return gh
      .listPullRequests({ owner: repo.owner, name: repo.name })
      .then((pulls) => this.pulls.upsertImportedPulls(workspaceId, repo.id, pulls));
  }

  async listPulls(
    workspaceId: string,
    repoId: string,
    log: FastifyBaseLogger,
  ): Promise<PrMeta[]> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Local-first: sync from GitHub when a token is configured, but never fail
    // the read — already-imported/seeded PRs stay viewable offline.
    let gh: GitHubClient | null = null;
    try {
      gh = await this.container.github();
    } catch (err) {
      log.warn({ err }, 'GitHub client unavailable (no token / offline); serving persisted PRs');
    }
    if (gh) {
      try {
        await this.syncFromGitHub(workspaceId, repo, gh);
      } catch (err) {
        log.warn({ err }, 'GitHub PR sync skipped (no token / offline); serving persisted PRs');
      }
    }

    const rows = await this.pulls.listByRepo(repo.id);
    if (gh) await this.backfillStats(repo, rows, gh, log);

    const prIds = rows.map((r) => r.id);
    const [scoreRows, costRows, sevRows] = await Promise.all([
      this.container.reviewRepo.latestReviewScores(prIds),
      this.container.reviewRepo.runCostRows(prIds),
      this.container.reviewRepo.findingSeverityRows(prIds),
    ]);
    const scoreByPr = latestScoreByPr(scoreRows);
    const costByPr = totalCostByPr(costRows);
    const findingsByPr = findingCountsByPr(sevRows);

    const now = Date.now();
    return rows.map((r) =>
      toPrMeta(
        r,
        {
          score: scoreByPr.has(r.id) ? (scoreByPr.get(r.id) ?? null) : null,
          costUsd: costByPr.has(r.id) ? costByPr.get(r.id)! : null,
          findings: findingsByPr.get(r.id) ?? null,
        },
        now,
      ),
    );
  }

  /**
   * Backfill diff stats for freshly-imported PRs (the list payload zeroes them).
   * Capped per request; mutates `rows` in place so the rollup mapping sees the
   * fresh stats without a re-read.
   */
  private async backfillStats(
    repo: RepoRow,
    rows: PullRow[],
    gh: GitHubClient,
    log: FastifyBaseLogger,
  ): Promise<void> {
    const needStats = rows
      .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
      .slice(0, BACKFILL_LIMIT);
    for (const r of needStats) {
      try {
        const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, r.number);
        await this.pulls.updateStats(r.id, {
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        });
        r.additions = detail.additions;
        r.deletions = detail.deletions;
        r.filesCount = detail.files_count;
      } catch (err) {
        log.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
      }
    }
  }

  async getDetail(
    workspaceId: string,
    prId: string,
    log: FastifyBaseLogger,
  ): Promise<PrDetail> {
    const pr = await this.pulls.getPull(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');
    const repo = await this.repos.getById(workspaceId, pr.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Local-first: refresh detail from GitHub when a token is configured;
    // otherwise serve the persisted files/commits/body so detail works offline.
    try {
      const gh = await this.container.github();
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pr.number);
      await this.pulls.replacePrFiles(pr.id, detail.files);
      await this.pulls.replacePrCommits(pr.id, detail.commits);
      await this.pulls.updateDetail(pr.id, {
        body: detail.body ?? null,
        additions: detail.additions,
        deletions: detail.deletions,
        filesCount: detail.files_count,
      });
      return { ...detail, id: pr.id };
    } catch (err) {
      log.warn(
        { err },
        'GitHub PR detail refresh skipped (no token / offline); serving persisted detail',
      );
      const [files, commits] = await Promise.all([
        this.pulls.getPrFiles(pr.id),
        this.pulls.getPrCommits(pr.id),
      ]);
      return toPrDetail(pr, files, commits);
    }
  }

  async listComments(
    workspaceId: string,
    prId: string,
    log: FastifyBaseLogger,
  ): Promise<PrReviewComment[]> {
    const { pr, repo } = await this.resolvePrAndRepo(workspaceId, prId);
    let gh: GitHubClient;
    try {
      gh = await this.container.github();
    } catch (err) {
      log.warn({ err }, 'GitHub client unavailable; serving no PR comments');
      return [];
    }
    try {
      return await gh.listReviewComments({ owner: repo.owner, name: repo.name }, pr.number);
    } catch (err) {
      log.warn({ err }, 'GitHub review-comments fetch skipped (offline / error)');
      return [];
    }
  }

  async createComment(
    workspaceId: string,
    prId: string,
    input: PrCommentInput,
  ): Promise<PrReviewComment> {
    const { pr, repo } = await this.resolvePrAndRepo(workspaceId, prId);
    let gh: GitHubClient;
    try {
      gh = await this.container.github();
    } catch {
      throw new AppError('github_unavailable', 'Connect a GitHub token to post comments.', 400);
    }
    try {
      return await gh.createReviewComment({ owner: repo.owner, name: repo.name }, pr.number, {
        commitId: pr.headSha,
        path: input.path,
        line: input.line,
        ...(input.side ? { side: input.side } : {}),
        body: input.body,
        ...(input.in_reply_to != null ? { inReplyTo: input.in_reply_to } : {}),
      });
    } catch (err) {
      // GitHub rejects comments on lines outside the diff / on closed PRs (422).
      const msg = err instanceof Error ? err.message : 'Failed to post the comment to GitHub.';
      throw new AppError('github_comment_failed', msg, 400, { cause: String(err) });
    }
  }

  private async resolvePrAndRepo(
    workspaceId: string,
    prId: string,
  ): Promise<{ pr: PullRow; repo: RepoRow }> {
    const pr = await this.pulls.getPull(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');
    const repo = await this.repos.getById(workspaceId, pr.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return { pr, repo };
  }
}
