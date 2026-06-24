import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { ConventionsRepository, type InsertConvention } from '../src/modules/conventions/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[conventions-repo] Docker not available — skipping.');

/** Minimal InsertConvention factory (workspaceId and repoId filled by caller). */
function row(workspaceId: string, repoId: string, rule = 'Use await'): InsertConvention {
  return {
    workspaceId,
    repoId,
    rule,
    evidencePath: 'src/a.ts',
    evidenceSnippet: 'const x = await f();',
    confidence: 0.9,
    category: 'async',
    source: 'llm',
    occurrences: 2,
    extractedAt: new Date(),
  };
}

d('ConventionsRepository (DB-backed)', () => {
  let pg: PgFixture;
  let wsId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    // Resolve seeded default workspace and its demo repo (acme/payments-api).
    const [ws] = await pg.handle.db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    wsId = ws!.id;
    const [repo] = await pg.handle.db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(eq(t.repos.workspaceId, wsId))
      .limit(1);
    repoId = repo!.id;
  });

  afterAll(async () => { await pg?.stop(); });

  it('replaceAll is a clean slate: M old rows replaced by N new rows', async () => {
    const repo = new ConventionsRepository(pg.handle.db);
    // Insert 3 old rows.
    await repo.replaceAll(wsId, repoId, [
      row(wsId, repoId, 'Old rule 1'),
      row(wsId, repoId, 'Old rule 2'),
      row(wsId, repoId, 'Old rule 3'),
    ]);
    // Replace with 2 new rows.
    await repo.replaceAll(wsId, repoId, [
      row(wsId, repoId, 'New rule A'),
      row(wsId, repoId, 'New rule B'),
    ]);
    const list = await repo.listByRepo(wsId, repoId);
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.rule)).toEqual(expect.arrayContaining(['New rule A', 'New rule B']));
    expect(list.every((r) => r.extractedAt !== null)).toBe(true);
  });

  it('workspace isolation: replaceAll for workspace B does not touch workspace A rows', async () => {
    const [wsB] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `test-isolation-${Date.now()}` })
      .returning();

    const repo = new ConventionsRepository(pg.handle.db);
    await repo.replaceAll(wsId, repoId, [row(wsId, repoId, 'WS-A rule')]);
    await repo.replaceAll(wsB!.id, repoId, [row(wsB!.id, repoId, 'WS-B rule')]);

    const listA = await repo.listByRepo(wsId, repoId);
    const listB = await repo.listByRepo(wsB!.id, repoId);
    expect(listA.some((r) => r.rule === 'WS-A rule')).toBe(true);
    expect(listA.some((r) => r.rule === 'WS-B rule')).toBe(false);
    expect(listB.some((r) => r.rule === 'WS-B rule')).toBe(true);
    expect(listB.some((r) => r.rule === 'WS-A rule')).toBe(false);
  });

  it('update scoping: patch changes only the target row in the target workspace', async () => {
    const [wsC] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `test-update-scope-${Date.now()}` })
      .returning();

    const repo = new ConventionsRepository(pg.handle.db);
    // Insert one row in wsId and one in wsC with the same repoId.
    const [rowA] = await repo.replaceAll(wsId, repoId, [row(wsId, repoId, 'Target rule')]);
    await repo.replaceAll(wsC!.id, repoId, [row(wsC!.id, repoId, 'Other rule')]);

    await repo.update(wsId, rowA!.id, { accepted: true });

    const updated = await repo.listByRepo(wsId, repoId);
    const otherWs = await repo.listByRepo(wsC!.id, repoId);
    expect(updated.find((r) => r.id === rowA!.id)?.accepted).toBe(true);
    expect(otherWs.every((r) => r.accepted === null || r.accepted === false)).toBe(true);
    // Cross-workspace update attempt returns undefined (not found in wsC scope).
    expect(await repo.update(wsC!.id, rowA!.id, { accepted: true })).toBeUndefined();
  });

  // ── accept-persistence across re-scan (F1) ──────────────────────────────

  it('preserves accepted=true for same rule text (case 1)', async () => {
    const repo = new ConventionsRepository(pg.handle.db);
    const [r0] = await repo.replaceAll(wsId, repoId, [row(wsId, repoId, 'Use await')]);
    await repo.update(wsId, r0!.id, { accepted: true });

    await repo.replaceAll(wsId, repoId, [row(wsId, repoId, 'Use await')]);
    const [after] = await repo.listByRepo(wsId, repoId);
    expect(after!.accepted).toBe(true);
  });

  it('preserves accepted across normalisation variance (case 4)', async () => {
    const repo = new ConventionsRepository(pg.handle.db);
    const [r0] = await repo.replaceAll(wsId, repoId, [row(wsId, repoId, 'Use await.')]);
    await repo.update(wsId, r0!.id, { accepted: true });

    // same normalised key: 'use await'
    await repo.replaceAll(wsId, repoId, [row(wsId, repoId, 'use await')]);
    const [after] = await repo.listByRepo(wsId, repoId);
    expect(after!.accepted).toBe(true);
  });

  it('accepted rule absent from new scan does not reappear (case 2)', async () => {
    const repo = new ConventionsRepository(pg.handle.db);
    const [r0] = await repo.replaceAll(wsId, repoId, [row(wsId, repoId, 'Gone rule')]);
    await repo.update(wsId, r0!.id, { accepted: true });

    await repo.replaceAll(wsId, repoId, [row(wsId, repoId, 'Different rule')]);
    const after = await repo.listByRepo(wsId, repoId);
    expect(after.some((r) => r.rule === 'Gone rule')).toBe(false);
    expect(after.find((r) => r.rule === 'Different rule')?.accepted).toBe(false);
  });

  it('brand-new rule gets accepted=false (case 3)', async () => {
    const repo = new ConventionsRepository(pg.handle.db);
    await repo.replaceAll(wsId, repoId, []);
    await repo.replaceAll(wsId, repoId, [row(wsId, repoId, 'Brand new rule')]);
    const [after] = await repo.listByRepo(wsId, repoId);
    expect(after!.accepted).toBe(false);
  });

  it('changed rule text (different key) resets accepted to false (case 5)', async () => {
    const repo = new ConventionsRepository(pg.handle.db);
    const [r0] = await repo.replaceAll(wsId, repoId, [row(wsId, repoId, 'Original rule text')]);
    await repo.update(wsId, r0!.id, { accepted: true });

    await repo.replaceAll(wsId, repoId, [row(wsId, repoId, 'Completely different rule')]);
    const [after] = await repo.listByRepo(wsId, repoId);
    expect(after!.rule).toBe('Completely different rule');
    expect(after!.accepted).toBe(false);
  });

  it('replaceAll for WS-B does not bleed accepted into WS-A rows (case 6)', async () => {
    const [wsD] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `test-accept-isolation-${Date.now()}` })
      .returning();
    const repo = new ConventionsRepository(pg.handle.db);
    const [rA] = await repo.replaceAll(wsId, repoId, [row(wsId, repoId, 'WS-A only rule')]);
    await repo.update(wsId, rA!.id, { accepted: true });

    await repo.replaceAll(wsD!.id, repoId, [row(wsD!.id, repoId, 'WS-D rule')]);

    const listA = await repo.listByRepo(wsId, repoId);
    const listD = await repo.listByRepo(wsD!.id, repoId);
    expect(listA.find((r) => r.rule === 'WS-A only rule')?.accepted).toBe(true);
    expect(listD.find((r) => r.rule === 'WS-D rule')?.accepted).toBe(false);
  });

  it('empty re-scan leaves table empty and drops prior accepts (case 8)', async () => {
    const repo = new ConventionsRepository(pg.handle.db);
    const [r0] = await repo.replaceAll(wsId, repoId, [row(wsId, repoId, 'Will be lost')]);
    await repo.update(wsId, r0!.id, { accepted: true });

    await repo.replaceAll(wsId, repoId, []);
    const after = await repo.listByRepo(wsId, repoId);
    expect(after).toHaveLength(0);
  });
});
