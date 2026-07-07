import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  GitClient,
  RepoRef,
  UnifiedDiff,
  BlameLine,
  GitCommit,
} from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context-attach] Docker not available — skipping integration tests.');
}

/**
 * Phase 4 integration: attach persistence (T9), skill inheritance in a run
 * (T11), best-effort skip cases (T12/13/14), the completed-run trace
 * (T15/T16), and the byte-identical-prompt guarantee when no doc is attached.
 *
 * A fs-backed git client points `clonePathFor` at a temp dir seeded with real
 * markdown so the walker + run-time read touch actual files; `readFile` uses the
 * same 'utf8' decode as the production adapter (an invalid byte → U+FFFD), so
 * the non-UTF-8 skip path is exercised faithfully.
 */

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'ok',
  score: 90,
  findings: [
    {
      id: 'f1',
      severity: 'WARNING',
      category: 'bug',
      title: 'note',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'line 11 changed',
      confidence: 0.8,
      kind: 'finding',
    },
  ],
};

class FsGitClient implements GitClient {
  constructor(private roots: Record<string, string>, private diff: string) {}
  clonePathFor(repo: RepoRef): string {
    return this.roots[`${repo.owner}/${repo.name}`] ?? join(tmpdir(), 'pc-nonexistent');
  }
  async readFile(repo: RepoRef, path: string): Promise<string> {
    return readFile(join(this.clonePathFor(repo), path), 'utf8');
  }
  async clone(repo: RepoRef): Promise<{ path: string }> {
    return { path: this.clonePathFor(repo) };
  }
  async fetchPullHead(): Promise<void> {}
  async sync(): Promise<{ head: string }> {
    return { head: 'HEAD' };
  }
  async currentHead(): Promise<string> {
    return 'a1b2c3d4';
  }
  async diff(): Promise<UnifiedDiff> {
    const { parseUnifiedDiff } = await import('../src/lib/diff-parser.js');
    return parseUnifiedDiff(this.diff);
  }
  async diffNameOnly(): Promise<string[]> {
    return [];
  }
  async blame(): Promise<BlameLine[]> {
    return [];
  }
  async log(): Promise<GitCommit[]> {
    return [];
  }
}

d('project-context attach + run wiring', () => {
  let pg: PgFixture;
  let cloneDir: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);

    cloneDir = await mkdtemp(join(tmpdir(), 'pc-attach-'));
    await mkdir(join(cloneDir, 'specs'), { recursive: true });
    await mkdir(join(cloneDir, 'docs'), { recursive: true });
    await writeFile(join(cloneDir, 'specs', 'goal.md'), '# Goal\nship the thing', 'utf8');
    await writeFile(join(cloneDir, 'docs', 'design.md'), '# Design\nlayers', 'utf8');
    await writeFile(join(cloneDir, 'docs', 'skill.md'), '# Skill doc\nrules', 'utf8');
    // Non-UTF-8 file: raw bytes with an invalid continuation → 'utf8' read yields U+FFFD.
    await writeFile(join(cloneDir, 'docs', 'binary.md'), Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x00, 0x80]));
    // Over-cap file: bigger than the (tiny) test hard cap.
    await writeFile(join(cloneDir, 'docs', 'huge.md'), '#'.repeat(5000), 'utf8');
  });
  afterAll(async () => {
    await rm(cloneDir, { recursive: true, force: true });
    await pg?.stop();
  });

  function makeApp(
    gitRoots: Record<string, string>,
    extraEnv: NodeJS.ProcessEnv = {},
    llmProvider: MockLLMProvider = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }),
  ) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test', ...extraEnv } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new FsGitClient(gitRoots, DIFF),
        github: new MockGitHubClient(),
        llm: { openai: llmProvider },
      },
    });
  }

  async function workspace(name = 'default'): Promise<string> {
    const db = pg.handle.db;
    let [ws] = await db.select({ id: t.workspaces.id }).from(t.workspaces).where(eq(t.workspaces.name, name));
    if (!ws) {
      [ws] = await db.insert(t.workspaces).values({ name }).returning({ id: t.workspaces.id });
    }
    return ws!.id;
  }

  async function seedRepo(workspaceId: string, owner: string, name: string) {
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner, name, fullName: `${owner}/${name}` })
      .returning();
    return repo!;
  }

  async function seedPr(workspaceId: string, repoId: string) {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 7,
        title: 'PR',
        author: 'dev',
        branch: 'feat/x',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return pr!;
  }

  async function createAgent(app: Awaited<ReturnType<typeof makeApp>>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'rev' },
    });
    return res.json() as { id: string };
  }

  async function createSkill(app: Awaited<ReturnType<typeof makeApp>>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name, description: 'd', type: 'convention', body: 'skill body' },
    });
    return res.json() as { id: string };
  }

  // ---- T9: attach/reorder persists ordered PATHS; detach removes -----------

  it('agent attach persists ordered paths, reorders, and detaches (T9, AC-5)', async () => {
    const ws = await workspace();
    const app = await makeApp({});
    const agent = await createAgent(app, 'AttachAgent');

    // Attach two docs.
    let res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/specs`,
      payload: { paths: ['specs/goal.md', 'docs/design.md'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { path: 'specs/goal.md', order: 0 },
      { path: 'docs/design.md', order: 1 },
    ]);

    // GET returns the same ordered set.
    res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/specs` });
    expect(res.json()).toEqual([
      { path: 'specs/goal.md', order: 0 },
      { path: 'docs/design.md', order: 1 },
    ]);

    // Reorder (swap).
    res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/specs`,
      payload: { paths: ['docs/design.md', 'specs/goal.md'] },
    });
    expect(res.json()).toEqual([
      { path: 'docs/design.md', order: 0 },
      { path: 'specs/goal.md', order: 1 },
    ]);

    // Detach-all with an empty set.
    res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/specs`, payload: { paths: [] } });
    expect(res.json()).toEqual([]);

    // Only the PATH is stored (never doc text) — assert the row shape (AC-5).
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/specs`,
      payload: { paths: ['specs/goal.md'] },
    });
    const rows = await pg.handle.db
      .select()
      .from(t.agentSpecs)
      .where(eq(t.agentSpecs.agentId, agent.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.path).toBe('specs/goal.md');
    expect(rows[0]!.workspaceId).toBe(ws);
    expect(Object.keys(rows[0]!)).not.toContain('content');
    expect(Object.keys(rows[0]!)).not.toContain('text');
    await app.close();
  });

  // ---- Concurrency: atomic transactional upsert converges, never 23505 -----
  //
  // Regression guard for the attach race (docs/plans/project-context-attach-race-fix.md,
  // AC-2): two identical setters racing MUST both settle fulfilled (the
  // onConflictDoUpdate upsert converges the losing writer instead of raising a
  // duplicate-key), and the final ordered set must be exactly the intended one.

  it('two concurrent identical setAgentSpecs both settle without a 23505 duplicate key (AC-2)', async () => {
    const ws = await workspace();
    const app = await makeApp({});
    const agent = await createAgent(app, 'ConcurrentAgent');
    const repo = app.container.projectContextRepo;
    const paths = ['specs/goal.md', 'docs/design.md'];

    const results = await Promise.allSettled([
      repo.setAgentSpecs(ws, agent.id, paths),
      repo.setAgentSpecs(ws, agent.id, paths),
    ]);
    // Both writers converge — neither raises 23505 / 500.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    // Final ordered set matches the intended attachment.
    const final = await repo.attachedSpecsForAgent(ws, agent.id);
    expect(final).toEqual([
      { path: 'specs/goal.md', order: 0 },
      { path: 'docs/design.md', order: 1 },
    ]);
    const rows = await pg.handle.db
      .select({ path: t.agentSpecs.path, order: t.agentSpecs.order })
      .from(t.agentSpecs)
      .where(eq(t.agentSpecs.agentId, agent.id));
    expect(rows).toHaveLength(2);
    await app.close();
  });

  it('two concurrent identical setSkillSpecs both settle without a 23505 duplicate key (AC-2)', async () => {
    const ws = await workspace();
    const app = await makeApp({});
    const skill = await createSkill(app, 'ConcurrentSkill');
    const repo = app.container.projectContextRepo;
    const paths = ['docs/skill.md'];

    const results = await Promise.allSettled([
      repo.setSkillSpecs(ws, skill.id, paths),
      repo.setSkillSpecs(ws, skill.id, paths),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const final = await repo.attachedSpecsForSkill(ws, skill.id);
    expect(final).toEqual([{ path: 'docs/skill.md', order: 0 }]);
    await app.close();
  });

  it('rejects a traversal path on attach (AC-22), never persists it', async () => {
    const app = await makeApp({});
    const agent = await createAgent(app, 'TraversalAgent');
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/specs`,
      payload: { paths: ['../../etc/passwd'] },
    });
    expect(res.statusCode).toBe(422);
    const rows = await pg.handle.db.select().from(t.agentSpecs).where(eq(t.agentSpecs.agentId, agent.id));
    expect(rows).toHaveLength(0);
    await app.close();
  });

  it('skill attach persists + reads back ordered (T9, AC-5)', async () => {
    const app = await makeApp({});
    const skill = await createSkill(app, 'AttachSkill');
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/specs`,
      payload: { paths: ['docs/skill.md'] },
    });
    expect(res.json()).toEqual([{ path: 'docs/skill.md', order: 0 }]);
    const get = await app.inject({ method: 'GET', url: `/skills/${skill.id}/specs` });
    expect(get.json()).toEqual([{ path: 'docs/skill.md', order: 0 }]);
    await app.close();
  });

  // ---- AC-3 regression: setSkillSpecs preserves the same replace-set
  // semantics as setAgentSpecs — present paths get `order = index`, a reorder
  // reassigns order, an empty-array call detaches everything, and the method
  // returns the fresh ordered set. The pre-existing "skill attach persists +
  // reads back ordered" test above only exercises a single attach + GET; it
  // does not exercise reorder or detach on the SKILL setter (unlike the
  // symmetric agent T9 test), so this closes that gap for AC-3 / T5.
  it('skill attach reorders and detaches, preserving setSkillSpecs semantics (AC-3)', async () => {
    const ws = await workspace();
    const app = await makeApp({});
    const skill = await createSkill(app, 'ReorderDetachSkill');

    // Attach two docs — order = index.
    let res = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/specs`,
      payload: { paths: ['docs/skill.md', 'specs/goal.md'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { path: 'docs/skill.md', order: 0 },
      { path: 'specs/goal.md', order: 1 },
    ]);

    // Reorder (swap) — order is reassigned to the new index.
    res = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/specs`,
      payload: { paths: ['specs/goal.md', 'docs/skill.md'] },
    });
    expect(res.json()).toEqual([
      { path: 'specs/goal.md', order: 0 },
      { path: 'docs/skill.md', order: 1 },
    ]);

    // Detach-all with an empty set — the fresh (empty) ordered set is returned.
    res = await app.inject({ method: 'POST', url: `/skills/${skill.id}/specs`, payload: { paths: [] } });
    expect(res.json()).toEqual([]);
    const afterDetach = await pg.handle.db
      .select()
      .from(t.skillSpecs)
      .where(eq(t.skillSpecs.skillId, skill.id));
    expect(afterDetach).toHaveLength(0);

    // Re-attach one path — only PATH is stored (never doc text), workspace-scoped.
    await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/specs`,
      payload: { paths: ['docs/skill.md'] },
    });
    const rows = await pg.handle.db
      .select()
      .from(t.skillSpecs)
      .where(eq(t.skillSpecs.skillId, skill.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.path).toBe('docs/skill.md');
    expect(rows[0]!.workspaceId).toBe(ws);
    expect(Object.keys(rows[0]!)).not.toContain('content');
    expect(Object.keys(rows[0]!)).not.toContain('text');
    await app.close();
  });

  // ---- T4/AC-20: attach endpoints deny cross-workspace --------------------

  it('attach on a foreign-workspace agent 404s (AC-20)', async () => {
    const foreignWs = await workspace('tenant-x');
    const [foreignAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: foreignWs,
        name: 'Foreign',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 's',
        version: 1,
      })
      .returning();
    const app = await makeApp({});
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${foreignAgent!.id}/specs`,
      payload: { paths: ['specs/goal.md'] },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  // ---- T11: skill inheritance in a run ------------------------------------

  it('a skill-attached doc is inherited by an agent using that skill on a run (T11, AC-7)', async () => {
    const ws = await workspace();
    const app = await makeApp({ 'acme/inherit': cloneDir });
    const repo = await seedRepo(ws, 'acme', 'inherit');
    const pr = await seedPr(ws, repo.id);

    const skill = await createSkill(app, 'InheritSkill');
    await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/specs`,
      payload: { paths: ['docs/skill.md'] },
    });
    const agent = await createAgent(app, 'InheritAgent');
    // Attach an agent doc AND link the skill → merged: agent doc first, skill next.
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/specs`,
      payload: { paths: ['specs/goal.md'] },
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    const run = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = run.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    // AC-6/AC-7: agent-attached first, then skill-inherited.
    expect(trace.specs_read).toEqual(['specs/goal.md', 'docs/skill.md']);
    // The injected block includes both doc bodies, wrapped as untrusted.
    expect(trace.prompt_assembly.specs).toContain('ship the thing');
    expect(trace.prompt_assembly.specs).toContain('rules');
    await app.close();
  });

  // ---- AC-23: zero LLM/embedding calls in the discover/attach/run-wiring path
  //
  // Unit under test: the project-context discover + attach + run-executor
  // wiring, end-to-end through a real review run.
  // Input: two discover calls, an attach (2 paths), a skill attach + link, and
  // one full PR review run against an agent with 2 merged specs attached.
  // Stub: a single shared MockLLMProvider instance tracks every provider call
  // it receives (`.calls`) — `complete`/`completeStructured`/`embed`/`listModels`.
  // Expected output: after discover/attach/run, the ONLY provider call is
  // exactly one `completeStructured` (the review itself, single-pass); zero
  // `embed` calls occurred — proving the specs discovery/read/merge/trace path
  // never reaches an LLM or embedding adapter on its own.
  it('discover + attach + a full run make zero embedding calls and exactly one review LLM call (AC-23)', async () => {
    const ws = await workspace();
    const llmProvider = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await makeApp({ 'acme/zero-llm': cloneDir }, {}, llmProvider);
    const repo = await seedRepo(ws, 'acme', 'zero-llm');
    const pr = await seedPr(ws, repo.id);

    // Discovery + content reads (producer side) — must not touch the LLM at all.
    await app.inject({ method: 'GET', url: `/repos/${repo.id}/project-context` });
    await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/project-context/content?path=specs/goal.md`,
    });
    expect(llmProvider.calls).toHaveLength(0);

    const skill = await createSkill(app, 'ZeroLlmSkill');
    await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/specs`,
      payload: { paths: ['docs/skill.md'] },
    });
    const agent = await createAgent(app, 'ZeroLlmAgent');
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/specs`,
      payload: { paths: ['specs/goal.md', 'docs/design.md'] },
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });
    // Attach/reorder itself is pure persistence — still zero LLM calls.
    expect(llmProvider.calls).toHaveLength(0);

    const run = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = run.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // Sanity: the merged specs really were read + injected for this run.
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.specs_read).toEqual(['specs/goal.md', 'docs/design.md', 'docs/skill.md']);

    // The run itself calls the LLM exactly once (structured review), and the
    // specs pipeline never triggers a separate embedding/completion call.
    expect(llmProvider.calls.filter((c) => c.method === 'embed')).toHaveLength(0);
    expect(llmProvider.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(llmProvider.calls).toHaveLength(1);
    await app.close();
  });

  // ---- T12/T13/T14: best-effort skips continue the run --------------------

  it('dangling / non-UTF-8 / over-cap docs are skipped, run continues (T12/T13/T14)', async () => {
    const ws = await workspace();
    // Tiny hard cap so docs/huge.md (5000 bytes) is over it.
    const app = await makeApp({ 'acme/skips': cloneDir }, { PROJECT_CONTEXT_FILE_HARD_CAP_BYTES: '1024' });
    const repo = await seedRepo(ws, 'acme', 'skips');
    const pr = await seedPr(ws, repo.id);
    const agent = await createAgent(app, 'SkipAgent');
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/specs`,
      payload: {
        paths: [
          'specs/goal.md', // ok
          'docs/missing.md', // dangling
          'docs/binary.md', // non-UTF-8
          'docs/huge.md', // over cap
        ],
      },
    });

    const run = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = run.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // The run completed (skips never abort it).
    const [agentRun] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(agentRun!.status).toBe('done');

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    // Only the ok doc survived into specs_read.
    expect(trace.specs_read).toEqual(['specs/goal.md']);
    // The skips are recorded in the run log (AC-11/12/13 "recorded in trace/log").
    const logText = (trace.log as { msg: string }[]).map((l) => l.msg).join('\n');
    expect(logText).toContain('skipped docs/missing.md (dangling)');
    expect(logText).toContain('skipped docs/binary.md (non_utf8)');
    expect(logText).toContain('skipped docs/huge.md (over_cap)');
    await app.close();
  });

  // ---- T15/T16: completed-run trace records specs + tokens ----------------

  it('completed run trace records specs_read, specs text, tokens.specs and spec_tokens (T15/T16, AC-8/10)', async () => {
    const ws = await workspace();
    const app = await makeApp({ 'acme/trace': cloneDir });
    const repo = await seedRepo(ws, 'acme', 'trace');
    const pr = await seedPr(ws, repo.id);
    const agent = await createAgent(app, 'TraceAgent');
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/specs`,
      payload: { paths: ['specs/goal.md', 'docs/design.md'] },
    });

    const run = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = run.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.specs_read).toEqual(['specs/goal.md', 'docs/design.md']);
    expect(trace.prompt_assembly.specs).toBeTruthy();
    // tokens.specs is the whole-block count; spec_tokens is per-doc, in order.
    expect(trace.prompt_assembly.tokens.specs).toBeGreaterThan(0);
    const specTokens = trace.prompt_assembly.spec_tokens as { path: string; tokens: number }[];
    expect(specTokens.map((s) => s.path)).toEqual(['specs/goal.md', 'docs/design.md']);
    expect(specTokens.every((s) => s.tokens > 0)).toBe(true);
    await app.close();
  });

  // ---- Byte-identical prompt when no doc is attached (risk mitigation) -----

  it('no attached docs → specs null, no spec_tokens (byte-identical baseline)', async () => {
    const ws = await workspace();
    const app = await makeApp({ 'acme/none': cloneDir });
    const repo = await seedRepo(ws, 'acme', 'none');
    const pr = await seedPr(ws, repo.id);
    const agent = await createAgent(app, 'NoSpecsAgent');

    const run = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = run.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.specs_read).toEqual([]);
    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.prompt_assembly.spec_tokens ?? null).toBeNull();
    expect(trace.prompt_assembly.tokens.specs).toBeUndefined();
    await app.close();
  });

  // ---- AC-8 / AC-17: discover token counts + used_by_agents ----------------

  it('discover reports per-doc tokens and used_by_agents from merged context (T16, AC-8/17)', async () => {
    // Endpoints always resolve the DEFAULT workspace (getContext), and
    // used_by_agents is a workspace-wide count over every enabled agent's merged
    // context, so it accumulates as tests attach docs. Assert the DELTA a fresh
    // attach makes rather than an absolute count (test-order independent).
    const ws = await workspace();
    const app = await makeApp({ 'acme/discover': cloneDir });
    const repo = await seedRepo(ws, 'acme', 'discover');

    const before = (
      (await app.inject({ method: 'GET', url: `/repos/${repo.id}/project-context` })).json() as {
        path: string;
        used_by_agents: number;
      }[]
    ).find((x) => x.path === 'specs/goal.md')!.used_by_agents;

    const agent = await createAgent(app, 'DiscoverAgent');
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/specs`,
      payload: { paths: ['specs/goal.md'] },
    });

    const docs = (
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/project-context` })
    ).json() as { path: string; tokens: number; used_by_agents: number }[];
    const goal = docs.find((x) => x.path === 'specs/goal.md')!;
    expect(goal.tokens).toBeGreaterThan(0);
    // The new agent added exactly one to goal.md's merged-context count (AC-17).
    expect(goal.used_by_agents).toBe(before + 1);
    await app.close();
  });
});
