/**
 * Remove-from-CI (uninstall) integration tests (T15–T17, AC-70..AC-74/AC-76).
 * Drive `DELETE /agents/:id/ci-installations/:installationId` through a real
 * Postgres with a `MockGitHubClient` so we can assert exactly which files are
 * deleted from the branch without touching GitHub. The runner bundle is stubbed
 * via `DEVDIGEST_RUNNER_BUNDLE` so the suite is hermetic.
 *
 * REQUIRES the `manifest_slug` migration applied (`cd server && pnpm db:migrate`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { manifestPath, skillPath, stableManifestSlug } from '../src/modules/ci/serialize.js';
import { MEMORY_PATH, RUNNER_PATH, WORKFLOW_PATH } from '../src/modules/ci/constants.js';
import type { CiExportRequestBody, CiInstallation, CiUninstallResult } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;
async function makeAgent(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  name: string,
  skillName?: string,
) {
  const [agent] = await db
    .insert(t.agents)
    .values({ workspaceId, name, provider: 'openrouter', model: 'm', systemPrompt: 'p' })
    .returning();
  if (skillName) {
    const [skill] = await db
      .insert(t.skills)
      .values({ workspaceId, name: skillName, description: 'x', type: 'security', source: 'manual', body: '# s' })
      .returning();
    await db.insert(t.agentSkills).values({ agentId: agent!.id, skillId: skill!.id, order: 0 });
  }
  return agent!;
}

const body = (over: Partial<CiExportRequestBody> = {}): CiExportRequestBody => ({
  repo: `acme/repo-${seq++}`,
  action: 'open_pr',
  ...over,
});

d('DELETE /agents/:id/ci-installations/:installationId (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let bundleDir: string;
  let bundlePath: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    bundleDir = mkdtempSync(path.join(tmpdir(), 'dduninstall-'));
    bundlePath = path.join(bundleDir, 'index.js');
    writeFileSync(bundlePath, 'module.exports = {}; // stub runner bundle');
    process.env.DEVDIGEST_RUNNER_BUNDLE = bundlePath;
  });
  afterAll(async () => {
    delete process.env.DEVDIGEST_RUNNER_BUNDLE;
    rmSync(bundleDir, { recursive: true, force: true });
    await pg?.stop();
  });

  async function installs(app: Awaited<ReturnType<typeof buildApp>>, agentId: string): Promise<CiInstallation[]> {
    return (await app.inject({ method: 'GET', url: `/agents/${agentId}/ci-installations` })).json() as CiInstallation[];
  }

  it('test_uninstall_one_of_many: deletes ONLY the removed agent\'s files; other agent + its runs unaffected (AC-71/AC-76)', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const repo = 'acme/multi-uninstall';
    const a = await makeAgent(pg.handle.db, workspaceId, 'Alpha Guardian', 'Alpha Rubric');
    const b = await makeAgent(pg.handle.db, workspaceId, 'Beta Guardian', 'Beta Rubric');

    await app.inject({ method: 'POST', url: `/agents/${a.id}/export-ci`, payload: body({ repo }) });
    await app.inject({ method: 'POST', url: `/agents/${b.id}/export-ci`, payload: body({ repo }) });
    const aInst = (await installs(app, a.id)).find((i) => i.repo === repo)!;

    const res = await app.inject({ method: 'DELETE', url: `/agents/${a.id}/ci-installations/${aInst.id}` });
    expect(res.statusCode).toBe(200);
    const out = res.json() as CiUninstallResult;
    expect(out.removed).toBe(true);
    expect(out.branch_updated).toBe(true);
    expect(out.last_agent_removed).toBe(false);

    // Exactly one delete commit, removing ONLY A's manifest + its orphaned skill.
    expect(gh.deletedFiles).toHaveLength(1);
    const deleted = gh.deletedFiles[0]!.paths;
    const aSlug = stableManifestSlug(a.id, 'Alpha Guardian');
    const bSlug = stableManifestSlug(b.id, 'Beta Guardian');
    expect(deleted).toContain(manifestPath(aSlug));
    expect(deleted).toContain(skillPath('alpha-rubric'));
    // Never B's manifest, and never the shared workflow/runner (not the last agent).
    expect(deleted).not.toContain(manifestPath(bSlug));
    expect(deleted).not.toContain(WORKFLOW_PATH);
    expect(deleted).not.toContain(RUNNER_PATH);

    // A's row gone; B's install untouched.
    expect((await installs(app, a.id)).filter((i) => i.repo === repo)).toHaveLength(0);
    expect((await installs(app, b.id)).filter((i) => i.repo === repo)).toHaveLength(1);
    await app.close();
  });

  it('test_uninstall_last_agent: removing the LAST agent also removes the orphaned workflow/runner, not the branch/PR (AC-72)', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const repo = 'acme/last-uninstall';
    const a = await makeAgent(pg.handle.db, workspaceId, 'Solo Guardian', 'Solo Rubric');

    await app.inject({ method: 'POST', url: `/agents/${a.id}/export-ci`, payload: body({ repo }) });
    const aInst = (await installs(app, a.id)).find((i) => i.repo === repo)!;

    const res = await app.inject({ method: 'DELETE', url: `/agents/${a.id}/ci-installations/${aInst.id}` });
    const out = res.json() as CiUninstallResult;
    expect(out.last_agent_removed).toBe(true);

    const deleted = gh.deletedFiles[0]!.paths;
    expect(deleted).toContain(manifestPath(stableManifestSlug(a.id, 'Solo Guardian')));
    expect(deleted).toContain(skillPath('solo-rubric'));
    // Orphaned workflow/runner/memory removed…
    expect(deleted).toContain(WORKFLOW_PATH);
    expect(deleted).toContain(RUNNER_PATH);
    expect(deleted).toContain(MEMORY_PATH);
    // …but the branch is never force-deleted and the PR is left for the user.
    expect(gh.deletedFiles).toHaveLength(1); // one delete commit — no branch deletion API
    await app.close();
  });

  it('test_delete_installation_detaches_history: prior CI runs are kept with ci_installation_id null (AC-70/AC-73)', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const repo = 'acme/history-uninstall';
    const a = await makeAgent(pg.handle.db, workspaceId, 'History Guardian');

    await app.inject({ method: 'POST', url: `/agents/${a.id}/export-ci`, payload: body({ repo }) });
    const aInst = (await installs(app, a.id)).find((i) => i.repo === repo)!;
    // A prior CI run row attributed to this installation.
    const [priorRun] = await pg.handle.db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: a.id,
        source: 'ci',
        status: 'succeeded',
        repo,
        githubUrl: 'https://github.com/acme/history-uninstall/actions/runs/9',
        ciInstallationId: aInst.id,
      })
      .returning();

    await app.inject({ method: 'DELETE', url: `/agents/${a.id}/ci-installations/${aInst.id}` });

    // Installation row deleted…
    const [instAfter] = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.id, aInst.id));
    expect(instAfter).toBeUndefined();
    // …but the run history survives as detached (ci_installation_id nulled).
    const [runAfter] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, priorRun!.id));
    expect(runAfter).toBeDefined();
    expect(runAfter!.ciInstallationId).toBeNull();
    await app.close();
  });

  it('test_uninstall_branch_error: unset GITHUB_TOKEN → clear error, row NOT deleted (no silent divergence) (AC-74)', async () => {
    // Create the install with a github mock…
    const gh = new MockGitHubClient();
    const setupApp = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const repo = 'acme/token-uninstall';
    const a = await makeAgent(pg.handle.db, workspaceId, 'Token Guardian');
    await setupApp.inject({ method: 'POST', url: `/agents/${a.id}/export-ci`, payload: body({ repo }) });
    const aInst = (await installs(setupApp, a.id)).find((i) => i.repo === repo)!;
    await setupApp.close();

    // …then attempt uninstall with NO GitHub token configured (real container path).
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { secrets: new MockSecretsProvider({}) },
    });
    const res = await app.inject({ method: 'DELETE', url: `/agents/${a.id}/ci-installations/${aInst.id}` });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: { code: 'config_error' } });

    // The branch write never ran → the installation row must still exist.
    const [stillThere] = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.id, aInst.id));
    expect(stillThere).toBeDefined();
    await app.close();
  });

  it('test_uninstall_route: 404 when the installation does not belong to the agent', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const a = await makeAgent(pg.handle.db, workspaceId, 'Ghost Guardian');
    const res = await app.inject({
      method: 'DELETE',
      url: `/agents/${a.id}/ci-installations/00000000-0000-0000-0000-000000000000`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
