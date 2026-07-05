/**
 * Phase 3 (Onboarding Generator) — route integration tests (DB-backed).
 *
 * Real Postgres via startPg()+seed(), buildApp() with a mock repoIntel facade
 * and a mock openrouter LLM injected through ContainerOverrides. Covers:
 *   - T12/T6 GET empty → tour:null + meta (0 LLM); POST generate → persists;
 *            GET after generate returns the stored seven-section tour.
 *   - T13    GET + POST deny cross-workspace access (repo resolved workspace-scoped).
 *   - open   opening the page (GET) makes ZERO LLM calls.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { LLMProvider, StructuredRequest, StructuredResult, ModelInfo } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import { SECTION_KINDS } from '../src/modules/onboarding-generator/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[onboarding-generator] Docker not available — skipping integration tests.');
}

/** A stub RepoIntel: healthy, deterministic reads; counts nothing LLM-ish. */
function stubRepoIntel(): RepoIntel {
  const now = new Date('2026-07-05T09:00:00.000Z');
  return {
    getIndexState: async () => ({
      repoId: 'x',
      status: 'full',
      filesIndexed: 17,
      filesSkipped: 0,
      durationMs: 1,
      lastIndexedSha: 'sha',
      indexerVersion: 1,
      updatedAt: now,
    }),
    getRepoMap: async () => ({ text: 'src/app.ts\nsrc/db.ts', tokens: 8, cached: true }),
    getTopFilesByRank: async () => ['src/app.ts', 'src/db.ts'],
    getCriticalPaths: async () => [['src/app.ts', 'src/db.ts']],
    getFileRank: async () => [
      { path: 'src/app.ts', percentile: 95 },
      { path: 'src/db.ts', percentile: 80 },
    ],
  } as unknown as RepoIntel;
}

/** A mock openrouter LLM returning a valid seven-section document; call-counted. */
function stubLlm() {
  let calls = 0;
  const provider: LLMProvider = {
    id: 'openrouter',
    listModels: async (): Promise<ModelInfo[]> => [],
    complete: async () => ({ text: '', model: 'm', tokensIn: 0, tokensOut: 0, costUsd: 0 }),
    completeStructured: async <T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> => {
      calls += 1;
      const doc = {
        sections: SECTION_KINDS.map((kind) => ({
          kind,
          title: `${kind}`,
          body: `# ${kind}`,
          diagram: kind === 'architecture' ? 'flowchart LR\n A --> B' : null,
          links: [],
        })),
      };
      const parsed = req.schema.safeParse(doc);
      if (!parsed.success) throw new Error(parsed.error.message);
      return {
        data: parsed.data,
        model: req.model,
        tokensIn: 100,
        tokensOut: 200,
        costUsd: 0.001,
        raw: JSON.stringify(doc),
        attempts: 1,
      };
    },
    embed: async () => [],
  } as unknown as LLMProvider;
  return { provider, getCalls: () => calls };
}

d('onboarding-generator routes + scoping', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(llm: LLMProvider) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        github: new MockGitHubClient(),
        repoIntel: stubRepoIntel(),
        llm: { openrouter: llm },
      },
    });
  }

  async function seedRepo(owner: string, name: string, workspaceName = 'default') {
    const db = pg.handle.db;
    let [ws] = await db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, workspaceName));
    if (!ws) {
      [ws] = await db
        .insert(t.workspaces)
        .values({ name: workspaceName })
        .returning({ id: t.workspaces.id });
    }
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws!.id, owner, name, fullName: `${owner}/${name}` })
      .returning();
    return { workspaceId: ws!.id, repo: repo! };
  }

  it('GET empty → tour:null + index meta, ZERO LLM calls (T12, AC-6, AC-22)', async () => {
    const { repo } = await seedRepo('ivy', 'onb-empty');
    const { provider, getCalls } = stubLlm();
    const app = await makeApp(provider);

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding-tour` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tour: unknown;
      meta: { filesIndexed: number; generatedAt: string | null; degraded: boolean };
    };
    expect(body.tour).toBeNull();
    expect(body.meta.filesIndexed).toBe(17);
    expect(body.meta.generatedAt).toBeNull();
    expect(body.meta.degraded).toBe(false);
    expect(getCalls()).toBe(0);
    await app.close();
  });

  it('POST generate persists a seven-section tour; GET returns it (T6, AC-1, AC-2)', async () => {
    const { repo } = await seedRepo('ivy', 'onb-gen');
    const { provider, getCalls } = stubLlm();
    const app = await makeApp(provider);

    const gen = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/onboarding-tour/generate`,
    });
    expect(gen.statusCode).toBe(200);
    const genBody = gen.json() as { tour: { sections: { kind: string; diagram: string | null }[] } };
    expect(genBody.tour.sections.map((s) => s.kind)).toEqual([...SECTION_KINDS]);
    // Diagram only on architecture (AC-5).
    for (const s of genBody.tour.sections) {
      if (s.kind === 'architecture') expect(s.diagram).toBeTruthy();
      else expect(s.diagram).toBeNull();
    }
    expect(getCalls()).toBe(1); // EXACTLY one LLM call

    // GET now returns the stored tour with a generatedAt, still no extra LLM call.
    const get = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding-tour` });
    const getBody = get.json() as { tour: unknown; meta: { generatedAt: string | null } };
    expect(getBody.tour).not.toBeNull();
    expect(getBody.meta.generatedAt).not.toBeNull();
    expect(getCalls()).toBe(1); // GET added no call
    await app.close();
  });

  it('POST generate again OVERWRITES the prior tour (AC-2)', async () => {
    const { repo } = await seedRepo('ivy', 'onb-overwrite');
    const { provider, getCalls } = stubLlm();
    const app = await makeApp(provider);

    await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding-tour/generate` });
    const first = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding-tour` });
    const firstGen = (first.json() as { meta: { generatedAt: string } }).meta.generatedAt;

    await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding-tour/generate` });
    const second = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding-tour` });
    const secondGen = (second.json() as { meta: { generatedAt: string } }).meta.generatedAt;

    // Two generations, one stored row per repo (PK repoId) → re-stamped generatedAt.
    expect(getCalls()).toBe(2);
    expect(new Date(secondGen).getTime()).toBeGreaterThanOrEqual(new Date(firstGen).getTime());
    await app.close();
  });

  it('denies cross-workspace access: GET + POST on a foreign repo 404 (T13, AC-20)', async () => {
    const { repo } = await seedRepo('ivy', 'onb-foreign', 'tenant-b');
    const { provider, getCalls } = stubLlm();
    const app = await makeApp(provider);

    const get = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding-tour` });
    expect(get.statusCode).toBe(404);

    const post = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/onboarding-tour/generate`,
    });
    expect(post.statusCode).toBe(404);
    // A denied generate never reaches the model.
    expect(getCalls()).toBe(0);
    await app.close();
  });
});
