/**
 * Phase 1 (L07 Export-to-CI) — agent_runs CI columns migration (test_migration_columns, AC-40).
 *
 * Verifies the generated 0023 migration adds the four nullable CI columns to
 * `agent_runs` and that they round-trip:
 *  - a CI row (source='ci') persists pr_number / repo / github_url / ci_installation_id;
 *  - a local row keeps them NULL (additive, backward-compatible);
 *  - the FK to `ci_installations` is ON DELETE SET NULL (removing an installation
 *    nulls the run's `ci_installation_id`, it does not delete the run).
 *
 * Skips cleanly when Docker is unavailable — the harness applies every migration
 * (incl. 0023) via `runMigrations`; we never migrate the dev DB.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('agent_runs CI columns (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let agentId: string;
  let installationId: string;

  beforeAll(async () => {
    pg = await startPg();
    const s = await seed(pg.handle.db);
    workspaceId = s.workspaceId;
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'CI Reviewer',
        provider: 'openrouter',
        model: 'gpt-4.1',
        systemPrompt: 'review',
      })
      .returning();
    agentId = agent!.id;
    const [inst] = await pg.handle.db
      .insert(t.ciInstallations)
      .values({ agentId, repo: 'acme/payments-api', targetType: 'gha' })
      .returning();
    installationId = inst!.id;
  }, 120_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it('persists all four CI columns on a source=ci run', async () => {
    const [row] = await pg.handle.db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId,
        source: 'ci',
        status: 'succeeded',
        prNumber: 123,
        repo: 'acme/payments-api',
        githubUrl: 'https://github.com/acme/payments-api/actions/runs/42',
        ciInstallationId: installationId,
      })
      .returning();
    expect(row!.prNumber).toBe(123);
    expect(row!.repo).toBe('acme/payments-api');
    expect(row!.githubUrl).toContain('/actions/runs/42');
    expect(row!.ciInstallationId).toBe(installationId);
  });

  it('keeps CI columns NULL on a local run (additive/backward-compatible)', async () => {
    const [row] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, agentId, source: 'local', status: 'done' })
      .returning();
    expect(row!.source).toBe('local');
    expect(row!.prNumber).toBeNull();
    expect(row!.repo).toBeNull();
    expect(row!.githubUrl).toBeNull();
    expect(row!.ciInstallationId).toBeNull();
  });

  it('nulls ci_installation_id when the installation is deleted (ON DELETE SET NULL)', async () => {
    const [inst] = await pg.handle.db
      .insert(t.ciInstallations)
      .values({ agentId, repo: 'acme/other', targetType: 'gha' })
      .returning();
    const [row] = await pg.handle.db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId,
        source: 'ci',
        status: 'succeeded',
        repo: 'acme/other',
        githubUrl: 'https://github.com/acme/other/actions/runs/7',
        ciInstallationId: inst!.id,
      })
      .returning();

    await pg.handle.db.delete(t.ciInstallations).where(eq(t.ciInstallations.id, inst!.id));

    const [after] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, row!.id));
    expect(after).toBeDefined();
    expect(after!.ciInstallationId).toBeNull(); // run survives, FK nulled
  });
});
