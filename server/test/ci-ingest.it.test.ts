/**
 * CI ingest integration tests (T17). Drive `POST /ci-runs/ingest` with a
 * `MockGitHubClient` whose `workflowRuns`/`artifacts` fixtures simulate GitHub
 * Actions, then read the persisted `agent_runs WHERE source='ci'` back through
 * `GET /ci-runs`. Idempotency + the running→complete transition (AC-37/AC-38).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { CiRunSummary, WorkflowRunSummary } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;
async function makeInstall(db: PgFixture['handle']['db'], workspaceId: string, repo: string) {
  const [agent] = await db
    .insert(t.agents)
    .values({ workspaceId, name: `Ingest Agent ${seq++}`, provider: 'openrouter', model: 'm', systemPrompt: 'p' })
    .returning();
  const [inst] = await db
    .insert(t.ciInstallations)
    .values({ agentId: agent!.id, repo, targetType: 'gha' })
    .returning();
  return { agent: agent!, inst: inst! };
}

const artifact = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    findings_count: 2,
    critical: 1,
    warning: 1,
    cost_usd: 0.05,
    duration_ms: 1200,
    agent: 'Guardian',
    pr_number: 42,
    ...over,
  });

const run = (over: Partial<WorkflowRunSummary> = {}): WorkflowRunSummary => ({
  runId: 101,
  status: 'completed',
  conclusion: 'success',
  prNumber: 42,
  htmlUrl: 'https://github.com/acme/webapp/actions/runs/101',
  displayTitle: 'Add feature',
  createdAt: '2026-07-14T00:00:00Z',
  ...over,
});

async function ciRuns(app: Awaited<ReturnType<typeof buildApp>>, repo: string): Promise<CiRunSummary[]> {
  const res = await app.inject({ method: 'GET', url: `/ci-runs?repo=${encodeURIComponent(repo)}` });
  return res.json() as CiRunSummary[];
}

d('POST /ci-runs/ingest (Testcontainers pg)', () => {
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

  it('test_ingest: parses the result artifact, upserts source=ci runs (AC-37)', async () => {
    const repo = 'acme/webapp';
    await makeInstall(pg.handle.db, workspaceId, repo);
    const gh = new MockGitHubClient({
      workflowRuns: [
        run({ runId: 101, htmlUrl: 'https://github.com/acme/webapp/actions/runs/101' }),
        run({ runId: 102, htmlUrl: 'https://github.com/acme/webapp/actions/runs/102', conclusion: null, status: 'in_progress' }),
      ],
      artifacts: { 101: artifact() }, // 102 has no artifact yet → running row
    });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    const res = await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    expect(res.statusCode).toBe(200);

    const rows = await ciRuns(app, repo);
    expect(rows).toHaveLength(2);

    const done = rows.find((r) => r.github_url!.endsWith('/101'))!;
    expect(done.source).toBe('ci');
    expect(done.status).toBe('succeeded');
    expect(done.findings_count).toBe(2);
    // CRITICAL count from the artifact is persisted to `blockers` so the CI Runs
    // page can derive the 🔴/⚠ severity split (matches the PR review's counts).
    expect(done.blockers).toBe(1);
    expect(done.cost_usd).toBe(0.05);
    expect(done.pr_number).toBe(42);
    expect(done.repo).toBe(repo);

    const running = rows.find((r) => r.github_url!.endsWith('/102'))!;
    expect(running.status).toBe('running');
    await app.close();
  });

  it('rejects a malformed artifact (untrusted input, .safeParse)', async () => {
    const repo = 'acme/bad';
    await makeInstall(pg.handle.db, workspaceId, repo);
    const gh = new MockGitHubClient({
      workflowRuns: [run({ runId: 500, htmlUrl: 'https://github.com/acme/bad/actions/runs/500' })],
      artifacts: { 500: '{not valid json' },
    });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    expect(await ciRuns(app, repo)).toHaveLength(0);
    await app.close();
  });

  it('test_ingest_idempotent: re-running never duplicates a row (AC-38)', async () => {
    const repo = 'acme/api';
    await makeInstall(pg.handle.db, workspaceId, repo);
    const gh = new MockGitHubClient({
      workflowRuns: [run({ runId: 201, htmlUrl: 'https://github.com/acme/api/actions/runs/201' })],
      artifacts: { 201: artifact() },
    });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });

    expect(await ciRuns(app, repo)).toHaveLength(1);
    await app.close();
  });

  it('a running row is completed on a later refresh, not duplicated (AC-38)', async () => {
    const repo = 'acme/svc';
    await makeInstall(pg.handle.db, workspaceId, repo);
    // Shared, mutable artifacts map: empty first (still running), filled later.
    const artifacts: Record<number, string> = {};
    const gh = new MockGitHubClient({
      workflowRuns: [run({ runId: 301, htmlUrl: 'https://github.com/acme/svc/actions/runs/301' })],
      artifacts,
    });
    // Same app instance across both refreshes (boot reaper only runs once, on build).
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    let rows = await ciRuns(app, repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('running');

    // Artifact appears → same run completes on the next ingest.
    artifacts[301] = artifact({ findings_count: 0, critical: 0, warning: 0 });
    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    rows = await ciRuns(app, repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('no_findings');
    expect(rows[0]!.findings_count).toBe(0);
    await app.close();
  });

  it('ingest returns a count and succeeds when a repo has no workflow runs', async () => {
    const gh = new MockGitHubClient({ workflowRuns: [] });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const res = await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('ingested');
    await app.close();
  });
});
