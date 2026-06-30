import { z } from 'zod';
import type { Container } from '../../platform/container.js';
import type {
  BlastResponse,
  BlastRadius,
  DownstreamImpact,
  BlastCaller,
} from '@devdigest/shared';
import { buildBlastSummaryMessages } from '@devdigest/reviewer-core';
import type { BlastSummaryPromptInput } from '@devdigest/reviewer-core';
import { NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { BlastRepository } from './repository.js';

/**
 * Blast-radius service (L04) — orchestration only.
 *
 * Assembles `GET /pulls/:id/blast`: the deterministic impact MAP (read from the
 * repo-intel index) plus the index `status` for the badge, and a one-paragraph
 * prose summary (cheap LLM, cached + best-effort).
 *
 * Onion boundaries (all enforced here):
 *  - repo-intel reached ONLY via `container.repoIntel.*` (never its internals).
 *  - PR meta + changed files ONLY via `container.reviewRepo.*` (no own PR query).
 *  - the LLM ONLY via `resolveFeatureModel` → `container.llm(provider)`.
 *  - the only DB access (the summary cache) lives in `BlastRepository`.
 *
 * Best-effort discipline (server AGENTS.md): a missing/partial/degraded index or
 * an LLM/key failure NEVER throws past the facade reads — the map degrades to a
 * valid empty `BlastRadius` and the prose to a deterministic one-liner, so the
 * card always renders. The only throw is the workspace-scope 404 guard.
 */

/** Local schema for the structured prose call (NOT in shared — server-only). */
const BlastSummary = z.object({ summary: z.string() });

/**
 * Per-symbol caller cap, applied AFTER our own per-`viaSymbol` grouping. The
 * facade's `MAX_CALLERS_PER_SYMBOL` is a GLOBAL slice across a single flat
 * rank-sorted array (see repo-intel constants / service.ts), so it does NOT
 * bound any individual symbol — re-cap per group here. Declared LOCALLY: do not
 * import the repo-intel constant across the facade boundary.
 */
const MAX_CALLERS_PER_SYMBOL = 20;

const EMPTY_FACTS = { endpoints: [] as string[], crons: [] as string[] };

export class BlastService {
  private readonly repo: BlastRepository;

  constructor(private container: Container) {
    // Module-private cache repository, instantiated over the injected db once at
    // construction (mirrors agents/skills/reviews/... services). The summary
    // cache is the ONLY DB access in this module and stays inside BlastRepository.
    this.repo = new BlastRepository(container.db);
  }

  async getBlast(workspaceId: string, prId: string): Promise<BlastResponse> {
    // 1. PR meta + changed files via the shared facade. getPull is
    //    workspace-scoped, so an unknown/other-tenant id yields no row → 404
    //    (prevents cross-tenant IDOR). No own Drizzle query for PR data.
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const files = await this.container.reviewRepo.getPrFiles(prId);
    const changedFiles = files.map((f) => f.path);

    // 2. Best-effort index reads via the repo-intel facade ONLY. Any failure
    //    (not indexed, degraded, throwing) → valid empty map + 'failed' status,
    //    NEVER throws past here.
    let status: BlastResponse['status'] = 'failed';
    let degradedReason: string | null = null;
    let radius: BlastRadius;
    try {
      const state = await this.container.repoIntel.getIndexState(pull.repoId);
      status = state.status;
      degradedReason = state.degradedReason ?? null;
      const result = await this.container.repoIntel.getBlastRadius(
        pull.repoId,
        changedFiles,
      );
      radius = reshape(result);
    } catch {
      radius = { changed_symbols: [], downstream: [], summary: '' };
    }

    // 3. Resolve the summary: cache hit, else cheap LLM, else deterministic
    //    fallback. Never throws, never blocks the map on the LLM.
    radius.summary = await this.resolveSummary(workspaceId, prId, pull.headSha, pull.title, radius);

    return {
      pr_id: prId,
      blast: radius,
      status,
      degraded_reason: degradedReason,
    };
  }

  /** Cache → LLM → deterministic fallback for the one-paragraph summary. */
  private async resolveSummary(
    workspaceId: string,
    prId: string,
    headSha: string,
    prTitle: string,
    radius: BlastRadius,
  ): Promise<string> {
    const cached = await this.repo.getSummary(prId, headSha).catch(() => undefined);
    if (cached !== undefined) return cached;

    const fallback = deterministicSummary(radius);

    try {
      const input = toPromptInput(prTitle, radius);
      const { provider, model } = await resolveFeatureModel(
        this.container,
        workspaceId,
        'blast_summary',
      );
      const llm = await this.container.llm(provider);
      const res = await llm.completeStructured<{ summary: string }>({
        model,
        schema: BlastSummary,
        schemaName: 'BlastSummary',
        messages: buildBlastSummaryMessages(input),
      });
      const summary = res.data.summary?.trim() ? res.data.summary : fallback;
      await this.repo.upsertSummary(prId, headSha, summary).catch(() => {});
      return summary;
    } catch {
      // LLM/key failure: render the map with the deterministic one-liner.
      return fallback;
    }
  }
}

// ---------------------------------------------------------------------------
// Pure reshaping helpers (flat facade BlastResult → nested BlastRadius).
// ---------------------------------------------------------------------------

/** The subset of the facade `BlastResult` this service consumes. */
interface FlatBlastResult {
  changedSymbols: { file: string; name: string; kind: string }[];
  callers: { file: string; symbol: string; viaSymbol: string; line: number; rank: number }[];
  impactedEndpoints: string[];
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
}

/**
 * Reshape the flat, GLOBALLY-capped facade result into the nested `BlastRadius`:
 *  - `changedSymbols → changed_symbols` (shapes already match);
 *  - group flat `callers[]` by `viaSymbol` into `DownstreamImpact[]`;
 *  - within each group map `{file,symbol,line} → {name:symbol,file,line}` and
 *    apply OUR OWN per-symbol cap (the facade cap is global — S4);
 *  - union `factsByFile[callerFile]` over the group's caller files for the
 *    `endpoints_affected`/`crons_affected` (absent factsByFile ⇒ empty arrays).
 */
function reshape(result: FlatBlastResult): BlastRadius {
  const changed_symbols = result.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));

  // Group callers by the changed symbol they reach, preserving first-seen order.
  const groups = new Map<string, FlatBlastResult['callers']>();
  for (const c of result.callers) {
    const list = groups.get(c.viaSymbol) ?? [];
    list.push(c);
    groups.set(c.viaSymbol, list);
  }

  const downstream: DownstreamImpact[] = [];
  for (const [symbol, callerRows] of groups) {
    // OUR per-symbol cap, applied AFTER grouping (facade cap is global).
    const capped = callerRows.slice(0, MAX_CALLERS_PER_SYMBOL);
    const callers: BlastCaller[] = capped.map((c) => ({
      name: c.symbol,
      file: c.file,
      line: c.line,
    }));

    // Union endpoints/crons across the (capped) callers' files.
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const c of capped) {
      const facts = result.factsByFile?.[c.file] ?? EMPTY_FACTS;
      for (const e of facts.endpoints) endpoints.add(e);
      for (const cr of facts.crons) crons.add(cr);
    }

    downstream.push({
      symbol,
      callers,
      endpoints_affected: [...endpoints],
      crons_affected: [...crons],
    });
  }

  return { changed_symbols, downstream, summary: '' };
}

/** Build the pure prompt input (the assembled MAP as DATA — never the diff). */
function toPromptInput(prTitle: string, radius: BlastRadius): BlastSummaryPromptInput {
  return {
    prTitle,
    changedSymbols: radius.changed_symbols.map((s) => s.name),
    downstream: radius.downstream.map((d) => ({
      symbol: d.symbol,
      callerCount: d.callers.length,
      topCallerFiles: [...new Set(d.callers.map((c) => c.file))],
      endpoints: d.endpoints_affected,
      crons: d.crons_affected,
    })),
    impactedEndpoints: [
      ...new Set(radius.downstream.flatMap((d) => d.endpoints_affected)),
    ],
  };
}

/** Deterministic one-liner used on a cache miss + LLM/key failure. */
function deterministicSummary(radius: BlastRadius): string {
  const symbolCount = radius.changed_symbols.length;
  const callerTotal = radius.downstream.reduce((n, d) => n + d.callers.length, 0);
  const endpointTotal = new Set(
    radius.downstream.flatMap((d) => d.endpoints_affected),
  ).size;
  return `${symbolCount} changed symbol(s) reaching ${callerTotal} caller(s) across ${endpointTotal} endpoint(s).`;
}
