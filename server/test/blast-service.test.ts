/**
 * Phase 3 (L04 Blast Radius) — BlastService unit tests.
 *
 * Fake `repoIntel` (ContainerOverrides-style), fake `LLMProvider`, fake repo +
 * db — no DB/IO. Covers: reshape (group-by-viaSymbol + per-symbol cap regression
 * against the global-cap trap), best-effort empty/degraded index (no throw),
 * cache-hit skips the LLM, LLM-failure deterministic fallback, workspace override
 * wins, and the 404 workspace-scope guard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlastService } from '../src/modules/blast/service.js';
import { BlastRepository } from '../src/modules/blast/repository.js';
import type { Container } from '../src/platform/container.js';
import type { PullRow } from '../src/db/rows.js';
import { NotFoundError } from '../src/platform/errors.js';

// ── fixtures ────────────────────────────────────────────────────────────────

const WS = 'ws-uuid-1';
const PR_ID = 'pr-uuid-1';

const FAKE_PULL: PullRow = {
  id: PR_ID,
  workspaceId: WS,
  repoId: 'repo-uuid-1',
  number: 42,
  title: 'Refactor the dispatcher',
  author: 'dev',
  branch: 'feat/x',
  base: 'main',
  headSha: 'abc123',
  lastReviewedSha: null,
  additions: 1,
  deletions: 0,
  filesCount: 1,
  status: 'needs_review',
  body: null,
  openedAt: null,
  updatedAt: null,
};

/** A flat BlastResult with callers across TWO viaSymbols + factsByFile. */
function blastResultTwoSymbols() {
  return {
    changedSymbols: [
      { file: 'src/a.ts', name: 'alpha', kind: 'function' },
      { file: 'src/b.ts', name: 'beta', kind: 'function' },
    ],
    callers: [
      { file: 'src/x.ts', symbol: 'callA1', viaSymbol: 'alpha', line: 10, rank: 5 },
      { file: 'src/y.ts', symbol: 'callA2', viaSymbol: 'alpha', line: 20, rank: 4 },
      { file: 'src/z.ts', symbol: 'callB1', viaSymbol: 'beta', line: 30, rank: 3 },
    ],
    impactedEndpoints: ['GET /things'],
    factsByFile: {
      'src/x.ts': { endpoints: ['GET /things'], crons: ['nightly'] },
      'src/y.ts': { endpoints: ['POST /things'], crons: [] },
      'src/z.ts': { endpoints: [], crons: ['hourly'] },
    },
  };
}

type Overrides = {
  pull?: PullRow | undefined;
  prFiles?: { path: string }[];
  indexState?: {
    status: string;
    degradedReason?: string;
    indexedBranch?: string;
    lastIndexedSha?: string;
  };
  blastResult?: unknown;
  getIndexStateThrows?: boolean;
  getBlastThrows?: boolean;
  overrideModel?: { provider: string; model: string };
  completeStructured?: ReturnType<typeof vi.fn>;
};

function makeContainer(o: Overrides = {}) {
  const completeStructured =
    o.completeStructured ??
    vi.fn().mockResolvedValue({
      data: { summary: 'LLM prose summary.' },
      model: 'm',
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.0001,
      raw: '{}',
      attempts: 1,
    });

  const pull = 'pull' in o ? o.pull : FAKE_PULL;
  const reviewRepo = {
    getPull: vi.fn().mockResolvedValue(pull),
    getPrFiles: vi.fn().mockResolvedValue(o.prFiles ?? [{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
  };

  const repoIntel = {
    getIndexState: o.getIndexStateThrows
      ? vi.fn().mockRejectedValue(new Error('index boom'))
      : vi.fn().mockResolvedValue(o.indexState ?? { status: 'full' }),
    getBlastRadius: o.getBlastThrows
      ? vi.fn().mockRejectedValue(new Error('blast boom'))
      : vi.fn().mockResolvedValue(o.blastResult ?? blastResultTwoSymbols()),
  };

  // Settings DB rows: empty → registry default; or an override row.
  const rows = o.overrideModel
    ? [{ key: 'feature_models', value: { blast_summary: o.overrideModel } }]
    : [];
  const db = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };

  const container = {
    db,
    reviewRepo,
    repoIntel,
    llm: vi.fn().mockResolvedValue({ completeStructured }),
  } as unknown as Container;

  return { container, reviewRepo, repoIntel, completeStructured };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── 404 workspace-scope guard ─────────────────────────────────────────────────

describe('BlastService.getBlast — workspace guard', () => {
  it('throws NotFoundError when the PR is not in the workspace', async () => {
    const { container } = makeContainer({ pull: undefined });
    vi.spyOn(BlastRepository.prototype, 'getSummary').mockResolvedValue(undefined);
    const service = new BlastService(container);
    await expect(service.getBlast(WS, PR_ID)).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ── reshape: group-by-viaSymbol + per-symbol cap ──────────────────────────────

describe('BlastService.getBlast — reshape', () => {
  beforeEach(() => {
    vi.spyOn(BlastRepository.prototype, 'getSummary').mockResolvedValue('cached');
    vi.spyOn(BlastRepository.prototype, 'upsertSummary').mockResolvedValue();
  });

  it('groups callers across 2 viaSymbols into 2 DownstreamImpact entries', async () => {
    const { container } = makeContainer();
    const res = await new BlastService(container).getBlast(WS, PR_ID);

    expect(res.blast.changed_symbols).toHaveLength(2);
    expect(res.blast.downstream).toHaveLength(2);
    const symbols = res.blast.downstream.map((d) => d.symbol).sort();
    expect(symbols).toEqual(['alpha', 'beta']);
  });

  it('maps each {file,symbol,line} → {name:symbol,file,line}', async () => {
    const { container } = makeContainer();
    const res = await new BlastService(container).getBlast(WS, PR_ID);

    const alpha = res.blast.downstream.find((d) => d.symbol === 'alpha')!;
    expect(alpha.callers).toEqual([
      { name: 'callA1', file: 'src/x.ts', line: 10 },
      { name: 'callA2', file: 'src/y.ts', line: 20 },
    ]);
  });

  it('unions factsByFile endpoints/crons over a symbol caller files', async () => {
    const { container } = makeContainer();
    const res = await new BlastService(container).getBlast(WS, PR_ID);

    const alpha = res.blast.downstream.find((d) => d.symbol === 'alpha')!;
    expect(alpha.endpoints_affected.sort()).toEqual(['GET /things', 'POST /things']);
    expect(alpha.crons_affected).toEqual(['nightly']);

    const beta = res.blast.downstream.find((d) => d.symbol === 'beta')!;
    expect(beta.endpoints_affected).toEqual([]);
    expect(beta.crons_affected).toEqual(['hourly']);
  });

  it('treats absent factsByFile as empty endpoints/crons', async () => {
    const result = blastResultTwoSymbols();
    delete (result as { factsByFile?: unknown }).factsByFile;
    const { container } = makeContainer({ blastResult: result });
    const res = await new BlastService(container).getBlast(WS, PR_ID);

    for (const d of res.blast.downstream) {
      expect(d.endpoints_affected).toEqual([]);
      expect(d.crons_affected).toEqual([]);
    }
  });

  it('REGRESSION (global-cap trap): caps callers at 20 PER symbol, not globally', async () => {
    // 30 callers via "alpha" + 30 via "beta" (60 total). A global cap of 20 would
    // leave the second symbol empty; per-symbol must keep 20 in EACH group.
    const callers = [
      ...Array.from({ length: 30 }, (_, i) => ({
        file: `src/a${i}.ts`,
        symbol: `ca${i}`,
        viaSymbol: 'alpha',
        line: i + 1,
        rank: 100 - i,
      })),
      ...Array.from({ length: 30 }, (_, i) => ({
        file: `src/b${i}.ts`,
        symbol: `cb${i}`,
        viaSymbol: 'beta',
        line: i + 1,
        rank: 50 - i,
      })),
    ];
    const result = { ...blastResultTwoSymbols(), callers };
    const { container } = makeContainer({ blastResult: result });
    const res = await new BlastService(container).getBlast(WS, PR_ID);

    const alpha = res.blast.downstream.find((d) => d.symbol === 'alpha')!;
    const beta = res.blast.downstream.find((d) => d.symbol === 'beta')!;
    expect(alpha.callers).toHaveLength(20);
    expect(beta.callers).toHaveLength(20);
  });
});

// ── best-effort: empty/degraded index never throws ────────────────────────────

describe('BlastService.getBlast — best-effort index', () => {
  beforeEach(() => {
    vi.spyOn(BlastRepository.prototype, 'getSummary').mockResolvedValue('cached');
    vi.spyOn(BlastRepository.prototype, 'upsertSummary').mockResolvedValue();
  });

  it('returns a valid empty BlastRadius + observed status when degraded', async () => {
    const { container } = makeContainer({
      indexState: { status: 'degraded', degradedReason: 'index_partial' },
      blastResult: { changedSymbols: [], callers: [], impactedEndpoints: [] },
    });
    const res = await new BlastService(container).getBlast(WS, PR_ID);

    expect(res.status).toBe('degraded');
    expect(res.degraded_reason).toBe('index_partial');
    expect(res.blast.changed_symbols).toEqual([]);
    expect(res.blast.downstream).toEqual([]);
  });

  it('never throws when getBlastRadius throws → empty map (status = already-observed)', async () => {
    // getIndexState succeeded (full) but the per-PR blast query throws. The map
    // degrades to empty without throwing; the already-observed index status is
    // kept (the plan allows the observed status OR 'failed' on a partial failure).
    const { container } = makeContainer({ getBlastThrows: true });
    const res = await new BlastService(container).getBlast(WS, PR_ID);

    expect(res.status).toBe('full');
    expect(res.blast.changed_symbols).toEqual([]);
    expect(res.blast.downstream).toEqual([]);
    // The summary still renders (deterministic fallback over the empty map).
    expect(typeof res.blast.summary).toBe('string');
  });

  it('never throws when getIndexState throws → failed status', async () => {
    const { container } = makeContainer({ getIndexStateThrows: true });
    const res = await new BlastService(container).getBlast(WS, PR_ID);
    expect(res.status).toBe('failed');
  });
});

// ── summary: cache / LLM / fallback ───────────────────────────────────────────

describe('BlastService.getBlast — summary resolution', () => {
  it('cache HIT returns the cached summary and skips the LLM', async () => {
    vi.spyOn(BlastRepository.prototype, 'getSummary').mockResolvedValue('CACHED PROSE');
    const upsert = vi.spyOn(BlastRepository.prototype, 'upsertSummary').mockResolvedValue();
    const { container, completeStructured } = makeContainer();

    const res = await new BlastService(container).getBlast(WS, PR_ID);

    expect(res.blast.summary).toBe('CACHED PROSE');
    expect(completeStructured).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('cache MISS calls the LLM once and upserts the result', async () => {
    vi.spyOn(BlastRepository.prototype, 'getSummary').mockResolvedValue(undefined);
    const upsert = vi.spyOn(BlastRepository.prototype, 'upsertSummary').mockResolvedValue();
    const { container, completeStructured } = makeContainer();

    const res = await new BlastService(container).getBlast(WS, PR_ID);

    expect(completeStructured).toHaveBeenCalledOnce();
    expect(completeStructured.mock.calls[0]![0].schemaName).toBe('BlastSummary');
    expect(res.blast.summary).toBe('LLM prose summary.');
    expect(upsert).toHaveBeenCalledOnce();
    const [prId, headSha, summary] = upsert.mock.calls[0]!;
    expect(prId).toBe(PR_ID);
    expect(headSha).toBe(FAKE_PULL.headSha);
    expect(summary).toBe('LLM prose summary.');
  });

  it('LLM failure yields a deterministic fallback and still renders the map', async () => {
    vi.spyOn(BlastRepository.prototype, 'getSummary').mockResolvedValue(undefined);
    vi.spyOn(BlastRepository.prototype, 'upsertSummary').mockResolvedValue();
    const completeStructured = vi.fn().mockRejectedValue(new Error('No API key'));
    const { container } = makeContainer({ completeStructured });

    const res = await new BlastService(container).getBlast(WS, PR_ID);

    // 2 changed symbols, 3 callers, 2 distinct endpoints (GET/POST /things).
    expect(res.blast.summary).toBe(
      '2 changed symbol(s) reaching 3 caller(s) across 2 endpoint(s).',
    );
    expect(res.blast.downstream).toHaveLength(2);
  });

  it('does NOT call the LLM input with the raw diff (input is the map only)', async () => {
    vi.spyOn(BlastRepository.prototype, 'getSummary').mockResolvedValue(undefined);
    vi.spyOn(BlastRepository.prototype, 'upsertSummary').mockResolvedValue();
    const { container, completeStructured } = makeContainer();

    await new BlastService(container).getBlast(WS, PR_ID);

    const messages = completeStructured.mock.calls[0]![0].messages as {
      role: string;
      content: string;
    }[];
    const user = messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('blast-map');
    expect(user).toContain('alpha');
  });
});

// ── feature-model override ─────────────────────────────────────────────────────

describe('BlastService.getBlast — feature model resolution', () => {
  beforeEach(() => {
    vi.spyOn(BlastRepository.prototype, 'getSummary').mockResolvedValue(undefined);
    vi.spyOn(BlastRepository.prototype, 'upsertSummary').mockResolvedValue();
  });

  it('uses the registry default (openrouter) when no override exists', async () => {
    const { container } = makeContainer();
    await new BlastService(container).getBlast(WS, PR_ID);
    expect(container.llm).toHaveBeenCalledWith('openrouter');
  });

  it('a blast_summary workspace override wins over the default', async () => {
    const { container } = makeContainer({
      overrideModel: { provider: 'anthropic', model: 'claude-3-7-sonnet' },
    });
    await new BlastService(container).getBlast(WS, PR_ID);
    expect(container.llm).toHaveBeenCalledWith('anthropic');
  });
});

// ── provenance + freshness (Phase 3, TD-003) ──────────────────────────────────

describe('BlastService.getBlast — provenance + freshness', () => {
  beforeEach(() => {
    vi.spyOn(BlastRepository.prototype, 'getSummary').mockResolvedValue('cached');
    vi.spyOn(BlastRepository.prototype, 'upsertSummary').mockResolvedValue();
  });

  it('passes indexed_branch/indexed_sha through from the read index state', async () => {
    // Non-empty map (blastResultTwoSymbols) targeting the indexed branch → not stale.
    const { container } = makeContainer({
      indexState: { status: 'full', indexedBranch: 'main', lastIndexedSha: 'idx-sha-1' },
    });
    const res = await new BlastService(container).getBlast(WS, PR_ID);

    expect(res.indexed_branch).toBe('main');
    expect(res.indexed_sha).toBe('idx-sha-1');
    // base === indexedBranch ('main') and the map is non-empty ⇒ not stale.
    expect(res.is_stale).toBe(false);
    expect(res.stale_reason).toBeUndefined();
  });

  it('flags empty_map when the readable index yields zero downstream callers', async () => {
    const { container } = makeContainer({
      indexState: { status: 'full', indexedBranch: 'main', lastIndexedSha: 'idx-sha-1' },
      blastResult: { changedSymbols: [], callers: [], impactedEndpoints: [] },
    });
    const res = await new BlastService(container).getBlast(WS, PR_ID);

    expect(res.blast.downstream).toEqual([]);
    expect(res.is_stale).toBe(true);
    expect(res.stale_reason).toBe('empty_map');
    // Provenance still surfaced alongside the caveat.
    expect(res.indexed_branch).toBe('main');
    expect(res.indexed_sha).toBe('idx-sha-1');
  });

  it('flags base_diverged when pull.base differs from the indexed branch (non-empty map)', async () => {
    // FAKE_PULL.base === 'main'; index built on 'develop' ⇒ the PR does not
    // target the indexed branch, and the map is non-empty ⇒ base_diverged.
    const { container } = makeContainer({
      indexState: { status: 'full', indexedBranch: 'develop', lastIndexedSha: 'idx-sha-2' },
    });
    const res = await new BlastService(container).getBlast(WS, PR_ID);

    expect(res.blast.downstream.length).toBeGreaterThan(0);
    expect(res.is_stale).toBe(true);
    expect(res.stale_reason).toBe('base_diverged');
    expect(res.indexed_branch).toBe('develop');
  });

  it('is NOT stale for a normal PR (base === indexed branch, non-empty map)', async () => {
    const { container } = makeContainer({
      indexState: { status: 'full', indexedBranch: 'main', lastIndexedSha: 'idx-sha-1' },
    });
    const res = await new BlastService(container).getBlast(WS, PR_ID);

    expect(res.blast.downstream.length).toBeGreaterThan(0);
    expect(res.is_stale).toBe(false);
    expect(res.stale_reason).toBeUndefined();
  });

  it('retains provenance + fires empty_map when getBlastRadius throws (no throw)', async () => {
    // getIndexState succeeds (provenance captured), getBlastRadius throws → the
    // catch resets the map to empty but the captured provenance survives, and
    // downstreamCount 0 ⇒ empty_map. The call must NOT throw.
    const { container } = makeContainer({
      indexState: { status: 'full', indexedBranch: 'main', lastIndexedSha: 'idx-sha-1' },
      getBlastThrows: true,
    });
    const res = await new BlastService(container).getBlast(WS, PR_ID);

    expect(res.blast.downstream).toEqual([]);
    expect(res.indexed_branch).toBe('main'); // survived the getBlastRadius throw
    expect(res.indexed_sha).toBe('idx-sha-1');
    expect(res.is_stale).toBe(true);
    expect(res.stale_reason).toBe('empty_map');
    expect(typeof res.blast.summary).toBe('string');
  });
});
