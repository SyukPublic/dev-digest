/**
 * Thin `fetch` wrapper over the local DevDigest API (Variant A — HTTP bridge).
 *
 * This is the MCP edge's only outbound dependency. It depends solely on the
 * published HTTP surface and `@devdigest/shared` Zod contracts — never on
 * `server/src/**` internals or Drizzle (onion: the arrow points inward to the
 * shared contracts). Every response is validated against its contract before it
 * crosses back into the tool handlers, and every failure is translated into an
 * error-that-leads-forward message (see `ApiClientError`).
 *
 * Phase 0 implements `listAgents()`. The shape is deliberately extensible
 * (`request()` helper + central error mapping) so later phases add `listRepos`,
 * `resolveRepoId`, `resolvePull`, `runReview`, `consumeRunEvents`,
 * `reviewsForPull`, `conventions`, `blast` without reworking the transport.
 */
import { z } from 'zod';
import {
  Agent,
  BlastResponse,
  ConventionCandidate,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
} from '@devdigest/shared';
import type { McpConfig } from './config.js';
import { parseSseFrames, type SseFrame } from './sse.js';

/** A user-facing, action-oriented failure. `.message` is safe to surface in a tool result. */
export class ApiClientError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ApiClientError';
  }
}

const AgentList = z.array(Agent);
const RepoList = z.array(Repo);
const PrMetaList = z.array(PrMeta);
const ReviewList = z.array(ReviewRecord);
const ConventionList = z.array(ConventionCandidate);

/** Where to direct a review run: one agent, or every enabled agent. */
export type ReviewTarget = { readonly kind: 'agent'; readonly agentId: string } | { readonly kind: 'all' };

export interface RequestOptions {
  readonly method?: string;
  /** JSON body; serialized and sent with `content-type: application/json`. */
  readonly body?: unknown;
  /** Query params; `undefined` values are dropped. */
  readonly query?: Record<string, string | number | undefined>;
}

export class ApiClient {
  constructor(private readonly config: McpConfig) {}

  /** `GET /agents` → the workspace's configured review agents. */
  async listAgents(): Promise<Agent[]> {
    const data = await this.request('/agents');
    return this.parse(AgentList, data, '/agents');
  }

  /** `GET /repos` → the workspace's imported repositories. */
  async listRepos(): Promise<Repo[]> {
    const data = await this.request('/repos');
    return this.parse(RepoList, data, '/repos');
  }

  /**
   * Resolves `owner/name` to its repo uuid. Returns null when no imported repo
   * matches (caller turns that into a forward-leading "repo not found" message).
   * Matches `full_name` first, then `owner`+`/`+`name`, case-insensitively.
   */
  async resolveRepoId(ownerName: string): Promise<string | null> {
    const target = ownerName.trim().toLowerCase();
    const repos = await this.listRepos();
    const match = repos.find(
      (r) =>
        r.full_name.toLowerCase() === target ||
        `${r.owner}/${r.name}`.toLowerCase() === target,
    );
    return match ? match.id : null;
  }

  /**
   * Resolves a PR number within a repo to its pull uuid via the Phase-1
   * `?number=` filter. Returns null when the PR isn't imported. `PrMeta.id` is
   * `nullish` in the contract, so a present-but-id-less row is unresolved.
   *
   * Robustness: we ALWAYS match by `number` rather than blindly taking `[0]`.
   * The filtered route is meant to return 0 or 1 row, but matching defensively
   * means a wrong PR number can never resolve to the wrong pull — and it stays
   * correct even if the server returns the full list for an unmatched number.
   */
  async resolvePull(repoId: string, prNumber: number): Promise<string | null> {
    const path = `/repos/${repoId}/pulls`;
    const data = await this.request(path, { query: { number: prNumber } });
    const pulls = this.parse(PrMetaList, data, path);
    const match = pulls.find((p) => p.number === prNumber);
    return match?.id ?? null;
  }

  /** `GET /pulls/:id/reviews` → persisted reviews + findings for a PR. */
  async reviewsForPull(pullId: string): Promise<ReviewRecord[]> {
    const path = `/pulls/${pullId}/reviews`;
    const data = await this.request(path);
    return this.parseLenient(ReviewList, data, path);
  }

  /** `GET /repos/:id/conventions` → extracted convention candidates. */
  async conventions(repoId: string): Promise<ConventionCandidate[]> {
    const path = `/repos/${repoId}/conventions`;
    const data = await this.request(path);
    return this.parse(ConventionList, data, path);
  }

  /** `GET /pulls/:id/blast` → deterministic impact map + index status. */
  async blast(pullId: string): Promise<BlastResponse> {
    const path = `/pulls/${pullId}/blast`;
    const data = await this.request(path);
    return this.parse(BlastResponse, data, path);
  }

  /**
   * `POST /pulls/:id/review` → starts run(s). Responds immediately with the run
   * targets and an EMPTY `reviews` array (reviews are fetched after completion).
   */
  async runReview(pullId: string, target: ReviewTarget): Promise<ReviewRunResponse> {
    const path = `/pulls/${pullId}/review`;
    const body = target.kind === 'all' ? { all: true } : { agentId: target.agentId };
    const data = await this.request(path, { method: 'POST', body });
    return this.parse(ReviewRunResponse, data, path);
  }

  /**
   * Consumes `GET /runs/:id/events` (SSE) until the run completes.
   *
   * D3: the stream has NO terminal `done` data event — the server signals
   * completion by CLOSING the response body. So we read `res.body` as a stream
   * and treat end-of-stream (reader `done`) as completion. We do NOT use the
   * global `EventSource` (it auto-reconnects on close and would hang forever).
   *
   * Returns the parsed SSE frames in order (the last is typically `result` or
   * `error`); callers fetch the persisted reviews afterwards.
   */
  async consumeRunEvents(runId: string): Promise<SseFrame[]> {
    const url = this.buildUrl(`/runs/${runId}/events`);
    let res: Response;
    try {
      res = await fetch(url, { headers: { accept: 'text/event-stream' } });
    } catch (cause) {
      throw new ApiClientError(
        `Cannot reach the DevDigest API at ${this.config.apiUrl}. Start it with ./scripts/dev.sh and retry.`,
        cause,
      );
    }
    if (!res.ok) {
      throw await this.mapHttpError(res, `/runs/${runId}/events`);
    }
    if (!res.body) {
      throw new ApiClientError(`The DevDigest API returned no event stream for run ${runId}.`);
    }

    const frames: SseFrame[] = [];
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let buffer = '';
    try {
      // End-of-stream (reader `done`) === run completion (D3).
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { frames: parsed, rest } = parseSseFrames(buffer);
        frames.push(...parsed);
        buffer = rest;
      }
      // Flush any trailing frame not terminated by a blank line before close.
      buffer += decoder.decode();
      const tail = parseSseFrames(buffer + '\n\n');
      frames.push(...tail.frames);
    } finally {
      reader.releaseLock();
    }
    return frames;
  }

  /**
   * Central request helper: builds the URL, performs the fetch, and maps every
   * network/HTTP failure to an `ApiClientError` whose message tells the caller
   * what to do next. Returns the parsed JSON body as `unknown` (validated by the
   * calling method against a `@devdigest/shared` contract).
   */
  private async request(path: string, opts: RequestOptions = {}): Promise<unknown> {
    const url = this.buildUrl(path, opts.query);

    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
    } catch (cause) {
      // Connection refused / DNS / offline — the API isn't reachable.
      throw new ApiClientError(
        `Cannot reach the DevDigest API at ${this.config.apiUrl}. Start it with ./scripts/dev.sh and retry.`,
        cause,
      );
    }

    if (!res.ok) {
      throw await this.mapHttpError(res, path);
    }

    try {
      return await res.json();
    } catch (cause) {
      throw new ApiClientError(
        `The DevDigest API returned a malformed response for ${path}.`,
        cause,
      );
    }
  }

  /** Maps a non-2xx HTTP response to an action-oriented error. */
  private async mapHttpError(res: Response, path: string): Promise<ApiClientError> {
    const detail = await this.readErrorBody(res);
    const suffix = detail ? ` (${detail})` : '';
    if (res.status === 404) {
      return new ApiClientError(`Not found: ${path}.${suffix}`);
    }
    if (res.status >= 500) {
      return new ApiClientError(
        `The DevDigest API errored on ${path} (HTTP ${res.status}).${suffix} Check the API logs and retry.`,
      );
    }
    return new ApiClientError(`Request to ${path} failed (HTTP ${res.status}).${suffix}`);
  }

  /** Best-effort extraction of an error message from a failed response body. */
  private async readErrorBody(res: Response): Promise<string | undefined> {
    try {
      const text = await res.text();
      if (!text) return undefined;
      try {
        const json: unknown = JSON.parse(text);
        if (json && typeof json === 'object' && 'message' in json) {
          const m = (json as { message?: unknown }).message;
          if (typeof m === 'string') return m;
        }
      } catch {
        // not JSON — fall through to the raw text
      }
      return text.slice(0, 200);
    } catch {
      return undefined;
    }
  }

  /** Validates a response body against its shared contract (parse, don't trust). */
  private parse<S extends z.ZodTypeAny>(schema: S, data: unknown, path: string): z.infer<S> {
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new ApiClientError(
        `The DevDigest API returned an unexpected shape for ${path}. The API and MCP server contracts may be out of sync.`,
        result.error,
      );
    }
    return result.data;
  }

  /**
   * D7: lenient boundary parse for endpoints with NO server-side response schema
   * (e.g. `GET /pulls/:id/reviews` returns the runtime `ReviewDto[]` shape). We
   * try strict validation first; on failure we DON'T throw — we log a single
   * warning to STDERR (never stdout — that's the JSON-RPC channel) and return the
   * leniently-coerced data. Robustness at the boundary over strictness.
   */
  private parseLenient<S extends z.ZodTypeAny>(schema: S, data: unknown, path: string): z.infer<S> {
    const strict = schema.safeParse(data);
    if (strict.success) return strict.data;

    // `passthrough` (top-level) won't relax nested objects, so fall back to a
    // pass-through array: keep whatever fields are present, drop nothing.
    process.stderr.write(
      `[devdigest-mcp] warn: ${path} failed strict validation; using lenient parse (${strict.error.issues.length} issue(s)).\n`,
    );
    const lenient = z.array(z.unknown()).safeParse(data);
    if (lenient.success) return lenient.data as z.infer<S>;
    // Not even an array — surface the original, actionable error.
    throw new ApiClientError(
      `The DevDigest API returned an unexpected shape for ${path}. The API and MCP server contracts may be out of sync.`,
      strict.error,
    );
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(path, `${this.config.apiUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}
