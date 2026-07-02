/**
 * Refresh flow — `RepoService.refresh` + the enqueue-time indexing stamp.
 *
 * The refresh POST only ENQUEUES work (clone + incremental refresh) and returns
 * immediately, while `getIndexState().indexing` used to be stamped only when a
 * pipeline run actually started. A client polling `index-state` right after the
 * POST therefore observed a false "idle" gap and stopped watching (the UI's
 * Refresh button reverted mid-run). These tests pin the fix's WIRING:
 *   - refresh stamps "index work queued" via the repo-intel FACADE (never the
 *     repo-intel repository directly), after the jobs are enqueued and before
 *     responding,
 *   - the stamp is best-effort: its failure never breaks the refresh itself,
 *   - `RepoIntelService.markIndexQueued` delegates to the repository's
 *     `markIndexingStarted` (same stats key the pipeline re-stamps and the
 *     terminal upsert wipes).
 */
import { describe, it, expect } from 'vitest';
import { RepoService } from '../src/modules/repos/service.js';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { NotFoundError } from '../src/platform/errors.js';
import { CLONE_JOB_KIND } from '../src/modules/repos/constants.js';
import { REFRESH_JOB_KIND } from '../src/modules/repo-intel/constants.js';
import type { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';
import type { Container } from '../src/platform/container.js';

/** RepoService with stubbed reposRepo / jobs / repoIntel; `ops` logs the order. */
function makeRepoService(opts?: { repoExists?: boolean; stampThrows?: boolean }) {
  const ops: string[] = [];
  const reposRepo = {
    getById: async () =>
      (opts?.repoExists ?? true)
        ? { id: 'r1', owner: 'acme', name: 'app', fullName: 'acme/app' }
        : null,
  };
  const jobs = {
    enqueue: async (_ws: string, kind: string) => {
      ops.push(`enqueue:${kind}`);
      return { id: `job-${kind}`, done: Promise.resolve() };
    },
  };
  const repoIntel = {
    markIndexQueued: async (repoId: string) => {
      if (opts?.stampThrows) throw new Error('stamp failed');
      ops.push(`stamp:${repoId}`);
    },
  };
  const container = { reposRepo, jobs, repoIntel } as unknown as Container;
  return { service: new RepoService(container), ops };
}

describe('RepoService.refresh', () => {
  it('enqueues clone + refresh, then stamps "index queued" via the facade before responding', async () => {
    const { service, ops } = makeRepoService();

    const result = await service.refresh('ws1', 'r1');

    expect(result).toEqual({ status: 'refreshing' });
    // Stamp comes AFTER both enqueues (work is really queued) and targets the repo.
    expect(ops).toEqual([
      `enqueue:${CLONE_JOB_KIND}`,
      `enqueue:${REFRESH_JOB_KIND}`,
      'stamp:r1',
    ]);
  });

  it('is best-effort about the stamp: a failing stamp never breaks the refresh', async () => {
    const { service, ops } = makeRepoService({ stampThrows: true });

    const result = await service.refresh('ws1', 'r1');

    expect(result).toEqual({ status: 'refreshing' });
    expect(ops).toEqual([`enqueue:${CLONE_JOB_KIND}`, `enqueue:${REFRESH_JOB_KIND}`]);
  });

  it('does NOT stamp when the repo is unknown (404 propagates first)', async () => {
    const { service, ops } = makeRepoService({ repoExists: false });

    await expect(service.refresh('ws1', 'nope')).rejects.toThrow(NotFoundError);
    expect(ops).toEqual([]);
  });
});

describe('RepoIntelService.markIndexQueued', () => {
  it('delegates to the repository markIndexingStarted (enqueue-time stamp)', async () => {
    const stamped: string[] = [];
    const repo = {
      markIndexingStarted: async (repoId: string) => {
        stamped.push(repoId);
      },
    } as unknown as RepoIntelRepository;

    const service = new RepoIntelService({ db: {} } as unknown as Container);
    (service as unknown as { repo: RepoIntelRepository }).repo = repo;

    await service.markIndexQueued('r1');

    expect(stamped).toEqual(['r1']);
  });
});
