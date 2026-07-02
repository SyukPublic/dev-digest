import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';
import type {
  FullSymbolRow,
  ResolvedCallerRow,
  IndexerFileFactsRow,
} from '../src/modules/repo-intel/repository.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';

/**
 * Phase 3 regression (TD-004, docs/specs/blast-per-symbol-caller-cap.md §S5):
 * proves — at the FACADE level (`RepoIntelService.getBlastRadius` →
 * `tryPersistentBlast`) — that the caller fan-out cap `MAX_CALLERS_PER_SYMBOL`
 * is applied PER changed symbol (`viaSymbol`), not as a single global slice
 * over one flat rank-sorted array.
 *
 * Pure-mock harness copied from `blast-unresolved-index.test.ts:37-84` — no
 * Postgres, no clone. `RepoIntelService`'s private `repo` is overwritten
 * directly; all assertions are driven through the PUBLIC `getBlastRadius`.
 *
 * Why this is needed in addition to `blast-service.test.ts:197-224`: that test
 * feeds the CONSUMER's `reshape()` a hand-built flat `callers[]` array,
 * bypassing `tryPersistentBlast` entirely — so it cannot see a facade-level
 * global-slice bug. This file drives the real facade code path.
 */

const CHANGED_A = 'src/a.ts';
const CHANGED_B = 'src/b.ts';
const CHANGED_G = 'src/g.ts';

const FULL_STATE: IndexState = {
  repoId: 'r1',
  status: 'full',
  filesIndexed: 312,
  filesSkipped: 0,
  durationMs: 1000,
  lastIndexedSha: '66727c85',
  indexerVersion: 2,
  updatedAt: new Date(),
};

/** Declared-symbol rows for the changed files (kind:'function', bare names — no '.'). */
function declRow(path: string, name: string): FullSymbolRow {
  return { path, name, kind: 'function', line: 1, endLine: 5, exported: true, signature: null };
}

interface RepoStub {
  tryGetIndexState: () => Promise<IndexState>;
  getRepoBasics: () => Promise<{
    id: string;
    owner: string;
    name: string;
    defaultBranch: string;
    clonePath: string | null;
  }>;
  getSymbolRows: (repoId: string, paths: string[]) => Promise<FullSymbolRow[]>;
  getResolvedCallers: () => Promise<ResolvedCallerRow[]>;
  getReferenceResolution: () => Promise<{ total: number; resolved: number }>;
  getFileFacts: (repoId: string, files: string[]) => Promise<IndexerFileFactsRow[]>;
}

/**
 * Unit under test: `RepoIntelService.getBlastRadius` (public) → private
 * `tryPersistentBlast`. Input: a stubbed `repo` port (per DevDigest test
 * policy — stub the repository port, never the service under test).
 */
function buildService(
  changedFiles: string[],
  declaredRows: FullSymbolRow[],
  callerRows: ResolvedCallerRow[],
  fileFacts: IndexerFileFactsRow[] = [],
): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: true },
    db: {} as never,
    codeIndex: { symbols: async () => [], references: async () => [] } as never,
  } as never;

  const svc = new RepoIntelService(container);
  const repo: RepoStub = {
    tryGetIndexState: async () => FULL_STATE,
    getRepoBasics: async () => ({
      id: 'r1',
      owner: 'a',
      name: 'b',
      defaultBranch: 'main',
      clonePath: null,
    }),
    // Called TWICE with different `paths`: once for the changed files (decl
    // rows, to build changedSymbols/nameSet), once for the caller files (to
    // resolve the enclosing symbol). Return [] for caller files so
    // enclosingFromRows falls back to the caller's own filename — sufficient
    // for these assertions (viaSymbol, not `symbol`, is what's being tested).
    getSymbolRows: async (_repoId: string, paths: string[]) => {
      const wanted = declaredRows.filter((r) => paths.includes(r.path));
      return wanted.length > 0 && changedFiles.some((f) => paths.includes(f)) ? wanted : [];
    },
    getResolvedCallers: async () => callerRows,
    // Healthy resolution so the empty-callers degraded-fallback guard never trips.
    getReferenceResolution: async () => ({ total: 60, resolved: 60 }),
    getFileFacts: async (_repoId: string, files: string[]) =>
      fileFacts.filter((f) => files.includes(f.filePath)),
  };
  (svc as unknown as { repo: Record<string, unknown> }).repo = repo;
  return svc;
}

/** Build N distinct-fromPath caller rows for one `toSymbol`, rank descending from `rankStart`. */
function callersFor(
  toSymbol: string,
  prefix: string,
  count: number,
  rankStart: number,
): ResolvedCallerRow[] {
  return Array.from({ length: count }, (_, i) => ({
    fromPath: `src/${prefix}${i}.ts`,
    toSymbol,
    line: 10 + i,
    rank: rankStart - i,
  }));
}

describe('getBlastRadius — per-symbol caller cap (TD-004 Phase 3)', () => {
  it('wide multi-symbol changeset: caps EACH viaSymbol independently, not globally', async () => {
    // Input: 30 callers via 'alpha' (rank 100..71, files a0..a29) and 30
    // callers via 'beta' (rank 50..21, files b0..b29). Every alpha rank
    // outranks every beta rank — this is exactly the shape that empties
    // 'beta' under the OLD global sort+slice(0, 20).
    const alphaCallers = callersFor('alpha', 'a', 30, 100);
    const betaCallers = callersFor('beta', 'b', 30, 50);

    const svc = buildService(
      [CHANGED_A, CHANGED_B],
      [declRow(CHANGED_A, 'alpha'), declRow(CHANGED_B, 'beta')],
      [...alphaCallers, ...betaCallers],
    );

    const result = await svc.getBlastRadius('r1', [CHANGED_A, CHANGED_B]);

    // Expected output: exactly MAX_CALLERS_PER_SYMBOL callers survive for
    // EACH viaSymbol — proving the cap groups by viaSymbol rather than
    // slicing one global rank-sorted array (where beta would be 0/starved).
    expect(result.degraded).toBe(false);
    expect(result.callers.filter((c) => c.viaSymbol === 'alpha')).toHaveLength(
      MAX_CALLERS_PER_SYMBOL,
    );
    expect(result.callers.filter((c) => c.viaSymbol === 'beta')).toHaveLength(
      MAX_CALLERS_PER_SYMBOL,
    );
    expect(result.callers).toHaveLength(2 * MAX_CALLERS_PER_SYMBOL);
  });

  it('rank-tie determinism: identical rank-0 input yields the identical surviving set across two calls', async () => {
    // Input: 25 callers via 'gamma', all rank:0 (the degraded/no-file_rank
    // shape), distinct fromPath so dedup keeps all 25 as candidates.
    const gammaCallers = callersFor('gamma', 'g', 25, 0).map((c) => ({ ...c, rank: 0 }));

    const buildRun = () =>
      buildService([CHANGED_G], [declRow(CHANGED_G, 'gamma')], gammaCallers);

    const run1 = await buildRun().getBlastRadius('r1', [CHANGED_G]);
    const run2 = await buildRun().getBlastRadius('r1', [CHANGED_G]);

    // Expected output: with an all-tied rank, the deterministic secondary
    // sort key (file, then symbol, then line) must select the SAME 20
    // survivors run-to-run — not an arbitrary/unstable slice.
    expect(run1.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    const files1 = run1.callers.map((c) => c.file).sort();
    const files2 = run2.callers.map((c) => c.file).sort();
    expect(files2).toEqual(files1);
    // And it must be a genuine subset, not "cap didn't run" (25 survived).
    expect(run1.callers).toHaveLength(run2.callers.length);
  });

  it('small case (≤ cap total): the per-symbol cap does not drop anything (matches old global behaviour)', async () => {
    // Input: 5 callers via 'alpha' + 5 via 'beta' — 10 total, well under the
    // 20-per-symbol cap AND under the old global cap too (TD-004 "why
    // accepted": the per-symbol fix must not regress the common case).
    const alphaCallers = callersFor('alpha', 'a', 5, 10);
    const betaCallers = callersFor('beta', 'b', 5, 10);

    const svc = buildService(
      [CHANGED_A, CHANGED_B],
      [declRow(CHANGED_A, 'alpha'), declRow(CHANGED_B, 'beta')],
      [...alphaCallers, ...betaCallers],
    );

    const result = await svc.getBlastRadius('r1', [CHANGED_A, CHANGED_B]);

    // Expected output: ALL 10 callers returned untouched by the cap.
    expect(result.callers).toHaveLength(10);
    expect(result.callers.filter((c) => c.viaSymbol === 'alpha')).toHaveLength(5);
    expect(result.callers.filter((c) => c.viaSymbol === 'beta')).toHaveLength(5);
  });

  it('NOTE-A: impactedEndpoints is derived from the CAPPED callers, not the pre-cap superset', async () => {
    // Input: 21 callers via 'alpha' (ranks 120..100, files a0..a20). Rank
    // sorts DESC, so the 21st (lowest rank, file 'src/a20.ts') is the ONE
    // caller dropped by the cap; the other 20 survive.
    const alphaCallers = callersFor('alpha', 'a', 21, 120);
    const droppedFile = 'src/a20.ts'; // rank 100 — the lowest, dropped by the cap
    const keptFile = 'src/a0.ts'; // rank 120 — the highest, survives

    const svc = buildService(
      [CHANGED_A],
      [declRow(CHANGED_A, 'alpha')],
      alphaCallers,
      [
        { filePath: droppedFile, endpoints: ['GET /dropped'], crons: [] },
        { filePath: keptFile, endpoints: ['GET /kept'], crons: [] },
      ],
    );

    const result = await svc.getBlastRadius('r1', [CHANGED_A]);

    // Expected output: exactly 20 alpha callers survive; the endpoint of the
    // caller the cap DROPPED must not leak into impactedEndpoints, while the
    // endpoint of a SURVIVING caller must be present. This pins that
    // getFileFacts (and thus impactedEndpoints) is computed from the capped
    // caller set, not the pre-cap superset (spec NOTE-A).
    expect(result.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(result.callers.some((c) => c.file === droppedFile)).toBe(false);
    expect(result.callers.some((c) => c.file === keptFile)).toBe(true);
    expect(result.impactedEndpoints).toContain('GET /kept');
    expect(result.impactedEndpoints).not.toContain('GET /dropped');
  });
});
