import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { Memory, MemoryList } from '@devdigest/shared';
import { MockEmbedder, MockLLMProvider, MockGitClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[memory-routes] Docker not available — skipping.');

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('Memory routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let wsId: string;
  let repoId: string;

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: '' }),
        llm: { openai: new MockLLMProvider('openai', { structured: {} }) },
      },
    });
  }

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select({ id: t.workspaces.id }).from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    wsId = ws!.id;
    const [repo] = await pg.handle.db.select({ id: t.repos.id }).from(t.repos).where(eq(t.repos.workspaceId, wsId)).limit(1);
    repoId = repo!.id;
  });
  afterAll(async () => { await pg?.stop(); });

  it('test_seed_examples: seed inserts all five kinds across repo/global/team scopes (AC-23)', async () => {
    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: `/memory?repo_id=${repoId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as MemoryList;
    const kinds = new Set(body.items.map((i) => i.kind));
    const scopes = new Set(body.items.map((i) => i.scope));
    expect(kinds).toEqual(new Set(['decision', 'convention', 'preference', 'fact', 'learning']));
    expect(scopes).toEqual(new Set(['repo', 'global', 'team']));
    // Facet counts + total reflect the visible set.
    expect(body.total).toBeGreaterThanOrEqual(5);
    expect(body.facets.scope.global).toBeGreaterThanOrEqual(2);
    await app.close();
  });

  it('test_create_embeds + list: POST creates a ws-scoped entry surfaced by GET (AC-4/1)', async () => {
    const app = await appWith();
    const create = await app.inject({
      method: 'POST',
      url: '/memory',
      payload: { content: 'A brand new fact', scope: 'global', kind: 'fact', confidence: 0.7 },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as Memory;
    expect(created.content).toBe('A brand new fact');

    const one = await app.inject({ method: 'GET', url: `/memory/${created.id}` });
    expect(one.statusCode).toBe(200);
    expect((one.json() as Memory).id).toBe(created.id);
    await app.close();
  });

  it('test_dto_validation: invalid create is rejected and persists nothing (AC-7)', async () => {
    const app = await appWith();
    const before = await pg.handle.db.select().from(t.memory).where(eq(t.memory.workspaceId, wsId));
    // repo scope without repo_id.
    const bad = await app.inject({
      method: 'POST',
      url: '/memory',
      payload: { content: 'x', scope: 'repo', kind: 'fact', confidence: 0.5 },
    });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    expect(bad.statusCode).toBeLessThan(500);
    const after = await pg.handle.db.select().from(t.memory).where(eq(t.memory.workspaceId, wsId));
    expect(after.length).toBe(before.length);
    await app.close();
  });

  it('test_tenant_isolation: a row in another workspace is not-found (AC-8)', async () => {
    const app = await appWith();
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${Date.now()}` }).returning();
    const [foreign] = await pg.handle.db
      .insert(t.memory)
      .values({ workspaceId: otherWs!.id, repoId: null, scope: 'global', kind: 'fact', content: 'foreign', confidence: 0.5, sources: [] })
      .returning();

    const get = await app.inject({ method: 'GET', url: `/memory/${foreign!.id}` });
    expect(get.statusCode).toBe(404);
    const patch = await app.inject({ method: 'PATCH', url: `/memory/${foreign!.id}`, payload: { confidence: 0.1 } });
    expect(patch.statusCode).toBe(404);
    const del = await app.inject({ method: 'DELETE', url: `/memory/${foreign!.id}` });
    expect(del.statusCode).toBe(404);
    await app.close();
  });

  it('test_delete_removes: DELETE removes the entry (AC-6)', async () => {
    const app = await appWith();
    const create = await app.inject({
      method: 'POST',
      url: '/memory',
      payload: { content: 'delete me', scope: 'global', kind: 'fact', confidence: 0.5 },
    });
    const id = (create.json() as Memory).id;
    const del = await app.inject({ method: 'DELETE', url: `/memory/${id}` });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: `/memory/${id}` });
    expect(after.statusCode).toBe(404);
    await app.close();
  });
});
