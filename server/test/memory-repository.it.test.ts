import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import * as t from '../src/db/schema.js';
import { MemoryRepository, type InsertMemory } from '../src/modules/memory/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[memory-repo] Docker not available — skipping.');

/** A 1536-dim one-hot vector — cosine 1.0 with the same index, 0.0 otherwise. */
function oneHot(idx: number): number[] {
  const v = new Array(1536).fill(0);
  v[idx] = 1;
  return v;
}

function row(over: Partial<InsertMemory> & Pick<InsertMemory, 'workspaceId'>): InsertMemory {
  return {
    repoId: null,
    scope: 'global',
    kind: 'fact',
    content: 'A memory entry',
    confidence: 0.9,
    sources: [],
    embedding: null,
    ...over,
  };
}

d('MemoryRepository (DB-backed)', () => {
  let pg: PgFixture;
  let wsId: string;
  let repoId: string;
  let otherRepoId: string;

  async function freshWorkspace(): Promise<{ wsId: string; repoId: string }> {
    const [ws] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `mem-${Date.now()}-${Math.random().toString(36).slice(2)}` })
      .returning();
    const [user] = await pg.handle.db
      .insert(t.users)
      .values({ email: `u-${Math.random().toString(36).slice(2)}@local`, name: 'U' })
      .returning();
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: ws!.id,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        createdBy: user!.id,
      })
      .returning();
    return { wsId: ws!.id, repoId: repo!.id };
  }

  beforeAll(async () => {
    pg = await startPg();
    const w = await freshWorkspace();
    wsId = w.wsId;
    repoId = w.repoId;
    const [otherRepo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: wsId, owner: 'acme', name: 'other', fullName: 'acme/other', defaultBranch: 'main', createdBy: null })
      .returning();
    otherRepoId = otherRepo!.id;
  });
  afterAll(async () => { await pg?.stop(); });

  it('test_list_scoped: repo-scoped rows only for the active repo; global/team always (AC-1)', async () => {
    const { wsId: ws, repoId: rid } = await freshWorkspace();
    const repo = new MemoryRepository(pg.handle.db);
    await repo.insert(row({ workspaceId: ws, repoId: rid, scope: 'repo', content: 'repo-active' }));
    await repo.insert(row({ workspaceId: ws, scope: 'global', content: 'global-1' }));
    await repo.insert(row({ workspaceId: ws, scope: 'team', content: 'team-1' }));
    const [otherRepo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name: 'x', fullName: 'acme/x', defaultBranch: 'main', createdBy: null })
      .returning();
    await repo.insert(row({ workspaceId: ws, repoId: otherRepo!.id, scope: 'repo', content: 'repo-other' }));

    const list = await repo.list(ws, { repoId: rid });
    const contents = list.map((r) => r.content);
    expect(contents).toEqual(expect.arrayContaining(['repo-active', 'global-1', 'team-1']));
    expect(contents).not.toContain('repo-other');

    // With NO active repo, repo-scoped rows are excluded entirely.
    const noRepo = await repo.list(ws, { repoId: null });
    expect(noRepo.map((r) => r.content)).toEqual(expect.arrayContaining(['global-1', 'team-1']));
    expect(noRepo.some((r) => r.scope === 'repo')).toBe(false);
  });

  it('test_filters_facets: scope/kind filters narrow the list; facet counts over the visible set (AC-2)', async () => {
    const { wsId: ws, repoId: rid } = await freshWorkspace();
    const repo = new MemoryRepository(pg.handle.db);
    await repo.insert(row({ workspaceId: ws, repoId: rid, scope: 'repo', kind: 'decision', content: 'd1' }));
    await repo.insert(row({ workspaceId: ws, scope: 'global', kind: 'convention', content: 'c1' }));
    await repo.insert(row({ workspaceId: ws, scope: 'global', kind: 'convention', content: 'c2' }));
    await repo.insert(row({ workspaceId: ws, scope: 'team', kind: 'preference', content: 'p1' }));

    const onlyGlobal = await repo.list(ws, { repoId: rid, scope: ['global'] });
    expect(onlyGlobal).toHaveLength(2);
    const onlyConvention = await repo.list(ws, { repoId: rid, kind: ['convention'] });
    expect(onlyConvention.every((r) => r.kind === 'convention')).toBe(true);

    const facets = await repo.countFacets(ws, rid);
    expect(facets.scope.repo).toBe(1);
    expect(facets.scope.global).toBe(2);
    expect(facets.scope.team).toBe(1);
    expect(facets.kind.convention).toBe(2);
    expect(facets.kind.decision).toBe(1);
  });

  it('test_semantic_order: cosine search orders by similarity and applies the threshold (AC-3/9)', async () => {
    const { wsId: ws, repoId: rid } = await freshWorkspace();
    const repo = new MemoryRepository(pg.handle.db);
    // near = same one-hot index as the query (cosine 1.0); far = orthogonal (0.0).
    await repo.insert(row({ workspaceId: ws, scope: 'global', content: 'near', embedding: oneHot(7) }));
    await repo.insert(row({ workspaceId: ws, scope: 'global', content: 'far', embedding: oneHot(99) }));
    await repo.insert(row({ workspaceId: ws, scope: 'global', content: 'no-embedding', embedding: null }));

    const hits = await repo.searchByCosine(ws, {
      repoId: rid,
      queryVector: oneHot(7),
      limit: 5,
      threshold: 0.75,
    });
    // Only the near row passes the 0.75 floor; far + no-embedding excluded.
    expect(hits.map((r) => r.content)).toEqual(['near']);
  });

  it('test_stale_filter: never-used and long-idle rows are stale; recently-used are not (AC-16)', async () => {
    const { wsId: ws, repoId: rid } = await freshWorkspace();
    const repo = new MemoryRepository(pg.handle.db);
    const never = await repo.insert(row({ workspaceId: ws, scope: 'global', content: 'never-used' }));
    const used = await repo.insert(row({ workspaceId: ws, scope: 'global', content: 'recently-used' }));
    await repo.touchLastUsed(ws, [used.id]);

    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const stale = await repo.list(ws, { repoId: rid, stale: true, staleBefore: cutoff });
    const staleContents = stale.map((r) => r.content);
    expect(staleContents).toContain('never-used');
    expect(staleContents).not.toContain('recently-used');
    expect(never.lastUsedAt).toBeNull();
  });

  it('test_delete_removes: a deleted row is gone from the list (AC-6)', async () => {
    const { wsId: ws, repoId: rid } = await freshWorkspace();
    const repo = new MemoryRepository(pg.handle.db);
    const r = await repo.insert(row({ workspaceId: ws, scope: 'global', content: 'to-delete' }));
    expect(await repo.delete(ws, r.id)).toBe(true);
    const list = await repo.list(ws, { repoId: rid });
    expect(list.some((x) => x.id === r.id)).toBe(false);
    // Deleting again (or a foreign id) is a no-op false.
    expect(await repo.delete(ws, r.id)).toBe(false);
  });

  it('test_tenant_isolation: reads/updates/deletes never cross workspaces (AC-8)', async () => {
    const a = await freshWorkspace();
    const b = await freshWorkspace();
    const repo = new MemoryRepository(pg.handle.db);
    const rowA = await repo.insert(row({ workspaceId: a.wsId, scope: 'global', content: 'A-secret' }));

    // Workspace B cannot read, update, or delete A's row.
    expect(await repo.getById(b.wsId, rowA.id)).toBeUndefined();
    expect(await repo.update(b.wsId, rowA.id, { confidence: 0.1 })).toBeUndefined();
    expect(await repo.delete(b.wsId, rowA.id)).toBe(false);
    // A still owns it untouched.
    const still = await repo.getById(a.wsId, rowA.id);
    expect(still?.content).toBe('A-secret');
    expect(still?.confidence).toBe(0.9);
    // B's cosine search never sees A's rows.
    const bHits = await repo.searchByCosine(b.wsId, { repoId: b.repoId, queryVector: oneHot(7), limit: 5, threshold: 0 });
    expect(bHits.some((r) => r.id === rowA.id)).toBe(false);
  });
});
