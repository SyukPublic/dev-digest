/**
 * Phase 3 — risks repository round-trip (Testcontainers Postgres).
 *
 * Verifies `upsertRisks` → `getRisks` stores the raw `Risks` object in
 * `pr_brief.json` and reads it back (the same `risks[]` plus `head_sha`),
 * including the upsert (overwrite) path.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import * as t from '../src/db/schema.js';
import type { Risks } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const RISKS_V1: Risks = {
  risks: [
    {
      kind: 'auth',
      title: 'Unauthenticated route',
      explanation: 'Public route registered before the auth barrier.',
      severity: 'high',
      file_refs: ['server/src/routes.ts'],
    },
  ],
};

const RISKS_V2: Risks = {
  risks: [
    {
      kind: 'dependency',
      title: 'New transitive dependency',
      explanation: 'Adds a package with a recent CVE.',
      severity: 'medium',
      file_refs: ['package.json'],
    },
    {
      kind: 'performance',
      title: 'N+1 query',
      explanation: 'Loops a query per row.',
      severity: 'low',
      file_refs: ['server/src/db.ts'],
    },
  ],
};

async function setupPr(db: PgFixture['handle']['db'], workspaceId: string, headSha: string) {
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name: `risks-${headSha}`, fullName: `acme/risks-${headSha}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 7,
      title: 'Risks round-trip',
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

d('risks repository round-trip (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repo: ReviewRepository;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    repo = new ReviewRepository(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('getRisks returns undefined before any upsert', async () => {
    const pr = await setupPr(pg.handle.db, workspaceId, 'sha-none');
    expect(await repo.getRisks(pr.id)).toBeUndefined();
  });

  it('upsertRisks → getRisks round-trips the risks[] and head_sha', async () => {
    const pr = await setupPr(pg.handle.db, workspaceId, 'sha-1');
    await repo.upsertRisks(pr.id, RISKS_V1, pr.headSha);

    const stored = await repo.getRisks(pr.id);
    expect(stored).toBeDefined();
    expect(stored!.risks).toEqual(RISKS_V1.risks);
    expect(stored!.headSha).toBe('sha-1');
  });

  it('upsertRisks overwrites the prior brief on conflict (json + head_sha)', async () => {
    const pr = await setupPr(pg.handle.db, workspaceId, 'sha-2');
    await repo.upsertRisks(pr.id, RISKS_V1, 'sha-2');
    await repo.upsertRisks(pr.id, RISKS_V2, 'sha-2-new');

    const stored = await repo.getRisks(pr.id);
    expect(stored!.risks).toEqual(RISKS_V2.risks);
    expect(stored!.headSha).toBe('sha-2-new');
  });

  it('leaves head_sha null when omitted', async () => {
    const pr = await setupPr(pg.handle.db, workspaceId, 'sha-3');
    await repo.upsertRisks(pr.id, RISKS_V1);

    const stored = await repo.getRisks(pr.id);
    expect(stored!.headSha).toBeNull();
  });
});
