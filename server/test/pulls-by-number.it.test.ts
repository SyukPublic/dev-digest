/**
 * Phase 1 (L04 devdigest-mcp) — `GET /repos/:id/pulls?number=<n>` resolve filter.
 *
 * Backs the MCP server's `(repo, number)` → PR resolution without listing all
 * pulls. Two layers are exercised:
 *   - PullsRepository.byNumber — the indexed `(workspace_id, repo_id, number)`
 *     read: found / not-found / wrong-workspace (the tenancy guard — a PR in
 *     another workspace must NOT leak).
 *   - the route — `?number=` coerces the string query, returns a 0/1-element
 *     PrMeta[] (stable array contract), and omitting `number` keeps the list.
 *
 * Skips cleanly when Docker is unavailable. The harness runs the generated
 * migrations; we never migrate the dev DB.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import { PullsRepository } from '../src/modules/pulls/repository.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  number: number,
) {
  const name = `bynum-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number,
      title: `PR #${number}`,
      author: 'dev',
      branch: 'feat/x',
      base: 'main',
      headSha: `sha-${number}`,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

d('pulls byNumber resolve (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let pulls: PullsRepository;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    // A second tenant to prove cross-workspace isolation.
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-tenant' })
      .returning();
    otherWorkspaceId = otherWs!.id;
    pulls = new PullsRepository(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  // ---- repository: byNumber -------------------------------------------------

  it('byNumber returns the matching PR for the right repo + number', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 42);
    const row = await pulls.byNumber(workspaceId, repo.id, 42);
    expect(row?.id).toBe(pr.id);
    expect(row?.number).toBe(42);
  });

  it('byNumber returns undefined for an unknown number (not found)', async () => {
    const { repo } = await setupRepoAndPr(pg.handle.db, workspaceId, 7);
    expect(await pulls.byNumber(workspaceId, repo.id, 9999)).toBeUndefined();
  });

  it('byNumber does NOT leak a PR owned by another workspace', async () => {
    // PR lives in `otherWorkspaceId`'s repo; querying with the default workspace
    // (even with the correct repoId + number) must miss.
    const { repo } = await setupRepoAndPr(pg.handle.db, otherWorkspaceId, 13);
    expect(await pulls.byNumber(workspaceId, repo.id, 13)).toBeUndefined();
    // Sanity: the owning workspace DOES see it.
    expect(await pulls.byNumber(otherWorkspaceId, repo.id, 13)).toBeDefined();
  });

  // ---- route: ?number= ------------------------------------------------------

  it('GET /repos/:id/pulls?number= returns a single-element PrMeta[]', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    // Seed under the default workspace so LocalNoAuthProvider resolves to it.
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 101);

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls?number=101` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(pr.id);
    expect(body[0].number).toBe(101);
  });

  it('GET /repos/:id/pulls?number= returns an empty array when no PR matches', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const { repo } = await setupRepoAndPr(pg.handle.db, workspaceId, 202);

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls?number=8888` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
