import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';

/**
 * Regression (fix #2b): an index whose references are ALL unresolved
 * (`decl_file` NULL) despite `status='full'` must NOT report a confident
 * "0 callers" blast.
 *
 * Field root cause: the resolve step never persisted for a repo (interrupted
 * mid-run / a restore predating resolution), so `getResolvedCallers` returned
 * empty for EVERY change while `repo_index_state` still read 'full'. The panel
 * then asserted "no downstream callers" — a false negative on a real fan-out
 * (the changed `getContext` helper actually had 8 caller files / 27 endpoints).
 *
 * The guard in `tryPersistentBlast` detects `total > 0 && resolved === 0` and
 * returns null, so `getBlastRadius` falls back to the ripgrep best-effort
 * (`degraded: true`) instead of emitting `degraded: false` + empty. A healthy
 * index (resolved > 0) with genuinely no callers is unaffected.
 *
 * Pure mock — no Postgres, no clone (repo stubbed like repo-intel-facade-degraded).
 */

const CHANGED = 'server/src/modules/_shared/context.ts';

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

function buildService(opts: {
  total: number;
  resolved: number;
  clonePath?: string | null;
}): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: true },
    db: {} as never,
    // ripgrep fallback path — return nothing so the fallback yields a clean
    // degraded-empty result; the test only asserts the `degraded` flag flipped.
    codeIndex: {
      symbols: async () => [],
      references: async () => [],
    } as never,
  } as never;

  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    tryGetIndexState: async () => FULL_STATE,
    getRepoBasics: async () => ({
      id: 'r1',
      owner: 'a',
      name: 'b',
      defaultBranch: 'main',
      clonePath: opts.clonePath ?? null,
    }),
    // One callable changed symbol so `nameSet` is non-empty and the guard is
    // reached (an empty nameSet short-circuits before it).
    getSymbolRows: async (_repoId: string, paths: string[]) =>
      paths.includes(CHANGED)
        ? [
            {
              path: CHANGED,
              name: 'getContext',
              kind: 'function',
              line: 1,
              endLine: 5,
              exported: true,
              signature: null,
            },
          ]
        : [],
    getResolvedCallers: async () => [],
    getReferenceResolution: async () => ({ total: opts.total, resolved: opts.resolved }),
    getFileFacts: async () => [],
  };
  return svc;
}

describe('getBlastRadius — unresolved-index guard (fix #2b)', () => {
  it('all-NULL decl_file (resolved=0, total>0) → falls back (degraded:true), no false "no callers"', async () => {
    // clonePath null → the ripgrep fallback returns its degraded-empty result,
    // which is enough to prove tryPersistentBlast returned null (did NOT emit a
    // confident degraded:false empty from the persistent path).
    const svc = buildService({ total: 6416, resolved: 0, clonePath: null });
    const blast = await svc.getBlastRadius('r1', [CHANGED]);
    expect(blast.degraded).toBe(true);
  });

  it('healthy index (resolved>0) with genuinely no callers → persistent path, degraded:false', async () => {
    const svc = buildService({ total: 6416, resolved: 640 });
    const blast = await svc.getBlastRadius('r1', [CHANGED]);
    expect(blast.degraded).toBe(false); // trusted persistent result
    expect(blast.callers).toEqual([]); // really no callers for THIS change
    expect(blast.changedSymbols.map((s) => s.name)).toContain('getContext');
  });

  it('empty references table (total=0) → NOT a defect; persistent path, degraded:false', async () => {
    // total===0 must not trip the guard (a repo can legitimately have symbols
    // but no captured references); only total>0 && resolved===0 is pathological.
    const svc = buildService({ total: 0, resolved: 0 });
    const blast = await svc.getBlastRadius('r1', [CHANGED]);
    expect(blast.degraded).toBe(false);
  });
});
