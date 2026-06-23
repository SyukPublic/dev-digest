import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import type { SkillImporter } from '../src/adapters/skill-import/index.js';
import { SkillsService } from '../src/modules/skills/service.js';
import type { Container } from '../src/platform/container.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/** A deterministic importer so the import-preview path needs no network/fs. */
const mockImporter: SkillImporter = {
  fetchUrl: async () => '# Imported Rule\nAlways use async/await.',
  extractFromArchive: async () => ({ body: '# Zip Rule\nNo then-chains.', entry: 'SKILL.md' }),
};

d('Skills module', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient(), skillImporter: mockImporter },
    });
  }

  const createBody = { name: 'house-rule', type: 'convention' as const, body: '# Rule\nDo X.' };

  it('creates a manual skill (v1, enabled) and lists it', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/skills', payload: createBody });
    expect(created.statusCode).toBe(201);
    const skill = created.json();
    expect(skill).toMatchObject({ name: 'house-rule', type: 'convention', source: 'manual', version: 1, enabled: true });

    const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(list.some((s: { id: string }) => s.id === skill.id)).toBe(true);
    await app.close();
  });

  it('a body change bumps the version (v2); toggling enabled does NOT', async () => {
    const app = await makeApp();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload: createBody })).json().id as string;

    const bumped = await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: '# Rule\nDo Y.' } });
    expect(bumped.json().version).toBe(2);

    await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { enabled: false } });
    const after = (await app.inject({ method: 'GET', url: `/skills/${id}` })).json();
    expect(after.version).toBe(2);
    expect(after.enabled).toBe(false);

    const versions = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    await app.close();
  });

  it('import returns an UNSAVED preview; saving it lands disabled-until-vetted', async () => {
    const app = await makeApp();
    const before = (await app.inject({ method: 'GET', url: '/skills' })).json().length;

    const preview = await app.inject({
      method: 'POST',
      url: '/skills/import',
      payload: { kind: 'url', url: 'https://example.com/skill.md' },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ source: 'imported_url', name: 'imported-rule' });
    // Nothing persisted by the preview step.
    expect((await app.inject({ method: 'GET', url: '/skills' })).json().length).toBe(before);

    const saved = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { ...preview.json(), enabled: undefined },
    });
    expect(saved.json().enabled).toBe(false); // imported → disabled by default
    await app.close();
  });

  it('deletes a skill (404 afterwards)', async () => {
    const app = await makeApp();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload: createBody })).json().id as string;
    expect((await app.inject({ method: 'DELETE', url: `/skills/${id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/skills/${id}` })).statusCode).toBe(404);
    await app.close();
  });

  it('is workspace-scoped: another tenant cannot read a skill', async () => {
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-skills' }).returning();
    const service = new SkillsService({ db } as unknown as Container);
    const foreign = await service.create(otherWs!.id, { name: 'foreign', type: 'custom', body: '# x' });

    const [{ id: defaultWs }] = await db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));

    expect(await service.get(otherWs!.id, foreign.id)).toBeTruthy();
    expect(await service.get(defaultWs!, foreign.id)).toBeUndefined();
    expect(await service.listVersions(defaultWs!, foreign.id)).toBeUndefined();
  });
});
