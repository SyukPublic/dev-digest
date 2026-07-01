import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Fix (b): per-repo single-flight guard for the index pipeline
 * (RepoIntelService.runExclusive). Two concurrent index/refresh runs for the
 * SAME repo must NOT execute the destructive deleteAllForRepo→insert→resolve
 * sequence in parallel (that race leaves references.decl_file all-NULL on a
 * status=full index). Concurrent requests coalesce to the in-flight run and
 * trigger exactly ONE trailing re-run; different repos stay independent.
 *
 * The pipeline entry points are mocked with controllable deferred promises so
 * we can hold a run "in flight" and observe how many actually start.
 */

const h = vi.hoisted(() => ({
  fullCalls: [] as string[],
  incrCalls: [] as string[],
  resolvers: [] as Array<() => void>,
}));

vi.mock('../src/modules/repo-intel/pipeline/full.js', () => ({
  runFullIndex: vi.fn(async (_c: unknown, _r: unknown, payload: { repoId: string }) => {
    h.fullCalls.push(payload.repoId);
    await new Promise<void>((res) => h.resolvers.push(res));
    return { status: 'full', filesIndexed: 1, filesSkipped: 0, durationMs: 1 };
  }),
}));

vi.mock('../src/modules/repo-intel/pipeline/incremental.js', () => ({
  runIncremental: vi.fn(async (_c: unknown, _r: unknown, payload: { repoId: string }) => {
    h.incrCalls.push(payload.repoId);
    await new Promise<void>((res) => h.resolvers.push(res));
    return { status: 'full', filesIndexed: 1, filesSkipped: 0, durationMs: 1 };
  }),
}));

import { RepoIntelService } from '../src/modules/repo-intel/service.js';

/** Flush pending microtasks + timers so trailing runs get a chance to start. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function buildService(): RepoIntelService {
  const container = { db: {} } as never;
  return new RepoIntelService(container);
}

beforeEach(() => {
  h.fullCalls.length = 0;
  h.incrCalls.length = 0;
  h.resolvers.length = 0;
});

describe('RepoIntelService index guard (runExclusive)', () => {
  it('coalesces concurrent same-repo indexRepo calls into one in-flight + one trailing', async () => {
    const svc = buildService();
    const p1 = svc.indexRepo('r1');
    const p2 = svc.indexRepo('r1');
    const p3 = svc.indexRepo('r1');
    await tick();

    // Only ONE run actually started; p2/p3 coalesced onto it.
    expect(h.fullCalls).toEqual(['r1']);

    h.resolvers[0]!(); // finish the leading run
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.status).toBe('full');
    expect(r2).toBe(r1); // coalesced callers share the in-flight result
    expect(r3).toBe(r1);

    await tick();
    // Exactly ONE trailing re-run fired (all coalesced requests collapse to one).
    expect(h.fullCalls).toEqual(['r1', 'r1']);

    h.resolvers[1]!(); // finish the trailing run
    await tick();
    expect(h.fullCalls).toEqual(['r1', 'r1']); // nothing pending → no further runs
  });

  it('runs different repos independently (no cross-repo blocking)', async () => {
    const svc = buildService();
    const pA = svc.indexRepo('rA');
    const pB = svc.indexRepo('rB');
    await tick();

    expect([...h.fullCalls].sort()).toEqual(['rA', 'rB']); // both started at once

    h.resolvers.forEach((r) => r());
    await Promise.all([pA, pB]);
    await tick();
    expect([...h.fullCalls].sort()).toEqual(['rA', 'rB']); // no coalesced peers → no trailing
  });

  it('refreshIndex is guarded by the same per-repo lock', async () => {
    const svc = buildService();
    const p1 = svc.refreshIndex('r1');
    const p2 = svc.refreshIndex('r1'); // coalesces
    await tick();
    expect(h.incrCalls).toEqual(['r1']);

    h.resolvers[0]!();
    await Promise.all([p1, p2]);
    await tick();
    expect(h.incrCalls).toEqual(['r1', 'r1']); // one trailing

    h.resolvers[1]!();
    await tick();
    expect(h.incrCalls).toEqual(['r1', 'r1']);
  });
});
