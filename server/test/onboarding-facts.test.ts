/**
 * Phase 3 (Onboarding Generator) — pure facts assembler unit tests.
 *
 * Direct instantiation over a fake `RepoIntel` facade; NO DB, NO LLM. Covers:
 *   - T4  facts built from the facade with ZERO LLM/embedding calls; reading_path
 *         files + order come from `getTopFilesByRank`/`getCriticalPaths`.
 *   - T5  ranking is `rank = pagerank` (`getFileRank.percentile`), no churn/hotness.
 *   - T11 degraded/absent index → fact-only bundle with degraded flags, never throws.
 */

import { describe, it, expect, vi } from 'vitest';
import { assembleFacts } from '../src/modules/onboarding-generator/facts.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const REPO = 'repo-uuid-1';
const NOW = new Date('2026-07-05T10:00:00.000Z');

/** A healthy facade: a repo map, top files, chains, ranks, a `full` index. */
function healthyFacade(over: Partial<Record<keyof RepoIntel, unknown>> = {}) {
  const facade = {
    getIndexState: vi.fn().mockResolvedValue({
      repoId: REPO,
      status: 'full',
      filesIndexed: 42,
      filesSkipped: 0,
      durationMs: 10,
      lastIndexedSha: 'sha',
      indexerVersion: 1,
      updatedAt: NOW,
    }),
    getRepoMap: vi.fn().mockResolvedValue({ text: 'src/\n  app.ts', tokens: 12, cached: true }),
    getTopFilesByRank: vi
      .fn()
      .mockResolvedValue(['src/app.ts', 'src/router.ts', 'src/db.ts']),
    getCriticalPaths: vi
      .fn()
      .mockResolvedValue([['src/app.ts', 'src/router.ts']]),
    getFileRank: vi.fn().mockResolvedValue([
      // Deliberately OUT of the getTopFilesByRank order — the assembler must
      // re-key by path and PRESERVE the facade's authoritative order.
      { path: 'src/db.ts', percentile: 70 },
      { path: 'src/app.ts', percentile: 99 },
      { path: 'src/router.ts', percentile: 88 },
    ]),
    ...over,
  } as unknown as RepoIntel;
  return facade;
}

describe('assembleFacts — zero LLM, facade-authoritative reading path (T4)', () => {
  it('builds the bundle with NO embedding/LLM path — only the 5 read methods', async () => {
    const facade = healthyFacade();
    const facts = await assembleFacts(facade, REPO);

    // Only the read facade methods are touched — there is no llm/embed on the
    // facade at all, so "zero LLM" is structural. Assert the reads happened.
    expect(facade.getIndexState).toHaveBeenCalledOnce();
    expect(facade.getRepoMap).toHaveBeenCalledOnce();
    expect(facade.getTopFilesByRank).toHaveBeenCalledOnce();
    expect(facade.getCriticalPaths).toHaveBeenCalledOnce();
    expect(facts.repoSkeleton).toBe('src/\n  app.ts');
  });

  it('getRepoMap is called with NO token-budget arg (pipeline default applies)', async () => {
    const facade = healthyFacade();
    await assembleFacts(facade, REPO);
    expect(facade.getRepoMap).toHaveBeenCalledWith(REPO);
  });

  it('reading_path files + order come from getTopFilesByRank (not getFileRank order)', async () => {
    const facts = await assembleFacts(healthyFacade(), REPO);
    expect(facts.rankedFiles.map((f) => f.path)).toEqual([
      'src/app.ts',
      'src/router.ts',
      'src/db.ts',
    ]);
  });

  it('carries the critical-path dependency chains verbatim (AC-3 order fuel)', async () => {
    const facts = await assembleFacts(healthyFacade(), REPO);
    expect(facts.criticalPaths).toEqual([['src/app.ts', 'src/router.ts']]);
  });
});

describe('assembleFacts — ranking is pagerank percentile (T5, AC-4)', () => {
  it('pairs each top file with its getFileRank percentile (no churn/hotness field)', async () => {
    const facts = await assembleFacts(healthyFacade(), REPO);
    expect(facts.rankedFiles).toEqual([
      { path: 'src/app.ts', percentile: 99 },
      { path: 'src/router.ts', percentile: 88 },
      { path: 'src/db.ts', percentile: 70 },
    ]);
    // The RankedFile shape carries ONLY path + percentile — no churn/hotness key.
    for (const f of facts.rankedFiles) {
      expect(Object.keys(f).sort()).toEqual(['path', 'percentile']);
    }
  });

  it('a file missing from getFileRank falls back to percentile 0 (no invention)', async () => {
    const facade = healthyFacade({
      getFileRank: vi.fn().mockResolvedValue([{ path: 'src/app.ts', percentile: 99 }]),
    });
    const facts = await assembleFacts(facade, REPO);
    expect(facts.rankedFiles).toEqual([
      { path: 'src/app.ts', percentile: 99 },
      { path: 'src/router.ts', percentile: 0 },
      { path: 'src/db.ts', percentile: 0 },
    ]);
  });

  it('skips getFileRank entirely when there are no top files', async () => {
    const getFileRank = vi.fn().mockResolvedValue([]);
    const facade = healthyFacade({
      getTopFilesByRank: vi.fn().mockResolvedValue([]),
      getFileRank,
    });
    const facts = await assembleFacts(facade, REPO);
    expect(getFileRank).not.toHaveBeenCalled();
    expect(facts.rankedFiles).toEqual([]);
  });
});

describe('assembleFacts — degraded → fact-only bundle, never throws (T11, AC-9)', () => {
  it('empty arrays + degraded flags when the facade degrades (partial index)', async () => {
    const facade = healthyFacade({
      getIndexState: vi.fn().mockResolvedValue({
        repoId: REPO,
        status: 'partial',
        filesIndexed: 3,
        filesSkipped: 100,
        durationMs: 5,
        lastIndexedSha: 'sha',
        indexerVersion: 1,
        updatedAt: NOW,
        degraded: true,
        degradedReason: 'index_partial',
      }),
      getRepoMap: vi.fn().mockResolvedValue({ text: '', tokens: 0, cached: false, degraded: true }),
      getTopFilesByRank: vi.fn().mockResolvedValue([]),
      getCriticalPaths: vi.fn().mockResolvedValue([]),
      getFileRank: vi.fn().mockResolvedValue([]),
    });

    const facts = await assembleFacts(facade, REPO);

    expect(facts.repoSkeleton).toBe('');
    expect(facts.rankedFiles).toEqual([]);
    expect(facts.criticalPaths).toEqual([]);
    expect(facts.indexState.degraded).toBe(true);
    expect(facts.indexState.degradedReason).toBe('index_partial');
    expect(facts.indexState.filesIndexed).toBe(3);
  });

  it('treats a non-full status without an explicit flag as degraded', async () => {
    const facade = healthyFacade({
      getIndexState: vi.fn().mockResolvedValue({
        repoId: REPO,
        status: 'failed',
        filesIndexed: 0,
        filesSkipped: 0,
        durationMs: 0,
        lastIndexedSha: '',
        indexerVersion: 1,
        updatedAt: NOW,
        reason: 'index_failed',
      }),
      getRepoMap: vi.fn().mockResolvedValue({ text: '', tokens: 0, cached: false }),
      getTopFilesByRank: vi.fn().mockResolvedValue([]),
      getCriticalPaths: vi.fn().mockResolvedValue([]),
      getFileRank: vi.fn().mockResolvedValue([]),
    });
    const facts = await assembleFacts(facade, REPO);
    expect(facts.indexState.degraded).toBe(true);
    expect(facts.indexState.degradedReason).toBe('index_failed');
  });

  it('maps a Date updatedAt to an ISO string; null when absent', async () => {
    const facts = await assembleFacts(healthyFacade(), REPO);
    expect(facts.indexState.updatedAt).toBe(NOW.toISOString());

    const noUpdate = healthyFacade({
      getIndexState: vi.fn().mockResolvedValue({
        repoId: REPO,
        status: 'full',
        filesIndexed: 1,
        filesSkipped: 0,
        durationMs: 0,
        lastIndexedSha: 's',
        indexerVersion: 1,
        updatedAt: null,
      }),
    });
    const facts2 = await assembleFacts(noUpdate, REPO);
    expect(facts2.indexState.updatedAt).toBeNull();
  });
});
