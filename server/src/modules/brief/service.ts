import type { Container } from '../../platform/container.js';
import { Brief, type WhyRiskBriefRecord } from '@devdigest/shared';
import { buildBriefMessages, BRIEF_PROMPT_VERSION } from '@devdigest/reviewer-core';
import { NotFoundError } from '../../platform/errors.js';
import { renderPrompt } from '../../platform/prompts.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import type { PullRow } from '../../db/rows.js';
import { BriefRepository, type WhyRiskBriefRow } from './repository.js';
import { assembleBriefBundle } from './assembler.js';
import { groundBrief } from './grounding.js';
import { briefFreshnessKey } from './freshness.js';
import { DEFAULT_CONTENT_LANGUAGE, BRIEF_FEATURE_MODEL_ID } from './constants.js';

/**
 * brief service — the Why+Risk Brief producer + cached read.
 *
 * House pattern: "code collects the facts, the model writes the narrative."
 *  - `getBrief` reads the stored row, recomputes the CURRENT freshness key with
 *    NO network → `is_stale`, and returns the record (or null). ZERO LLM /
 *    embedding calls on read (AC-8, AC-14, AC-19).
 *  - `generate` runs UNDER a per-PR single-flight (CP-2, AC-11), asserts the PR
 *    workspace-scoped BEFORE coalescing (AC-16), assembles the bundle (AC-1),
 *    renders the prompt (Phase 2), makes EXACTLY ONE `completeStructured<Brief>`
 *    call (CP-3, AC-19), grounds the paths (AC-4/5), stamps the freshness key,
 *    and idempotent-upserts (CP-7, AC-1/AC-11). On LLM failure / invalid-after-
 *    retries it does NOT persist — the prior brief is left intact and the error
 *    surfaces (AC-13). It never triggers a review (AC-9, spec Non-goal).
 *
 * Onion: orchestration only. External systems are reached via the container —
 * the DB via `BriefRepository` / the shared `reviewRepo` facade, blast/smart-
 * diff/GitHub/specs via the assembler's facade reads, the model via
 * `container.llm(provider)`. No Drizzle, no SDK client here.
 *
 * SECURITY: the assembled digests (intent prose, blast map, smart-diff stats,
 * linked issue, spec bodies) are repo-derived UNTRUSTED data — `buildBriefMessages`
 * frames them inside the prompt's `<untrusted>` blocks + appends the injection
 * guard (AC-21). Only token counts are ever logged, never the payload.
 */
export class BriefService {
  private readonly repo: BriefRepository;

  /**
   * Per-PR single-flight map (CP-2, AC-11). The service is a container singleton,
   * so this is process-global — correct for the single-process app. Keyed by
   * `prId` (not repoId). Generation is idempotent-overwrite, so no trailing
   * re-run is needed.
   */
  private readonly generating = new Map<string, Promise<WhyRiskBriefRecord>>();

  constructor(private container: Container) {
    this.repo = new BriefRepository(container.db);
  }

  /**
   * Read the stored brief for a PR + derive `is_stale`, or `null` when none is
   * stored (AC-8). ZERO LLM / embedding calls (AC-19): staleness is recomputed
   * from the `pull` row + resolved model + prompt version + stored intent key
   * with NO network (AC-14). Workspace-scoped: a foreign/absent PR 404s (AC-16).
   */
  async getBrief(workspaceId: string, prId: string): Promise<WhyRiskBriefRecord | null> {
    const pull = await this.assertPull(workspaceId, prId);

    const stored = await this.repo.getByPr(prId);
    if (!stored) return null;

    const currentKey = await this.computeFreshnessKey(workspaceId, pull);
    return toRecord(prId, stored, isStale(stored.freshnessKey, currentKey));
  }

  /**
   * Generate (or regenerate) the brief for a PR under a per-PR single-flight.
   * The PR is resolved workspace-scoped (AC-16) BEFORE coalescing — a foreign
   * caller must 404 and must NOT coalesce onto another tenant's in-flight
   * promise (server INSIGHTS 2026-07-05). A concurrent call for the SAME PR
   * returns the in-flight promise instead of starting a second LLM call (AC-11).
   */
  async generate(workspaceId: string, prId: string): Promise<WhyRiskBriefRecord> {
    const pull = await this.assertPull(workspaceId, prId);
    return this.runExclusive(prId, () => this.runGeneration(workspaceId, pull));
  }

  // ---- generation body ----------------------------------------------------

  /**
   * The single-flight-wrapped generation body: assemble the bundle (0 LLM),
   * render the prompt, ONE `completeStructured<Brief>` call, ground the paths,
   * stamp the freshness key, upsert, then shape the record. On any failure the
   * caller's promise rejects and NOTHING is persisted (AC-13) — the prior brief
   * is untouched.
   */
  private async runGeneration(
    workspaceId: string,
    pull: PullRow,
  ): Promise<WhyRiskBriefRecord> {
    // 1. Assemble the already-computed artifacts (0 LLM, best-effort — AC-1/12).
    const bundle = await assembleBriefBundle(this.container, workspaceId, pull);

    // 2. Render the system prompt TEXT (Phase 2 template) + resolve the model.
    const system = await renderPrompt('why-risk-brief.system.md', {
      language: DEFAULT_CONTENT_LANGUAGE,
    });
    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      BRIEF_FEATURE_MODEL_ID,
    );
    const llm = await this.container.llm(provider);

    // 3. EXACTLY ONE structured LLM call over the bundle (CP-3, AC-19). The
    //    message builder wraps every digest as UNTRUSTED data + appends the
    //    injection guard (AC-21). On failure / invalid-after-retries it THROWS →
    //    no persist below, prior brief intact, error surfaces (AC-13).
    const res = await llm.completeStructured<Brief>({
      model,
      schema: Brief,
      schemaName: 'Brief',
      messages: buildBriefMessages({ system, bundle }),
    });

    // 4. Real-path grounding BEFORE persist (AC-4/5): drop invented file_refs /
    //    review_focus paths against the SAME real-path set the assembler built.
    const grounded = groundBrief(res.data, bundle);

    // 5. Stamp the freshness key (same parts/order the read recomputes — CP-6)
    //    and idempotent-upsert (CP-7, AC-11).
    const key = await this.computeFreshnessKey(workspaceId, pull, provider, model);
    const stored = await this.repo.upsert(pull.id, workspaceId, grounded, key);

    // A freshly-written brief is never stale (its key IS the current key).
    return toRecord(pull.id, stored, false);
  }

  /**
   * Serialize generation per PR (CP-2, AC-11). Concurrent callers for the same
   * PR get the in-flight promise; the entry is cleared when it settles.
   */
  private runExclusive(
    prId: string,
    run: () => Promise<WhyRiskBriefRecord>,
  ): Promise<WhyRiskBriefRecord> {
    const active = this.generating.get(prId);
    if (active) return active;
    const p = (async () => {
      try {
        return await run();
      } finally {
        this.generating.delete(prId);
      }
    })();
    this.generating.set(prId, p);
    return p;
  }

  /**
   * Recompute the CURRENT freshness key with NO network (CP-6, AC-14). Reads
   * the PR row (given), the resolved provider+model (a cheap settings read when
   * not supplied), the `BRIEF_PROMPT_VERSION`, and the stored intent's key.
   */
  private async computeFreshnessKey(
    workspaceId: string,
    pull: PullRow,
    provider?: string,
    model?: string,
  ): Promise<string> {
    let p = provider;
    let m = model;
    if (p === undefined || m === undefined) {
      const resolved = await resolveFeatureModel(
        this.container,
        workspaceId,
        BRIEF_FEATURE_MODEL_ID,
      );
      p = resolved.provider;
      m = resolved.model;
    }
    const storedIntent = await this.container.reviewRepo.getIntent(pull.id);
    return briefFreshnessKey({
      headSha: pull.headSha,
      base: pull.base,
      title: pull.title,
      body: pull.body ?? '',
      provider: p,
      model: m,
      promptVersion: BRIEF_PROMPT_VERSION,
      intentKey: storedIntent?.freshnessKey ?? '',
    });
  }

  /**
   * Resolve a workspace-scoped PR or throw 404 — the AC-16 tenancy guard: a PR
   * in another workspace is invisible here. Returns the row so the caller reuses
   * it (avoids a second lookup).
   */
  private async assertPull(workspaceId: string, prId: string): Promise<PullRow> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for direct unit testing).
// ---------------------------------------------------------------------------

/**
 * `is_stale := storedKey != null && storedKey !== currentKey` (AC-14). A NULL
 * stored key (legacy / pre-migration rows) is treated as NOT stale.
 */
export function isStale(storedKey: string | null, currentKey: string): boolean {
  return storedKey != null && storedKey !== currentKey;
}

/** Shape a stored row + staleness into the `WhyRiskBriefRecord` read shape. */
function toRecord(
  prId: string,
  stored: WhyRiskBriefRow,
  is_stale: boolean,
): WhyRiskBriefRecord {
  return {
    ...stored.json,
    pr_id: prId,
    generated_at: stored.generatedAt.toISOString(),
    is_stale,
  };
}
