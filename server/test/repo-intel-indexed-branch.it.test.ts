/**
 * Phase 2 (TD-003 blast freshness) — `tryGetIndexState` projects
 * `stats.indexedBranch` into `IndexState.indexedBranch` (Testcontainers pg).
 *
 * Provenance is stamped into the `repo_index_state.stats` jsonb at index time
 * (no migration — the column already exists). This round-trip proves the
 * repository reads it back out of `stats` the same way it already projects
 * `durationMs`/`reason`, and that a legacy row lacking `stats.indexedBranch`
 * surfaces `undefined` (no throw).
 *
 * Skips cleanly when Docker is unavailable (no daemon). The harness runs the
 * generated migrations; we never migrate the dev DB.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('tryGetIndexState — indexedBranch projection (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repo: RepoIntelRepository;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    repo = new RepoIntelRepository(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function makeRepo(name: string): Promise<string> {
    const [row] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    return row!.id;
  }

  it('projects stats.indexedBranch into IndexState.indexedBranch', async () => {
    const repoId = await makeRepo('idx-branch-stamped');
    await repo.upsertIndexState({
      repoId,
      lastIndexedSha: 'sha-1',
      indexerVersion: INDEXER_VERSION,
      status: 'full',
      filesIndexed: 3,
      filesSkipped: 0,
      stats: { indexedBranch: 'main', durationMs: 42 },
    });

    const state = await repo.tryGetIndexState(repoId);
    expect(state).not.toBeNull();
    expect(state!.indexedBranch).toBe('main');
    // Sanity: the sibling projections still work alongside the new one.
    expect(state!.durationMs).toBe(42);
    expect(state!.lastIndexedSha).toBe('sha-1');
  });

  it('surfaces undefined on a legacy row lacking stats.indexedBranch (no throw)', async () => {
    const repoId = await makeRepo('idx-branch-legacy');
    await repo.upsertIndexState({
      repoId,
      lastIndexedSha: 'sha-legacy',
      indexerVersion: INDEXER_VERSION,
      status: 'full',
      filesIndexed: 1,
      filesSkipped: 0,
      stats: { durationMs: 10 }, // no indexedBranch — mirrors pre-Phase-2 rows
    });

    const state = await repo.tryGetIndexState(repoId);
    expect(state).not.toBeNull();
    expect(state!.indexedBranch).toBeUndefined();
  });
});
