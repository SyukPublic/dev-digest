import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context-schema] Docker not available — skipping integration tests.');
}

/**
 * Phase 3 (T8) — the `agent_specs` / `skill_specs` attachment link tables.
 * Proves the migration created the tables and that they behave as designed:
 * store ordered PATHS (never doc text), are workspace-scoped, and cascade when
 * the owning agent / skill is deleted. → AC-5, plus the workspace-scoping rule.
 */
d('project-context attachment link tables', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** Create a fresh agent + skill in the given workspace for a clean test. */
  async function makeAgentAndSkill(workspaceId: string) {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `Agent ${crypto.randomUUID()}`,
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'Review the diff.',
      })
      .returning();
    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: `Skill ${crypto.randomUUID()}`,
        description: 'x',
        type: 'custom',
        source: 'manual',
        body: 'x',
      })
      .returning();
    return { agent: agent!, skill: skill! };
  }

  async function defaultWorkspaceId(): Promise<string> {
    const [{ id }] = await pg.handle.db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    return id!;
  }

  it('round-trips ordered agent attachment PATHS in order', async () => {
    const workspaceId = await defaultWorkspaceId();
    const { agent } = await makeAgentAndSkill(workspaceId);
    const paths = ['docs/architecture.md', 'specs/api.md', 'insights/gotchas.md'];

    await pg.handle.db.insert(t.agentSpecs).values(
      paths.map((path, order) => ({ agentId: agent.id, workspaceId, path, order })),
    );

    const rows = await pg.handle.db
      .select({ path: t.agentSpecs.path, order: t.agentSpecs.order })
      .from(t.agentSpecs)
      .where(eq(t.agentSpecs.agentId, agent.id))
      .orderBy(asc(t.agentSpecs.order));

    expect(rows.map((r) => r.path)).toEqual(paths);
    expect(rows.map((r) => r.order)).toEqual([0, 1, 2]);
  });

  it('round-trips ordered skill attachment PATHS in order', async () => {
    const workspaceId = await defaultWorkspaceId();
    const { skill } = await makeAgentAndSkill(workspaceId);
    const paths = ['specs/security.md', 'docs/design.md'];

    await pg.handle.db.insert(t.skillSpecs).values(
      paths.map((path, order) => ({ skillId: skill.id, workspaceId, path, order })),
    );

    const rows = await pg.handle.db
      .select({ path: t.skillSpecs.path, order: t.skillSpecs.order })
      .from(t.skillSpecs)
      .where(eq(t.skillSpecs.skillId, skill.id))
      .orderBy(asc(t.skillSpecs.order));

    expect(rows.map((r) => r.path)).toEqual(paths);
    expect(rows.map((r) => r.order)).toEqual([0, 1]);
  });

  it('(agent_id, path) is the primary key: the same path cannot attach twice', async () => {
    const workspaceId = await defaultWorkspaceId();
    const { agent } = await makeAgentAndSkill(workspaceId);
    await pg.handle.db
      .insert(t.agentSpecs)
      .values({ agentId: agent.id, workspaceId, path: 'docs/dup.md', order: 0 });

    await expect(
      pg.handle.db
        .insert(t.agentSpecs)
        .values({ agentId: agent.id, workspaceId, path: 'docs/dup.md', order: 1 }),
    ).rejects.toThrow();
  });

  it('carries workspace_id so attachments are scopable to a tenant', async () => {
    const workspaceId = await defaultWorkspaceId();
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${crypto.randomUUID()}` })
      .returning();
    const { agent } = await makeAgentAndSkill(workspaceId);

    await pg.handle.db
      .insert(t.agentSpecs)
      .values({ agentId: agent.id, workspaceId, path: 'docs/scoped.md', order: 0 });

    // A query scoped to the OTHER workspace sees nothing.
    const foreign = await pg.handle.db
      .select({ path: t.agentSpecs.path })
      .from(t.agentSpecs)
      .where(and(eq(t.agentSpecs.agentId, agent.id), eq(t.agentSpecs.workspaceId, otherWs!.id)));
    expect(foreign).toHaveLength(0);

    // Scoped to the OWNING workspace it is visible.
    const owned = await pg.handle.db
      .select({ path: t.agentSpecs.path })
      .from(t.agentSpecs)
      .where(and(eq(t.agentSpecs.agentId, agent.id), eq(t.agentSpecs.workspaceId, workspaceId)));
    expect(owned.map((r) => r.path)).toEqual(['docs/scoped.md']);
  });

  it('deleting the owning agent cascades its attachments away', async () => {
    const workspaceId = await defaultWorkspaceId();
    const { agent } = await makeAgentAndSkill(workspaceId);
    await pg.handle.db
      .insert(t.agentSpecs)
      .values({ agentId: agent.id, workspaceId, path: 'docs/cascade.md', order: 0 });

    await pg.handle.db.delete(t.agents).where(eq(t.agents.id, agent.id));

    const rows = await pg.handle.db
      .select({ path: t.agentSpecs.path })
      .from(t.agentSpecs)
      .where(eq(t.agentSpecs.agentId, agent.id));
    expect(rows).toHaveLength(0);
  });

  it('deleting the owning skill cascades its attachments away', async () => {
    const workspaceId = await defaultWorkspaceId();
    const { skill } = await makeAgentAndSkill(workspaceId);
    await pg.handle.db
      .insert(t.skillSpecs)
      .values({ skillId: skill.id, workspaceId, path: 'docs/cascade.md', order: 0 });

    await pg.handle.db.delete(t.skills).where(eq(t.skills.id, skill.id));

    const rows = await pg.handle.db
      .select({ path: t.skillSpecs.path })
      .from(t.skillSpecs)
      .where(eq(t.skillSpecs.skillId, skill.id));
    expect(rows).toHaveLength(0);
  });
});
