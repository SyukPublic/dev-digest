/**
 * Export-to-CI endpoint integration tests (T14–T16). Drive
 * `POST /agents/:id/export-ci` through a real Postgres with a `MockGitHubClient`
 * so we can assert what gets committed/opened without touching GitHub. The
 * runner bundle is stubbed via `DEVDIGEST_RUNNER_BUNDLE` so the suite is
 * hermetic (no `agent-runner` build needed).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { CiExport, CiExportRequestBody, CiInstallation } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let agentSeq = 0;
async function makeAgent(db: PgFixture['handle']['db'], workspaceId: string, withSkill = true) {
  const name = `Guardian ${agentSeq++}`;
  const [agent] = await db
    .insert(t.agents)
    .values({
      workspaceId,
      name,
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-sonnet',
      systemPrompt: 'Review pull requests.\nBe concise.',
    })
    .returning();
  if (withSkill) {
    const [skill] = await db
      .insert(t.skills)
      .values({
        workspaceId,
        name: 'Security Rubric',
        description: 'checks',
        type: 'security',
        source: 'manual',
        body: '# Security\nCheck for secrets.',
      })
      .returning();
    await db.insert(t.agentSkills).values({ agentId: agent!.id, skillId: skill!.id, order: 0 });
  }
  return agent!;
}

/** Create an agent with an EXPLICIT name (for slug-collision tests), no skill. */
async function makeNamedAgent(db: PgFixture['handle']['db'], workspaceId: string, name: string) {
  const [agent] = await db
    .insert(t.agents)
    .values({
      workspaceId,
      name,
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-sonnet',
      systemPrompt: 'Review pull requests.',
    })
    .returning();
  return agent!;
}

/** The manifest file path committed in an export payload. */
function manifestPathOf(files: { path: string }[]): string {
  return files.find((f) => f.path.startsWith('.devdigest/agents/') && f.path.endsWith('.yaml'))!.path;
}

d('POST /agents/:id/export-ci (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let bundleDir: string;
  let bundlePath: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    bundleDir = mkdtempSync(path.join(tmpdir(), 'ddrunner-'));
    bundlePath = path.join(bundleDir, 'index.js');
    writeFileSync(bundlePath, 'module.exports = {}; // stub runner bundle');
    process.env.DEVDIGEST_RUNNER_BUNDLE = bundlePath;
  });
  afterAll(async () => {
    delete process.env.DEVDIGEST_RUNNER_BUNDLE;
    rmSync(bundleDir, { recursive: true, force: true });
    await pg?.stop();
  });

  const body = (over: Partial<CiExportRequestBody> = {}): CiExportRequestBody => ({
    repo: 'acme/webapp',
    action: 'open_pr',
    ...over,
  });

  it('test_export_open_pr: commits the bundle and opens the CI PR (AC-7)', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const agent = await makeAgent(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: body(),
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as CiExport;

    expect(gh.committed).toHaveLength(1);
    expect(gh.committed[0]!.branch).toBe('devdigest/ci');
    expect(gh.openedPrs).toHaveLength(1);
    expect(gh.openedPrs[0]!.title).toBe('Add DevDigest CI review');
    expect(gh.openedPrs[0]!.head).toBe('devdigest/ci');
    expect(out.pr_url).toBe('https://github.com/mock/mock/pull/1');
    // manifest + 1 skill + memory + runner + workflow.
    expect(out.files.map((f) => f.path)).toContain('.github/workflows/devdigest-review.yml');
    expect(out.files.map((f) => f.path)).toContain('.devdigest/skills/security-rubric.md');
    await app.close();
  });

  it('test_no_base_commit: commits to devdigest/ci, NEVER to base (AC-9)', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const agent = await makeAgent(pg.handle.db, workspaceId);

    await app.inject({ method: 'POST', url: `/agents/${agent.id}/export-ci`, payload: body({ base: 'main' }) });
    for (const c of gh.committed) {
      expect(c.branch).toBe('devdigest/ci');
      expect(c.branch).not.toBe(c.base);
    }
    await app.close();
  });

  it('test_export_idempotent: re-publish reuses the open PR (AC-8)', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const agent = await makeAgent(pg.handle.db, workspaceId);

    await app.inject({ method: 'POST', url: `/agents/${agent.id}/export-ci`, payload: body() });
    await app.inject({ method: 'POST', url: `/agents/${agent.id}/export-ci`, payload: body() });

    // Two commits, but only ONE PR opened (second reused via findOpenPr).
    expect(gh.committed).toHaveLength(2);
    expect(gh.openedPrs).toHaveLength(1);

    // And the installation is not duplicated.
    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/ci-installations` });
    expect((res.json() as CiInstallation[]).length).toBe(1);
    await app.close();
  });

  it('test_installation_persisted: open_pr persists a CiInstallation (AC-10)', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const agent = await makeAgent(pg.handle.db, workspaceId);

    await app.inject({ method: 'POST', url: `/agents/${agent.id}/export-ci`, payload: body({ repo: 'acme/api' }) });

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/ci-installations` });
    const rows = res.json() as CiInstallation[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.repo).toBe('acme/api');
    expect(rows[0]!.target_type).toBe('gha');
    await app.close();
  });

  it('test_carry_edited_files: edited files are committed verbatim (AC-6)', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const agent = await makeAgent(pg.handle.db, workspaceId);

    // Generate a preview, edit the workflow file, install with the edited files.
    const preview = (await (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/export-ci`, payload: body({ action: 'files' }) })
    ).json()) as CiExport;
    const edited = preview.files.map((f) =>
      f.path.endsWith('.yml') ? { ...f, contents: `${f.contents}\n# hand-edited` } : f,
    );

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: body({ action: 'open_pr', files: edited }),
    });
    expect(res.statusCode).toBe(200);
    expect(gh.committed).toHaveLength(1);
    expect(gh.committed[0]!.files).toEqual(edited);
    await app.close();
  });

  it('test_partial_files_regenerate_bundle: editable-only files still commit a FULL bundle incl. the runner (no big-body round-trip)', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const agent = await makeAgent(pg.handle.db, workspaceId);

    // Mirror the client: send ONLY the editable files (never the multi-MB runner),
    // with a hand-edit on the workflow.
    const preview = (await (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/export-ci`, payload: body({ action: 'files' }) })
    ).json()) as CiExport;
    const editableOnly = preview.files
      .filter((f) => f.editable)
      .map((f) => (f.path.endsWith('.yml') ? { ...f, contents: `${f.contents}\n# hand-edited` } : f));
    expect(editableOnly.map((f) => f.path)).not.toContain('.devdigest/runner/index.js');

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: body({ action: 'open_pr', files: editableOnly }),
    });
    expect(res.statusCode).toBe(200);

    // The committed bundle is COMPLETE (server re-read the runner from disk)…
    const committed = gh.committed[0]!.files;
    expect(committed.map((f) => f.path).sort()).toEqual(preview.files.map((f) => f.path).sort());
    expect(committed.map((f) => f.path)).toContain('.devdigest/runner/index.js');
    // …and the client's workflow edit was overlaid (AC-6).
    expect(committed.find((f) => f.path.endsWith('.yml'))!.contents).toContain('# hand-edited');
    await app.close();
  });

  it('rejects an edited manifest that no longer round-trips the contract (AC-4)', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const agent = await makeAgent(pg.handle.db, workspaceId);

    const preview = (await (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/export-ci`, payload: body({ action: 'files' }) })
    ).json()) as CiExport;
    const broken = preview.files.map((f) =>
      f.path.endsWith('.yaml') ? { ...f, contents: 'name: ""\nmodel: ""' } : f,
    );

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: body({ action: 'open_pr', files: broken }),
    });
    expect(res.statusCode).toBe(422);
    expect(gh.committed).toHaveLength(0);
    await app.close();
  });

  it('test_action_files: preview returns files, persists nothing (AC-11)', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const agent = await makeAgent(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/export-ci`,
      payload: body({ action: 'files' }),
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as CiExport;
    expect(out.pr_url).toBeNull();
    expect(out.files.length).toBeGreaterThan(0);
    // No GitHub side effects, no installation persisted.
    expect(gh.committed).toHaveLength(0);
    expect(gh.openedPrs).toHaveLength(0);
    const insts = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/ci-installations` })).json() as CiInstallation[];
    expect(insts).toHaveLength(0);
    await app.close();
  });

  it('test_no_github_token: unset GITHUB_TOKEN → clear error, no partial install (AC-43)', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { secrets: new MockSecretsProvider({}) },
    });
    const agent = await makeAgent(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/export-ci`, payload: body() });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: { code: 'config_error' } });

    const insts = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/ci-installations` })).json() as CiInstallation[];
    expect(insts).toHaveLength(0);
    await app.close();
  });

  it('test_repo_manifest_slug: the manifest is written at a stable per-agent-unique path, reused across re-exports (AC-62)', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const agent = await makeNamedAgent(pg.handle.db, workspaceId, 'Security Reviewer');

    await app.inject({ method: 'POST', url: `/agents/${agent.id}/export-ci`, payload: body({ repo: 'acme/slugtest' }) });
    const firstPath = manifestPathOf(gh.committed[0]!.files);
    // Stable slug = slugify(name)-<agentId prefix> (NOT the bare slugify(name)).
    expect(firstPath).toMatch(/^\.devdigest\/agents\/security-reviewer-[a-z0-9]{1,8}\.yaml$/);

    // Rename the agent, then re-export → the manifest path MUST stay the same
    // (recovered from the stored slug), never move to slugify(new name).
    await app.inject({ method: 'PUT', url: `/agents/${agent.id}`, payload: { name: 'Renamed Reviewer' } });
    await app.inject({ method: 'POST', url: `/agents/${agent.id}/export-ci`, payload: body({ repo: 'acme/slugtest' }) });
    const secondPath = manifestPathOf(gh.committed[1]!.files);
    expect(secondPath).toBe(firstPath);

    // And still exactly one installation for (agent, repo).
    const insts = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/ci-installations` })).json() as CiInstallation[];
    expect(insts.filter((i) => i.repo === 'acme/slugtest')).toHaveLength(1);
    await app.close();
  });

  it('test_multi_agent_export: two slug-colliding agents on one repo get DISTINCT manifests, one shared PR (AC-56/AC-57/AC-63)', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    // Two DIFFERENT agents whose display names slugify to the SAME value.
    const a = await makeNamedAgent(pg.handle.db, workspaceId, 'Security Reviewer!');
    const b = await makeNamedAgent(pg.handle.db, workspaceId, 'Security Reviewer?');
    const repo = 'acme/multi';

    await app.inject({ method: 'POST', url: `/agents/${a.id}/export-ci`, payload: body({ repo }) });
    await app.inject({ method: 'POST', url: `/agents/${b.id}/export-ci`, payload: body({ repo }) });

    // Each export commits its OWN agent's manifest path; the two paths DIFFER
    // (no silent overwrite on the shared branch — AC-62).
    const pathA = manifestPathOf(gh.committed[0]!.files);
    const pathB = manifestPathOf(gh.committed[1]!.files);
    expect(pathA).not.toBe(pathB);
    expect(pathA.startsWith('.devdigest/agents/security-reviewer-')).toBe(true);
    expect(pathB.startsWith('.devdigest/agents/security-reviewer-')).toBe(true);

    // Both installations persist; the single shared export PR is reused (AC-63).
    expect(gh.committed).toHaveLength(2);
    expect(gh.openedPrs).toHaveLength(1);

    const instsA = (await app.inject({ method: 'GET', url: `/agents/${a.id}/ci-installations` })).json() as CiInstallation[];
    const instsB = (await app.inject({ method: 'GET', url: `/agents/${b.id}/ci-installations` })).json() as CiInstallation[];
    expect(instsA.filter((i) => i.repo === repo)).toHaveLength(1);
    expect(instsB.filter((i) => i.repo === repo)).toHaveLength(1);

    // Re-export agent A → still no duplicate install, still one PR (idempotent — AC-57).
    await app.inject({ method: 'POST', url: `/agents/${a.id}/export-ci`, payload: body({ repo }) });
    const instsA2 = (await app.inject({ method: 'GET', url: `/agents/${a.id}/ci-installations` })).json() as CiInstallation[];
    expect(instsA2.filter((i) => i.repo === repo)).toHaveLength(1);
    expect(gh.openedPrs).toHaveLength(1);
    await app.close();
  });

  it('test_missing_bundle: a missing runner bundle commits NOTHING (AC-44)', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const agent = await makeAgent(pg.handle.db, workspaceId);

    process.env.DEVDIGEST_RUNNER_BUNDLE = path.join(bundleDir, 'does-not-exist.js');
    try {
      const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/export-ci`, payload: body() });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toMatchObject({ error: { code: 'runner_bundle_missing' } });
      expect(gh.committed).toHaveLength(0);
    } finally {
      process.env.DEVDIGEST_RUNNER_BUNDLE = bundlePath;
    }
    await app.close();
  });
});
