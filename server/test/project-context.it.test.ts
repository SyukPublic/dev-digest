import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  GitClient,
  RepoRef,
  CloneOptions,
  UnifiedDiff,
  BlameLine,
  GitCommit,
} from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context] Docker not available — skipping integration tests.');
}

/**
 * Phase 1 integration: the discover endpoint over a REAL fixture clone + the
 * AC-20 workspace scoping. A fs-backed git client points `clonePathFor` at a
 * temp dir seeded with markdown so the walker reads real files through the DI
 * container (MockGitClient reads an in-memory map and can't be walked).
 */

/** Minimal fs-backed GitClient: clonePathFor → a real dir keyed by owner/name. */
class FsGitClient implements GitClient {
  constructor(private roots: Record<string, string>) {}
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
    return 'HEAD';
  }
  async diff(): Promise<UnifiedDiff> {
    return { files: [] };
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

d('project-context discover + scoping', () => {
  let pg: PgFixture;
  let cloneDir: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);

    cloneDir = await mkdtemp(join(tmpdir(), 'pc-it-'));
    await mkdir(join(cloneDir, 'specs'), { recursive: true });
    await mkdir(join(cloneDir, 'docs', 'nested'), { recursive: true });
    await writeFile(join(cloneDir, 'specs', 'goal.md'), '# Goal\nship it', 'utf8');
    await writeFile(join(cloneDir, 'docs', 'nested', 'design.md'), '# Design', 'utf8');
    await writeFile(join(cloneDir, 'README.md'), '# top', 'utf8'); // not under a root
  });
  afterAll(async () => {
    await rm(cloneDir, { recursive: true, force: true });
    await pg?.stop();
  });

  function makeApp(gitRoots: Record<string, string>) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new FsGitClient(gitRoots), github: new MockGitHubClient() },
    });
  }

  /** Resolve the default workspace id + create a repo row we control. */
  async function seedRepo(owner: string, name: string, workspaceName = 'default') {
    const db = pg.handle.db;
    let [ws] = await db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, workspaceName));
    if (!ws) {
      [ws] = await db.insert(t.workspaces).values({ name: workspaceName }).returning({ id: t.workspaces.id });
    }
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws!.id, owner, name, fullName: `${owner}/${name}` })
      .returning();
    return { workspaceId: ws!.id, repo: repo! };
  }

  it('discovers ONLY markdown under configured roots, with tokens (T1, AC-1)', async () => {
    const { repo } = await seedRepo('ivy', 'ctx-a');
    const app = await makeApp({ 'ivy/ctx-a': cloneDir });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/project-context`,
    });
    expect(res.statusCode).toBe(200);
    const docs = res.json() as { path: string; folder_type: string; tokens: number }[];
    const paths = docs.map((x) => x.path).sort();
    expect(paths).toEqual(['docs/nested/design.md', 'specs/goal.md']);
    expect(paths).not.toContain('README.md');
    const goal = docs.find((x) => x.path === 'specs/goal.md')!;
    expect(goal.folder_type).toBe('specs');
    expect(goal.tokens).toBeGreaterThan(0);
    await app.close();
  });

  it('content endpoint returns raw markdown + tokens (T2, AC-2, AC-8)', async () => {
    const { repo } = await seedRepo('ivy', 'ctx-b');
    const app = await makeApp({ 'ivy/ctx-b': cloneDir });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/project-context/content?path=specs/goal.md`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { content: string; tokens: number; folder_type: string };
    expect(body.content).toBe('# Goal\nship it');
    expect(body.tokens).toBeGreaterThan(0);
    expect(body.folder_type).toBe('specs');
    await app.close();
  });

  it('rejects a path-traversal read at the service before touching fs (T3, AC-22)', async () => {
    const { repo } = await seedRepo('ivy', 'ctx-c');
    const app = await makeApp({ 'ivy/ctx-c': cloneDir });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/project-context/content?path=${encodeURIComponent('../../etc/passwd')}`,
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('degrades to an empty list when the clone is absent (T1, AC-16)', async () => {
    const { repo } = await seedRepo('ivy', 'ctx-empty');
    // Point the git client at a dir that does not exist.
    const app = await makeApp({ 'ivy/ctx-empty': join(cloneDir, 'ghost') });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/project-context`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it('denies cross-workspace access: a repo in another workspace 404s (T4, AC-20)', async () => {
    // Repo lives in "tenant-b"; the request context is the default workspace.
    const { repo } = await seedRepo('ivy', 'ctx-foreign', 'tenant-b');
    const app = await makeApp({ 'ivy/ctx-foreign': cloneDir });

    const discover = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/project-context`,
    });
    expect(discover.statusCode).toBe(404);

    const content = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/project-context/content?path=specs/goal.md`,
    });
    expect(content.statusCode).toBe(404);
    await app.close();
  });
});

// ---- T5: config keys load (no DB) ------------------------------------------
describe('project-context config keys (T5, AC-1, AC-14)', () => {
  it('defaults are populated on AppConfig', () => {
    const cfg = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    expect(cfg.projectContextTokenBudget).toBe(20_000);
    expect(cfg.projectContextFileHardCapBytes).toBe(256 * 1024);
    expect(cfg.projectContextRoots).toEqual(['specs', 'docs', 'insights']);
  });

  it('env overrides parse: budget/cap coerce to int, roots split + dedup', () => {
    const cfg = loadConfig({
      NODE_ENV: 'test',
      PROJECT_CONTEXT_TOKEN_BUDGET: '5000',
      PROJECT_CONTEXT_FILE_HARD_CAP_BYTES: '1024',
      PROJECT_CONTEXT_ROOTS: 'specs, docs , specs, adr',
    } as NodeJS.ProcessEnv);
    expect(cfg.projectContextTokenBudget).toBe(5000);
    expect(cfg.projectContextFileHardCapBytes).toBe(1024);
    expect(cfg.projectContextRoots).toEqual(['specs', 'docs', 'adr']);
  });
});
