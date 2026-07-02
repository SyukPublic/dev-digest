/**
 * Phase 3 (L04 Blast Radius) — BlastRepository round-trip (Testcontainers pg).
 *
 * Verifies `upsertSummary` → `getSummary` stores/reads the cached prose keyed by
 * `(prId, headSha)`: a fresh read misses, a same-head read hits, the upsert
 * overwrites on conflict, and a stale head returns undefined (cache miss).
 *
 * Skips cleanly when Docker is unavailable (no daemon). The harness runs the
 * generated migrations (incl. 0017 → `pr_blast_summary`); we never migrate the
 * dev DB.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import { BlastRepository } from '../src/modules/blast/repository.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

async function setupPr(db: PgFixture['handle']['db'], workspaceId: string, headSha: string) {
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name: `blast-${headSha}`, fullName: `acme/blast-${headSha}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 7,
      title: 'Blast summary round-trip',
      author: 'dev',
      branch: 'feat/x',
      base: 'main',
      headSha,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
    })
    .returning();
  return pr!;
}

d('BlastRepository round-trip (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repo: BlastRepository;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    repo = new BlastRepository(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('getSummary returns undefined before any upsert', async () => {
    const pr = await setupPr(pg.handle.db, workspaceId, 'sha-none');
    expect(await repo.getSummary(pr.id, 'sha-none')).toBeUndefined();
  });

  it('upsertSummary → getSummary round-trips on the same head', async () => {
    const pr = await setupPr(pg.handle.db, workspaceId, 'sha-1');
    await repo.upsertSummary(pr.id, 'sha-1', 'The first prose.');
    expect(await repo.getSummary(pr.id, 'sha-1')).toBe('The first prose.');
  });

  it('upsertSummary overwrites the prior row on conflict (PK prId)', async () => {
    const pr = await setupPr(pg.handle.db, workspaceId, 'sha-2');
    await repo.upsertSummary(pr.id, 'sha-2', 'v1 prose');
    await repo.upsertSummary(pr.id, 'sha-2b', 'v2 prose');
    expect(await repo.getSummary(pr.id, 'sha-2b')).toBe('v2 prose');
  });

  it('getSummary on a stale head returns undefined (cache miss)', async () => {
    const pr = await setupPr(pg.handle.db, workspaceId, 'sha-3');
    await repo.upsertSummary(pr.id, 'sha-3', 'prose for sha-3');
    // The PR head moved → a read keyed on the new head misses.
    expect(await repo.getSummary(pr.id, 'sha-3-moved')).toBeUndefined();
  });
});
