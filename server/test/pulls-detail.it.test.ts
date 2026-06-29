/**
 * Issue #4A — `getDetail` must persist the fresh `pull.head_sha` (not just
 * pr_files / body / stats), so `anchor_status` is derived from a CONSISTENT
 * snapshot. We seed a PR at an OLD head, open the detail (the MockGitHubClient
 * returns a NEW head), and assert the stored `head_sha` advanced — the
 * repository round-trip through `updateDetail`. Gated on Docker (needs Postgres).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string, oldHead: string) {
  const name = `detail-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 7,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: oldHead,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

d('getDetail persists head_sha (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('advances the stored head_sha to the freshly-fetched detail head', async () => {
    const OLD = 'oldhead00';
    const NEW = 'newhead11';
    const gh = new MockGitHubClient({ detail: { head_sha: NEW } });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, OLD);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().head_sha).toBe(NEW);

    // The key assertion: the persisted row's head_sha moved too (so a later
    // anchor_status read sees pr_files + head_sha advance together).
    const [row] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.id, pr.id));
    expect(row!.headSha).toBe(NEW);
  });
});
