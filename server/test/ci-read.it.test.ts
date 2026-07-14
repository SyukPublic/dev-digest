/**
 * CI read-endpoint integration tests (T18/T19). Seed `agent_runs` (source='ci')
 * and `ci_installations` directly, then assert the workspace CI-runs list + its
 * filters, the per-agent CI-runs list, and the per-agent installations list.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { CiInstallation, CiRunSummary } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;
type Db = PgFixture['handle']['db'];

async function makeAgent(db: Db, workspaceId: string) {
  const [agent] = await db
    .insert(t.agents)
    .values({ workspaceId, name: `Read Agent ${seq++}`, provider: 'openrouter', model: 'm', systemPrompt: 'p' })
    .returning();
  return agent!;
}

async function insertCiRun(
  db: Db,
  workspaceId: string,
  agentId: string,
  over: Partial<typeof t.agentRuns.$inferInsert> = {},
) {
  const [row] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId,
      agentId,
      source: 'ci',
      status: 'succeeded',
      repo: 'acme/x',
      prNumber: 1,
      githubUrl: `https://github.com/acme/x/actions/runs/${seq++}`,
      findingsCount: 1,
      costUsd: 0.01,
      ranAt: new Date(),
      ...over,
    })
    .returning();
  return row!;
}

d('CI read endpoints (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    app = await buildApp({ config: config(), db: pg.handle.db });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('test_ci_runs_list: GET /ci-runs returns only source=ci rows (AC-32/AC-41)', async () => {
    const agent = await makeAgent(pg.handle.db, workspaceId);
    const repo = 'acme/list';
    await insertCiRun(pg.handle.db, workspaceId, agent.id, { repo });
    await insertCiRun(pg.handle.db, workspaceId, agent.id, { repo });
    // A LOCAL run in the same repo must NOT appear in the CI list.
    await insertCiRun(pg.handle.db, workspaceId, agent.id, { repo, source: 'local' });

    const rows = (await (await app.inject({ method: 'GET', url: `/ci-runs?repo=${repo}` })).json()) as CiRunSummary[];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === 'ci')).toBe(true);
    expect(rows[0]!.github_url).toContain('actions/runs/');
    expect(rows[0]!.agent_name).toBe(agent.name);
  });

  it('test_ci_runs_filters: 7d window + status + agent filters (AC-35)', async () => {
    const agent = await makeAgent(pg.handle.db, workspaceId);
    const repo = 'acme/filter';
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await insertCiRun(pg.handle.db, workspaceId, agent.id, { repo, ranAt: new Date() });
    await insertCiRun(pg.handle.db, workspaceId, agent.id, { repo, ranAt: old, status: 'failed' });

    const within7 = (await (await app.inject({ method: 'GET', url: `/ci-runs?repo=${repo}&days=7` })).json()) as CiRunSummary[];
    expect(within7).toHaveLength(1); // the 30-day-old row is outside the window

    const within60 = (await (await app.inject({ method: 'GET', url: `/ci-runs?repo=${repo}&days=60` })).json()) as CiRunSummary[];
    expect(within60).toHaveLength(2);

    const failed = (await (await app.inject({ method: 'GET', url: `/ci-runs?repo=${repo}&days=60&status=failed` })).json()) as CiRunSummary[];
    expect(failed).toHaveLength(1);
    expect(failed[0]!.status).toBe('failed');

    const byAgent = (await (await app.inject({ method: 'GET', url: `/ci-runs?days=60&agent_id=${agent.id}` })).json()) as CiRunSummary[];
    expect(byAgent.every((r) => r.agent_id === agent.id)).toBe(true);
    expect(byAgent.length).toBeGreaterThanOrEqual(2);
  });

  it('test_agent_ci_runs: GET /agents/:id/ci-runs is scoped to that agent (AC-32)', async () => {
    const a = await makeAgent(pg.handle.db, workspaceId);
    const b = await makeAgent(pg.handle.db, workspaceId);
    await insertCiRun(pg.handle.db, workspaceId, a.id, { repo: 'acme/a' });
    await insertCiRun(pg.handle.db, workspaceId, b.id, { repo: 'acme/b' });

    const rows = (await (await app.inject({ method: 'GET', url: `/agents/${a.id}/ci-runs` })).json()) as CiRunSummary[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.agent_id === a.id)).toBe(true);
  });

  it('GET /agents/:id/ci-runs → 404 for an unknown agent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/agents/00000000-0000-0000-0000-000000000000/ci-runs`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('test_installations_list: GET /agents/:id/ci-installations (AC-31)', async () => {
    const agent = await makeAgent(pg.handle.db, workspaceId);
    await pg.handle.db
      .insert(t.ciInstallations)
      .values([
        { agentId: agent.id, repo: 'acme/one', targetType: 'gha' },
        { agentId: agent.id, repo: 'acme/two', targetType: 'gha' },
      ]);

    const rows = (await (await app.inject({ method: 'GET', url: `/agents/${agent.id}/ci-installations` })).json()) as CiInstallation[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.repo).sort()).toEqual(['acme/one', 'acme/two']);
    expect(rows[0]!.target_type).toBe('gha');
    expect(typeof rows[0]!.installed_at).toBe('string');
  });

  it('GET /agents/:id/ci-installations → 404 for an unknown agent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/agents/00000000-0000-0000-0000-000000000000/ci-installations`,
    });
    expect(res.statusCode).toBe(404);
  });
});
