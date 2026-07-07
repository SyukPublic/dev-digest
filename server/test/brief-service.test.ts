/**
 * Phase 4 (T9, T11, T12, T14) — BriefService unit tests.
 *
 * Fake container (reviewRepo/llm/db-settings), the assembler's facades spied to
 * controlled returns, and `BriefRepository` spied for persistence. Covers:
 *   T9   generate makes EXACTLY ONE completeStructured<Brief> call + idempotent
 *        upsert (json + generated_at + freshness_key) keyed by pr_id (AC-1/19);
 *   T11  concurrent generate for the same PR coalesces to ONE in-flight call;
 *   T12  LLM failure → NO persist, error surfaced, prior brief intact (AC-13);
 *   T14  getBrief returns the stored brief + is_stale (recomputed, NO network)
 *        or null, making ZERO LLM/embedding calls (AC-8/14/19).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Brief } from '@devdigest/shared';
import { BriefService, isStale } from '../src/modules/brief/service.js';
import { BriefRepository } from '../src/modules/brief/repository.js';
import { BlastService } from '../src/modules/blast/service.js';
import { SmartDiffService } from '../src/modules/smart-diff/service.js';
import { ProjectContextService } from '../src/modules/project-context/service.js';
import { NotFoundError } from '../src/platform/errors.js';
import type { Container } from '../src/platform/container.js';
import type { PullRow } from '../src/db/rows.js';

const WS = 'ws-1';
const PR_ID = 'pr-1';

const FAKE_PULL: PullRow = {
  id: PR_ID,
  workspaceId: WS,
  repoId: 'repo-1',
  number: 7,
  title: 'Add the widget',
  author: 'dev',
  branch: 'feat/x',
  base: 'main',
  headSha: 'sha-1',
  lastReviewedSha: null,
  additions: 3,
  deletions: 1,
  filesCount: 2,
  status: 'needs_review',
  body: null,
  openedAt: null,
  updatedAt: null,
};

const MODEL_BRIEF: Brief = {
  what: 'Adds a widget',
  why: 'Users asked for it',
  risk_level: 'medium',
  risks: [
    { kind: 'perf', title: 'N+1', explanation: 'loop', severity: 'high', file_refs: ['src/a.ts:1'] },
    // An invented ref path — grounding must drop it before persist.
    { kind: 'auth', title: 'ghost', explanation: 'x', severity: 'low', file_refs: ['nowhere/z.ts:9'] },
  ],
  review_focus: [{ path: 'src/a.ts', line: 1, reason: 'entry' }],
};

/** Make a fake container: reviewRepo + llm + empty settings rows (registry default). */
function makeContainer(opts: {
  pull?: PullRow | undefined;
  completeStructured?: ReturnType<typeof vi.fn>;
  intent?: { freshnessKey: string | null } | undefined;
} = {}) {
  const completeStructured =
    opts.completeStructured ??
    vi.fn().mockResolvedValue({
      data: MODEL_BRIEF,
      model: 'm',
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.0001,
      raw: '{}',
      attempts: 1,
    });

  const pull = 'pull' in opts ? opts.pull : FAKE_PULL;
  const reviewRepo = {
    getPull: vi.fn().mockResolvedValue(pull),
    getIntent: vi.fn().mockResolvedValue(
      'intent' in opts ? opts.intent : { freshnessKey: 'ik-1' },
    ),
    getRepo: vi.fn().mockResolvedValue({ owner: 'acme', name: 'app' }),
  };
  const agentsRepo = {
    listEnabled: vi.fn().mockResolvedValue([]),
    linkedSkills: vi.fn().mockResolvedValue([]),
  };
  // Empty settings rows → registry default feature model.
  const db = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
  const container = {
    db,
    reviewRepo,
    agentsRepo,
    github: vi.fn().mockRejectedValue(new Error('no token')),
    llm: vi.fn().mockResolvedValue({ completeStructured }),
  } as unknown as Container;

  return { container, reviewRepo, completeStructured };
}

/** Spy the assembler facades so the real assembler runs but returns are controlled. */
function stubAssemblerFacades() {
  vi.spyOn(BlastService.prototype, 'getBlast').mockResolvedValue({
    pr_id: PR_ID,
    status: 'full',
    degraded_reason: null,
    indexed_branch: 'main',
    indexed_sha: 'idx',
    blast: {
      changed_symbols: [{ name: 'alpha', file: 'src/a.ts', kind: 'function' }],
      downstream: [],
      summary: 'sum',
    },
  });
  vi.spyOn(SmartDiffService.prototype, 'getSmartDiff').mockResolvedValue({
    groups: [
      // finding_lines carries line 1 so the model's `src/a.ts:1` ref intersects
      // the file's real changed-line set and survives grounding as-is (AC-22):
      // this fixture's intent is "a valid range survives", not the graceful drop.
      { role: 'core', files: [{ path: 'src/a.ts', pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [1] }] },
    ],
    split_suggestion: { too_big: false, total_lines: 1, proposed_splits: [] },
  });
  vi.spyOn(ProjectContextService.prototype, 'resolveSpecPathsForAgent').mockResolvedValue([]);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── isStale rule (AC-14) ──────────────────────────────────────────────────────

describe('isStale', () => {
  it('NULL stored key ⇒ NOT stale', () => {
    expect(isStale(null, 'any')).toBe(false);
  });
  it('stored key equal to current ⇒ not stale', () => {
    expect(isStale('k', 'k')).toBe(false);
  });
  it('stored key different from current ⇒ stale', () => {
    expect(isStale('k1', 'k2')).toBe(true);
  });
});

// ── workspace guard ────────────────────────────────────────────────────────────

describe('BriefService — workspace guard', () => {
  it('generate throws NotFoundError for a foreign/absent PR (before any LLM)', async () => {
    const { container, completeStructured } = makeContainer({ pull: undefined });
    await expect(new BriefService(container).generate(WS, PR_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(completeStructured).not.toHaveBeenCalled();
  });

  it('getBrief throws NotFoundError for a foreign/absent PR', async () => {
    const { container } = makeContainer({ pull: undefined });
    await expect(new BriefService(container).getBrief(WS, PR_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

// ── T9: one call + upsert ──────────────────────────────────────────────────────

describe('BriefService.generate — one LLM call + upsert (T9)', () => {
  it('makes EXACTLY ONE completeStructured<Brief> call and upserts a grounded brief', async () => {
    const { container, completeStructured } = makeContainer();
    stubAssemblerFacades();
    const upsert = vi
      .spyOn(BriefRepository.prototype, 'upsert')
      .mockImplementation(async (prId, _ws, json) => ({
        json: json as Brief,
        generatedAt: new Date('2026-07-05T10:00:00.000Z'),
        freshnessKey: 'fk',
      }));

    const rec = await new BriefService(container).generate(WS, PR_ID);

    expect(completeStructured).toHaveBeenCalledOnce();
    expect(completeStructured.mock.calls[0]![0].schemaName).toBe('Brief');
    expect(upsert).toHaveBeenCalledOnce();

    // The persisted brief is GROUNDED: the invented ref was dropped before store.
    const [prId, ws, storedJson, freshnessKey] = upsert.mock.calls[0]!;
    expect(prId).toBe(PR_ID);
    expect(ws).toBe(WS);
    expect((storedJson as Brief).risks[0]!.file_refs).toEqual(['src/a.ts:1']);
    expect((storedJson as Brief).risks[1]!.file_refs).toEqual([]); // invented dropped
    expect(typeof freshnessKey).toBe('string');

    // The returned record carries pr_id + generated_at + is_stale=false (fresh).
    expect(rec.pr_id).toBe(PR_ID);
    expect(rec.generated_at).toBe('2026-07-05T10:00:00.000Z');
    expect(rec.is_stale).toBe(false);
  });

  it('makes ZERO embedding calls (no embedder access)', async () => {
    const { container } = makeContainer();
    stubAssemblerFacades();
    vi.spyOn(BriefRepository.prototype, 'upsert').mockResolvedValue({
      json: MODEL_BRIEF,
      generatedAt: new Date(),
      freshnessKey: 'fk',
    });
    // container has no `embedder` mock; a call would throw → prove none happens.
    await expect(new BriefService(container).generate(WS, PR_ID)).resolves.toBeDefined();
  });
});

// ── T11: single-flight coalesce ────────────────────────────────────────────────

describe('BriefService.generate — single-flight (T11)', () => {
  it('coalesces concurrent generate for the same PR to ONE LLM call', async () => {
    // A slow LLM so both callers overlap in-flight.
    let resolveLlm!: (v: unknown) => void;
    const completeStructured = vi.fn().mockImplementation(
      () =>
        new Promise((res) => {
          resolveLlm = res;
        }),
    );
    const { container } = makeContainer({ completeStructured });
    stubAssemblerFacades();
    vi.spyOn(BriefRepository.prototype, 'upsert').mockResolvedValue({
      json: MODEL_BRIEF,
      generatedAt: new Date(),
      freshnessKey: 'fk',
    });

    const service = new BriefService(container);
    const p1 = service.generate(WS, PR_ID);
    const p2 = service.generate(WS, PR_ID);

    // Let the guards + assembly settle, then release the single LLM call.
    await new Promise((r) => setTimeout(r, 5));
    resolveLlm({ data: MODEL_BRIEF, model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0, raw: '{}', attempts: 1 });

    await Promise.all([p1, p2]);
    expect(completeStructured).toHaveBeenCalledOnce();
  });
});

// ── T12: no-persist on failure ─────────────────────────────────────────────────

describe('BriefService.generate — no persist on failure (T12)', () => {
  it('LLM failure surfaces the error and never persists (prior brief intact)', async () => {
    const completeStructured = vi.fn().mockRejectedValue(new Error('schema invalid after retries'));
    const { container } = makeContainer({ completeStructured });
    stubAssemblerFacades();
    const upsert = vi.spyOn(BriefRepository.prototype, 'upsert');

    await expect(new BriefService(container).generate(WS, PR_ID)).rejects.toThrow(
      /schema invalid/,
    );
    expect(upsert).not.toHaveBeenCalled();
  });
});

// ── T14: getBrief zero-LLM + is_stale/null ─────────────────────────────────────

describe('BriefService.getBrief — zero-LLM read (T14)', () => {
  it('returns null when nothing is stored, ZERO LLM calls', async () => {
    const { container, completeStructured } = makeContainer();
    vi.spyOn(BriefRepository.prototype, 'getByPr').mockResolvedValue(undefined);

    const rec = await new BriefService(container).getBrief(WS, PR_ID);
    expect(rec).toBeNull();
    expect(completeStructured).not.toHaveBeenCalled();
    expect(container.llm).not.toHaveBeenCalled();
  });

  it('returns the stored brief with is_stale=false when the recomputed key matches', async () => {
    const { container, completeStructured } = makeContainer();
    // Store with the SAME key the service will recompute (registry default model,
    // headSha/base/title/body from FAKE_PULL, intentKey 'ik-1').
    const { briefFreshnessKey } = await import('../src/modules/brief/freshness.js');
    const { BRIEF_PROMPT_VERSION } = await import('@devdigest/reviewer-core');
    const { defaultFeatureModel } = await import('../src/modules/settings/feature-models.js');
    const dm = defaultFeatureModel('why_risk_brief');
    const key = briefFreshnessKey({
      headSha: FAKE_PULL.headSha,
      base: FAKE_PULL.base,
      title: FAKE_PULL.title,
      body: '',
      provider: dm.provider,
      model: dm.model,
      promptVersion: BRIEF_PROMPT_VERSION,
      intentKey: 'ik-1',
    });
    vi.spyOn(BriefRepository.prototype, 'getByPr').mockResolvedValue({
      json: MODEL_BRIEF,
      generatedAt: new Date('2026-07-05T10:00:00.000Z'),
      freshnessKey: key,
    });

    const rec = await new BriefService(container).getBrief(WS, PR_ID);
    expect(rec).not.toBeNull();
    expect(rec!.is_stale).toBe(false);
    expect(rec!.what).toBe('Adds a widget');
    expect(rec!.generated_at).toBe('2026-07-05T10:00:00.000Z');
    expect(completeStructured).not.toHaveBeenCalled();
  });

  it('returns is_stale=true when the stored key differs from the recomputed one', async () => {
    const { container } = makeContainer();
    vi.spyOn(BriefRepository.prototype, 'getByPr').mockResolvedValue({
      json: MODEL_BRIEF,
      generatedAt: new Date(),
      freshnessKey: 'a-stale-key',
    });
    const rec = await new BriefService(container).getBrief(WS, PR_ID);
    expect(rec!.is_stale).toBe(true);
  });

  it('treats a NULL stored key as NOT stale (AC-14 legacy rows)', async () => {
    const { container } = makeContainer();
    vi.spyOn(BriefRepository.prototype, 'getByPr').mockResolvedValue({
      json: MODEL_BRIEF,
      generatedAt: new Date(),
      freshnessKey: null,
    });
    const rec = await new BriefService(container).getBrief(WS, PR_ID);
    expect(rec!.is_stale).toBe(false);
  });
});
