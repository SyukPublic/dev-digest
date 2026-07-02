import { describe, it, expect } from 'vitest';
import { JobRunner } from '../src/platform/jobs.js';
import type { Db } from '../src/db/client.js';

/**
 * Fix (a): per-kind hard timeout. A heavy kind registered with a longer
 * timeoutMs must survive a handler slower than the global default (instead of
 * being killed → marked `failed` while it keeps running as a zombie); a kind
 * without an override still uses the default and times out. Fake db (no
 * Postgres) — we only exercise the timeout routing, not persistence.
 */

// Minimal drizzle-shaped fake: enqueue does insert().values().returning() and
// update().set().where(); we swallow the writes and hand back a job id.
const fakeDb = {
  insert: () => ({ values: () => ({ returning: async () => [{ id: 'job-1' }] }) }),
  update: () => ({ set: () => ({ where: async () => undefined }) }),
} as unknown as Db;

const WORKSPACE = 'ws-1';
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('JobRunner per-kind timeout (fix a)', () => {
  it('a kind with a longer per-kind timeout survives a slow handler', async () => {
    const runner = new JobRunner(fakeDb, { timeoutMs: 50, retries: 0 });
    let finished = false;
    runner.register(
      'heavy',
      async () => {
        await delay(200); // > global 50ms, well under the 3000ms override
        finished = true;
      },
      { timeoutMs: 3000 },
    );
    const { done } = await runner.enqueue(WORKSPACE, 'heavy', {});
    await expect(done).resolves.toBeUndefined();
    expect(finished).toBe(true);
  });

  it('a kind without an override times out at the global default', async () => {
    const runner = new JobRunner(fakeDb, { timeoutMs: 50, retries: 0 });
    runner.register('light', async () => {
      await delay(200); // > global 50ms, no override → times out
    });
    const { done } = await runner.enqueue(WORKSPACE, 'light', {});
    await expect(done).rejects.toThrow(/timed out after 50ms/);
  });
});
