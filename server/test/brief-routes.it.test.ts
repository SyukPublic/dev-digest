/**
 * Phase 4 (T14 int, T15, T16) — brief route integration tests (DB-backed).
 *
 * Real Postgres via startPg()+seed(), buildApp() with a mock repoIntel facade,
 * a mock GitHub client, and a mock openrouter LLM injected through
 * ContainerOverrides. Covers:
 *   T14  GET empty → null + ZERO LLM calls; POST generate persists; GET after
 *        generate returns the stored brief, still 0 LLM (AC-8, AC-19).
 *   T15  GET + POST deny cross-workspace access (PR resolved workspace-scoped;
 *        the guard runs BEFORE single-flight coalescing) (AC-16).
 *   T16  Regenerate recomputes ONLY the brief and never creates a review run
 *        (no `reviews` row appears) (AC-9).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { LLMProvider, StructuredRequest, StructuredResult, ModelInfo } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[brief-routes] Docker not available — skipping integration tests.');
}

/** A stub RepoIntel: healthy, deterministic reads; makes no LLM/embedding call. */
function stubRepoIntel(): RepoIntel {
  const now = new Date('2026-07-05T09:00:00.000Z');
  return {
    getIndexState: async () => ({
      repoId: 'x',
      status: 'full',
      filesIndexed: 3,
      filesSkipped: 0,
      durationMs: 1,
      lastIndexedSha: 'sha',
      indexerVersion: 1,
      updatedAt: now,
      indexedBranch: 'main',
    }),
    getBlastRadius: async () => ({
      changedSymbols: [{ file: 'src/a.ts', name: 'alpha', kind: 'function' }],
      callers: [],
      impactedEndpoints: [],
    }),
  } as unknown as RepoIntel;
}

/**
 * A schema-aware mock openrouter LLM. Returns a valid `Brief` for the brief call
 * and a `{ summary }` for the blast facade's own cheap-summary call (an existing,
 * separate concern — CP-4). We count the BRIEF-schema calls specifically so the
 * assertion targets the single brief generation, not the incidental blast prose.
 */
function stubLlm() {
  let briefCalls = 0;
  const provider: LLMProvider = {
    id: 'openrouter',
    listModels: async (): Promise<ModelInfo[]> => [],
    complete: async () => ({ text: '', model: 'm', tokensIn: 0, tokensOut: 0, costUsd: 0 }),
    completeStructured: async <T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> => {
      // The blast facade's own summary call — respond with a summary; not counted.
      if (req.schemaName !== 'Brief') {
        const summary = req.schema.safeParse({ summary: 'blast prose' });
        if (!summary.success) throw new Error(summary.error.message);
        return {
          data: summary.data,
          model: req.model,
          tokensIn: 1,
          tokensOut: 1,
          costUsd: 0,
          raw: '{}',
          attempts: 1,
        };
      }
      briefCalls += 1;
      const brief = {
        what: 'Adds a widget',
        why: 'Users asked for it',
        risk_level: 'medium',
        risks: [
          { kind: 'perf', title: 'N+1', explanation: 'loop', severity: 'high', file_refs: ['src/a.ts:1'] },
        ],
        review_focus: [{ path: 'src/a.ts', line: 1, reason: 'entry' }],
      };
      const parsed = req.schema.safeParse(brief);
      if (!parsed.success) throw new Error(parsed.error.message);
      return {
        data: parsed.data,
        model: req.model,
        tokensIn: 100,
        tokensOut: 200,
        costUsd: 0.001,
        raw: JSON.stringify(brief),
        attempts: 1,
      };
    },
    embed: async () => [],
  } as unknown as LLMProvider;
  return { provider, getCalls: () => briefCalls };
}

d('brief routes + scoping', () => {
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

  async function seedPr(name: string, workspaceName = 'default') {
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
      .values({ workspaceId: ws!.id, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws!.id,
        repoId: repo!.id,
        number: 7,
        title: 'Add the widget',
        author: 'dev',
        branch: 'feat/x',
        base: 'main',
        headSha: 'sha-1',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    // Seed one changed file so smart-diff/grounding have a real path.
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/a.ts',
      additions: 1,
      deletions: 0,
    });
    return { workspaceId: ws!.id, pr: pr! };
  }

  it('GET empty → null, ZERO LLM calls (T14, AC-8, AC-19)', async () => {
    const { pr } = await seedPr('brief-empty');
    const { provider, getCalls } = stubLlm();
    const app = await makeApp(provider);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
    expect(getCalls()).toBe(0);
    await app.close();
  });

  it('POST generate persists a grounded brief; GET returns it, still 0 extra LLM (T14)', async () => {
    const { pr } = await seedPr('brief-gen');
    const { provider, getCalls } = stubLlm();
    const app = await makeApp(provider);

    const gen = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(gen.statusCode).toBe(200);
    const genBody = gen.json() as {
      pr_id: string;
      what: string;
      is_stale?: boolean;
      risks: { file_refs: string[] }[];
      review_focus: { path: string }[];
    };
    expect(genBody.pr_id).toBe(pr.id);
    expect(genBody.what).toBe('Adds a widget');
    expect(genBody.is_stale).toBe(false);
    // src/a.ts is a real path (changed_symbols + pr_files) → kept.
    expect(genBody.risks[0]!.file_refs).toEqual(['src/a.ts:1']);
    expect(genBody.review_focus[0]!.path).toBe('src/a.ts');
    expect(getCalls()).toBe(1); // EXACTLY one LLM call

    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    const getBody = get.json() as { pr_id: string; is_stale: boolean };
    expect(getBody.pr_id).toBe(pr.id);
    expect(getBody.is_stale).toBe(false);
    expect(getCalls()).toBe(1); // GET added no call
    await app.close();
  });

  it('denies cross-workspace access: GET + POST on a foreign PR 404 (T15, AC-16)', async () => {
    const { pr } = await seedPr('brief-foreign', 'tenant-b');
    const { provider, getCalls } = stubLlm();
    const app = await makeApp(provider);

    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(get.statusCode).toBe(404);

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(post.statusCode).toBe(404);
    // A denied generate never reaches the model (guard BEFORE coalesce).
    expect(getCalls()).toBe(0);
    await app.close();
  });

  it('regenerate never creates a review run (T16, AC-9)', async () => {
    const { pr } = await seedPr('brief-no-review');
    const { provider } = stubLlm();
    const app = await makeApp(provider);

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });

    // No `reviews` row was created for this PR by generating the brief.
    const reviews = await pg.handle.db
      .select()
      .from(t.reviews)
      .where(and(eq(t.reviews.prId, pr.id)));
    expect(reviews).toHaveLength(0);
    await app.close();
  });
});
