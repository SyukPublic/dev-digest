import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import * as t from '../src/db/schema.js';
import type { Embedder } from '@devdigest/shared';
import { MemoryService } from '../src/modules/memory/service.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[memory-service] Docker not available — skipping.');

/** Content-aware embedder: one-hot on a keyword so cosine order is deterministic. */
class KeywordEmbedder implements Embedder {
  readonly dims = 1536;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const idx = /stripe/i.test(text) ? 7 : /migration/i.test(text) ? 20 : 100;
      const v = new Array(1536).fill(0);
      v[idx] = 1;
      return v;
    });
  }
}

const config = (env: Record<string, string> = {}) =>
  loadConfig({ ...process.env, NODE_ENV: 'test', ...env } as NodeJS.ProcessEnv);

d('MemoryService (DB-backed)', () => {
  let pg: PgFixture;

  async function freshWorkspace(): Promise<{ wsId: string; repoId: string }> {
    const [ws] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `mems-${Date.now()}-${Math.random().toString(36).slice(2)}` })
      .returning();
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws!.id, owner: 'acme', name: 'payments-api', fullName: 'acme/payments-api', defaultBranch: 'main', createdBy: null })
      .returning();
    return { wsId: ws!.id, repoId: repo!.id };
  }

  beforeAll(async () => { pg = await startPg(); });
  afterAll(async () => { await pg?.stop(); });

  it('test_create_embeds: create persists ws-scoped and stores an embedding (AC-4)', async () => {
    const { wsId } = await freshWorkspace();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { embedder: new KeywordEmbedder() } });
    const svc = new MemoryService(app.container);

    const created = await svc.create(wsId, { content: 'stripe webhook is verified', scope: 'global', kind: 'fact', confidence: 0.8, sources: [] });
    expect(created.id).toBeTruthy();
    expect(created.confidence).toBe(0.8);

    const [row] = await pg.handle.db.select().from(t.memory).where(eq(t.memory.id, created.id));
    expect(row!.embedding).not.toBeNull();
    expect(row!.embedding!.length).toBe(1536);
    await app.close();
  });

  it('test_update_reembed: re-embeds only when content changed (AC-5)', async () => {
    const { wsId } = await freshWorkspace();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { embedder: new KeywordEmbedder() } });
    const svc = new MemoryService(app.container);

    const created = await svc.create(wsId, { content: 'stripe fact', scope: 'global', kind: 'fact', confidence: 0.8, sources: [] });
    const [before] = await pg.handle.db.select().from(t.memory).where(eq(t.memory.id, created.id));
    expect(before!.embedding![7]).toBe(1); // 'stripe' → index 7

    // Content change to a 'migration' topic re-embeds → index 20.
    const updated = await svc.update(wsId, created.id, { content: 'migration rule' });
    expect(updated).toBeDefined();
    const [afterContent] = await pg.handle.db.select().from(t.memory).where(eq(t.memory.id, created.id));
    expect(afterContent!.embedding![20]).toBe(1);
    expect(afterContent!.embedding![7]).toBe(0);

    // A non-content edit does NOT change the embedding.
    await svc.update(wsId, created.id, { confidence: 0.3 });
    const [afterConf] = await pg.handle.db.select().from(t.memory).where(eq(t.memory.id, created.id));
    expect(afterConf!.embedding![20]).toBe(1);
    expect(afterConf!.confidence).toBe(0.3);
    await app.close();
  });

  it('test_inject_topn / retrieveRelevant: returns matched items + pulled and stamps last_used_at (AC-9/10)', async () => {
    const { wsId, repoId } = await freshWorkspace();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { embedder: new KeywordEmbedder() } });
    const svc = new MemoryService(app.container);

    const stripe = await svc.create(wsId, {
      content: 'The stripe webhook raw-body parser is intentional.',
      scope: 'repo', kind: 'decision', confidence: 0.95, repo_id: repoId,
      sources: [{ pr: 401, context: 'Stripe review' }],
    });
    await svc.create(wsId, { content: 'migration rule', scope: 'global', kind: 'convention', confidence: 0.9, sources: [] });

    const { items, pulled } = await svc.retrieveRelevant(wsId, repoId, 'question about stripe webhooks');
    expect(items).toEqual([stripe.content]);
    expect(pulled).toEqual([{ pr: 401, text: stripe.content }]);

    // last_used_at was stamped on the matched row (AC-10).
    const [row] = await pg.handle.db.select().from(t.memory).where(eq(t.memory.id, stripe.id));
    expect(row!.lastUsedAt).not.toBeNull();
    await app.close();
  });

  it('test_degrade_embeddings_off: create still persists (no embedding); retrieval is a no-op (AC-11)', async () => {
    const { wsId, repoId } = await freshWorkspace();
    // No embedder override + EMBEDDINGS_ENABLED unset → container.embedder() throws.
    const app = await buildApp({ config: config({ EMBEDDINGS_ENABLED: 'false' }), db: pg.handle.db });
    const svc = new MemoryService(app.container);

    const created = await svc.create(wsId, { content: 'stripe fact', scope: 'global', kind: 'fact', confidence: 0.8, sources: [] });
    const fetched = await svc.getById(wsId, created.id);
    expect(fetched?.content).toBe('stripe fact');
    const [row] = await pg.handle.db.select().from(t.memory).where(eq(t.memory.id, created.id));
    expect(row!.embedding).toBeNull();

    // Retrieval degrades to empty rather than throwing.
    const res = await svc.retrieveRelevant(wsId, repoId, 'stripe');
    expect(res).toEqual({ items: [], pulled: [] });

    // A semantic list search surfaces the typed unavailable error.
    await expect(svc.list(wsId, { q: 'stripe', repo_id: repoId })).rejects.toMatchObject({ code: 'embeddings_disabled' });
    await app.close();
  });
});
