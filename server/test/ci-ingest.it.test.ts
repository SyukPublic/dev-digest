/**
 * CI ingest integration tests — per-agent identity mapping (AC-64..AC-67). Drive
 * `POST /ci-runs/ingest` with a `MockGitHubClient` whose `workflowRuns` /
 * `artifactFiles` fixtures simulate GitHub Actions uploading one result file per
 * installed agent, then read the persisted `agent_runs WHERE source='ci'` back
 * through `GET /ci-runs`. Each result maps to its OWN installation by the
 * artifact's `agent` identity; an unknown identity is skipped; ingest stays
 * idempotent per `(workspace, installation, run)`.
 *
 * REQUIRES the `manifest_slug` migration applied (`cd server && pnpm db:migrate`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { ArtifactFile, CiRunSummary, WorkflowRunSummary } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;
/** Create an agent + a gha installation with a stored manifest slug (the identity). */
async function makeInstall(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  repo: string,
  opts: { name?: string; slug?: string } = {},
) {
  const name = opts.name ?? `Ingest Agent ${seq}`;
  const slug = opts.slug ?? `ingest-agent-${seq}`;
  seq++;
  const [agent] = await db
    .insert(t.agents)
    .values({ workspaceId, name, provider: 'openrouter', model: 'm', systemPrompt: 'p' })
    .returning();
  const [inst] = await db
    .insert(t.ciInstallations)
    .values({ agentId: agent!.id, repo, targetType: 'gha', manifestSlug: slug })
    .returning();
  return { agent: agent!, inst: inst!, slug };
}

/** A per-agent result file identified by `slug` (matches an installation's manifest_slug). */
const resultFile = (slug: string, over: Record<string, unknown> = {}): ArtifactFile => ({
  name: `devdigest-result-${slug}.json`,
  text: JSON.stringify({
    findings_count: 4,
    critical: 1,
    warning: 1,
    suggestion: 2,
    cost_usd: 0.05,
    duration_ms: 1200,
    agent: slug,
    pr_number: 42,
    ...over,
  }),
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

  it('test_ingest_maps_by_identity: each agent result maps to ITS OWN installation (AC-64)', async () => {
    const repo = 'acme/multi';
    const a = await makeInstall(pg.handle.db, workspaceId, repo, { name: 'Security', slug: 'security-aaaa' });
    const b = await makeInstall(pg.handle.db, workspaceId, repo, { name: 'Performance', slug: 'perf-bbbb' });
    const gh = new MockGitHubClient({
      workflowRuns: [run({ runId: 101 })],
      artifactFiles: {
        101: [
          resultFile('security-aaaa', { findings_count: 3, critical: 2, suggestion: 0, cost_usd: 0.03 }),
          resultFile('perf-bbbb', { findings_count: 1, critical: 0, suggestion: 1, cost_usd: 0.01 }),
        ],
      },
    });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    const rows = await ciRuns(app, repo);
    expect(rows).toHaveLength(2);

    const secRow = rows.find((r) => r.ci_installation_id === a.inst.id)!;
    const perfRow = rows.find((r) => r.ci_installation_id === b.inst.id)!;
    // Correct per-agent attribution — never the same result fanned to both.
    expect(secRow.agent_id).toBe(a.agent.id);
    expect(secRow.findings_count).toBe(3);
    expect(secRow.blockers).toBe(2);
    expect(secRow.cost_usd).toBe(0.03);
    expect(perfRow.agent_id).toBe(b.agent.id);
    expect(perfRow.findings_count).toBe(1);
    expect(perfRow.cost_usd).toBe(0.01);
    await app.close();
  });

  it('test_ingest_skips_unknown: an identity matching NO installation is never attached to another install (AC-65)', async () => {
    const repo = 'acme/skip';
    const a = await makeInstall(pg.handle.db, workspaceId, repo, { name: 'Only', slug: 'only-cccc' });
    const gh = new MockGitHubClient({
      workflowRuns: [run({ runId: 202, htmlUrl: 'https://github.com/acme/skip/actions/runs/202' })],
      // A hostile/unknown identity — matches no installation on this repo.
      artifactFiles: { 202: [resultFile('ghost-agent', { findings_count: 9, critical: 9 })] },
    });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    const rows = await ciRuns(app, repo);
    // The ghost result is NOT attached to `a`; `a` produced no matching file on a
    // completed run → recorded as a failed run for its OWN install, never 9 findings.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ci_installation_id).toBe(a.inst.id);
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.findings_count).toBeNull();
    await app.close();
  });

  it('test_ingest_per_agent_rows: a crashed agent → a failed row for its OWN install; the other still succeeds (AC-66)', async () => {
    const repo = 'acme/mixed';
    const a = await makeInstall(pg.handle.db, workspaceId, repo, { name: 'Healthy', slug: 'healthy-dddd' });
    const b = await makeInstall(pg.handle.db, workspaceId, repo, { name: 'Crashed', slug: 'crashed-eeee' });
    const gh = new MockGitHubClient({
      workflowRuns: [run({ runId: 303, htmlUrl: 'https://github.com/acme/mixed/actions/runs/303' })],
      // Only the healthy agent uploaded a result file; the crashed one did not.
      artifactFiles: { 303: [resultFile('healthy-dddd', { findings_count: 0, critical: 0, suggestion: 0 })] },
    });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    const rows = await ciRuns(app, repo);
    expect(rows).toHaveLength(2);
    const healthy = rows.find((r) => r.ci_installation_id === a.inst.id)!;
    const crashed = rows.find((r) => r.ci_installation_id === b.inst.id)!;
    expect(healthy.agent_id).toBe(a.agent.id);
    expect(healthy.status).toBe('no_findings');
    expect(crashed.agent_id).toBe(b.agent.id);
    expect(crashed.status).toBe('failed'); // completed run, no result file for its install
    await app.close();
  });

  it('test_ingest_idempotent: re-running never duplicates a row (AC-67)', async () => {
    const repo = 'acme/idem';
    const a = await makeInstall(pg.handle.db, workspaceId, repo, { name: 'A', slug: 'a-ffff' });
    const b = await makeInstall(pg.handle.db, workspaceId, repo, { name: 'B', slug: 'b-gggg' });
    const gh = new MockGitHubClient({
      workflowRuns: [run({ runId: 404, htmlUrl: 'https://github.com/acme/idem/actions/runs/404' })],
      artifactFiles: { 404: [resultFile('a-ffff'), resultFile('b-gggg')] },
    });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    const rows = await ciRuns(app, repo);
    expect(rows).toHaveLength(2); // one per (agent, run), no dupes on refresh
    void a;
    void b;
    await app.close();
  });

  it('legacy single-agent bundle (devdigest-result.json, agent=name) still maps to its install', async () => {
    const repo = 'acme/legacy';
    // A legacy row: null slug; the old bundle emits the agent NAME as identity.
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name: 'Legacy Guardian', provider: 'openrouter', model: 'm', systemPrompt: 'p' })
      .returning();
    await pg.handle.db
      .insert(t.ciInstallations)
      .values({ agentId: agent!.id, repo, targetType: 'gha' }) // manifest_slug NULL
      .returning();
    const gh = new MockGitHubClient({
      workflowRuns: [run({ runId: 505, htmlUrl: 'https://github.com/acme/legacy/actions/runs/505' })],
      // Single-file fixture (served as devdigest-result.json), identity = the name.
      artifacts: { 505: JSON.stringify({ findings_count: 2, critical: 0, cost_usd: 0.02, agent: 'Legacy Guardian', pr_number: 7 }) },
    });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    const rows = await ciRuns(app, repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('succeeded');
    expect(rows[0]!.findings_count).toBe(2);
    await app.close();
  });

  it('legacy single-agent run does NOT fail OTHER installs, and retracts a stale failed row', async () => {
    const repo = 'acme/legacy-multi';
    const runId = 707;
    const url = `https://github.com/acme/legacy-multi/actions/runs/${runId}`;
    // Two agents installed on the repo; only "Gen" is in the OLD single-agent bundle.
    const gen = await makeInstall(pg.handle.db, workspaceId, repo, { name: 'Gen', slug: 'gen-xxxx' });
    const perf = await makeInstall(pg.handle.db, workspaceId, repo, { name: 'Perf', slug: 'perf-yyyy' });
    // Seed the stale, falsely-`failed` Perf row a prior (buggy) ingest would have written
    // for this run — the fix must RETRACT it (Perf simply wasn't in the single-agent bundle).
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId,
      agentId: perf.agent.id,
      source: 'ci',
      status: 'failed',
      ranAt: new Date('2026-07-16T00:00:00Z'),
      repo,
      githubUrl: url,
      prNumber: 8,
      ciInstallationId: perf.inst.id,
    });
    const gh = new MockGitHubClient({
      workflowRuns: [run({ runId, htmlUrl: url })],
      // OLD single-agent runner: one un-suffixed devdigest-result.json, identity = agent NAME.
      artifacts: {
        [runId]: JSON.stringify({ findings_count: 0, critical: 0, cost_usd: 0.001, agent: 'Gen', pr_number: 8 }),
      },
    });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    const rows = await ciRuns(app, repo);
    // Only the agent that actually ran (Gen) has a row; Perf's stale failed row is gone.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ci_installation_id).toBe(gen.inst.id);
    expect(rows[0]!.status).toBe('no_findings');
    await app.close();
  });

  it('rejects a malformed artifact (untrusted input, .safeParse)', async () => {
    const repo = 'acme/bad';
    await makeInstall(pg.handle.db, workspaceId, repo, { slug: 'bad-hhhh' });
    const gh = new MockGitHubClient({
      workflowRuns: [run({ runId: 500, htmlUrl: 'https://github.com/acme/bad/actions/runs/500' })],
      artifactFiles: { 500: [{ name: 'devdigest-result-bad-hhhh.json', text: '{not valid json' }] },
    });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    // Malformed file dropped → the install got no valid result on a completed run → failed row.
    const rows = await ciRuns(app, repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('failed');
    await app.close();
  });

  it('a running row is completed on a later refresh, not duplicated (AC-67)', async () => {
    const repo = 'acme/svc';
    const { slug } = await makeInstall(pg.handle.db, workspaceId, repo, { slug: 'svc-iiii' });
    const wfRun = run({
      runId: 301,
      htmlUrl: 'https://github.com/acme/svc/actions/runs/301',
      status: 'in_progress',
      conclusion: null,
    });
    const artifactFiles: Record<number, ArtifactFile[]> = {};
    const gh = new MockGitHubClient({ workflowRuns: [wfRun], artifactFiles });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    let rows = await ciRuns(app, repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('running');

    // Run completes and the per-agent file appears → same row completes on next ingest.
    wfRun.status = 'completed';
    wfRun.conclusion = 'success';
    artifactFiles[301] = [resultFile(slug, { findings_count: 0, critical: 0, warning: 0, suggestion: 0 })];
    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    rows = await ciRuns(app, repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('no_findings');
    expect(rows[0]!.findings_count).toBe(0);
    await app.close();
  });

  it('test_ingest_completed_no_artifact_is_failed: a COMPLETED run that wrote no artifact becomes failed, not stuck running', async () => {
    const repo = 'acme/crashed';
    await makeInstall(pg.handle.db, workspaceId, repo, { slug: 'crash-jjjj' });
    const gh = new MockGitHubClient({
      workflowRuns: [
        run({
          runId: 601,
          htmlUrl: 'https://github.com/acme/crashed/actions/runs/601',
          status: 'completed',
          conclusion: 'failure',
        }),
      ],
      artifactFiles: {}, // no files — the job crashed before uploading
    });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    let rows = await ciRuns(app, repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('failed');

    await app.inject({ method: 'POST', url: '/ci-runs/ingest' });
    rows = await ciRuns(app, repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('failed');
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
