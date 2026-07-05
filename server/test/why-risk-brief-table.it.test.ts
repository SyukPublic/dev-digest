/**
 * Phase 3 (T6) — the `pr_why_risk_brief` per-PR cache table (CP-7).
 *
 * Proves the migration created the table and that it behaves as designed:
 * one row per PR keyed on `pr_id`, round-trips the `json` Brief payload +
 * `freshness_key`, an upsert overwrites the prior row on conflict (AC-11),
 * NULL `freshness_key` is allowed (AC-14), carries `workspace_id` for tenant
 * scoping (AC-16), and cascades when the owning PR is deleted (AC-1).
 *
 * SEPARATE from `pr_brief` (spec Non-goal): writing here never touches the
 * raw-`Risks` `pr_brief` row.
 *
 * Skips cleanly when Docker is unavailable. The harness runs the generated
 * migrations (incl. 0019 → `pr_why_risk_brief`); we never migrate the dev DB.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { Brief } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[why-risk-brief-table] Docker not available — skipping integration tests.');
}

/** A minimal `Brief`-shaped payload (its exact shape is out of this phase's scope). */
const sampleBrief = (label: string) => ({
  headline: `Why this PR is risky: ${label}`,
  bullets: [`reason ${label}-1`, `reason ${label}-2`],
});

/** A REAL `Brief` document (what/why/risk_level/risks/review_focus), Zod-valid. */
const realBrief = (label: string): Brief => ({
  what: `Adds ${label}`,
  why: `Because ${label} was requested`,
  risk_level: 'medium',
  risks: [
    {
      kind: 'perf',
      title: `N+1 in ${label}`,
      explanation: 'loop over rows',
      severity: 'high',
      file_refs: [`src/${label}.ts:1-3`],
    },
  ],
  review_focus: [{ path: `src/${label}.ts`, line: 1, reason: 'entry point' }],
});

d('pr_why_risk_brief cache table (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** Create a fresh repo + PR for a clean, isolated test. */
  async function setupPr(headSha: string) {
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: `wrb-${headSha}`,
        fullName: `acme/wrb-${headSha}`,
      })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 42,
        title: 'Why-risk brief round-trip',
        author: 'dev',
        branch: 'feat/x',
        base: 'main',
        headSha,
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    return pr!;
  }

  /** Idempotent upsert keyed on `pr_id` (AC-11). */
  async function upsert(prId: string, json: unknown, freshnessKey: string | null) {
    await pg.handle.db
      .insert(t.prWhyRiskBrief)
      .values({ prId, workspaceId, json, freshnessKey })
      .onConflictDoUpdate({
        target: t.prWhyRiskBrief.prId,
        set: { json, generatedAt: new Date(), freshnessKey },
      });
  }

  it('round-trips the json Brief payload and freshness_key', async () => {
    const pr = await setupPr('sha-1');
    const brief = sampleBrief('sha-1');
    await upsert(pr.id, brief, 'freshness-1');

    const [row] = await pg.handle.db
      .select()
      .from(t.prWhyRiskBrief)
      .where(eq(t.prWhyRiskBrief.prId, pr.id));

    expect(row!.json).toEqual(brief);
    expect(row!.freshnessKey).toBe('freshness-1');
    expect(row!.workspaceId).toBe(workspaceId);
    expect(row!.generatedAt).toBeInstanceOf(Date);
  });

  it('round-trips a REAL Brief contract document through the jsonb column (AC-1)', async () => {
    // Unit under test: the `json` jsonb column on `pr_why_risk_brief`.
    // Input: a `Brief`-shaped document validated by the actual Zod contract
    // (what/why/risk_level/risks[]/review_focus[]) — not a placeholder shape.
    // Expected output: the row read back parses AGAINST THE SAME `Brief` schema
    // and is deep-equal to what was written (jsonb preserves the document
    // verbatim; no field is dropped/renamed by the column round-trip).
    const pr = await setupPr('sha-real-1');
    const brief = realBrief('widget');
    Brief.parse(brief); // sanity: the fixture itself is contract-valid
    await upsert(pr.id, brief, 'freshness-real-1');

    const [row] = await pg.handle.db
      .select()
      .from(t.prWhyRiskBrief)
      .where(eq(t.prWhyRiskBrief.prId, pr.id));

    const parsed = Brief.parse(row!.json);
    expect(parsed).toEqual(brief);
    expect(parsed.risks[0]!.file_refs).toEqual(['src/widget.ts:1-3']);
    expect(parsed.review_focus[0]!.path).toBe('src/widget.ts');
  });

  it('a second upsert overwrites the prior row by pr_id (AC-11)', async () => {
    const pr = await setupPr('sha-2');
    await upsert(pr.id, sampleBrief('v1'), 'freshness-v1');
    await upsert(pr.id, sampleBrief('v2'), 'freshness-v2');

    const rows = await pg.handle.db
      .select()
      .from(t.prWhyRiskBrief)
      .where(eq(t.prWhyRiskBrief.prId, pr.id));

    // Still exactly one row (PK pr_id), holding the latest payload.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.json).toEqual(sampleBrief('v2'));
    expect(rows[0]!.freshnessKey).toBe('freshness-v2');
  });

  it('allows a NULL freshness_key (AC-14: NULL ⇒ treated NOT stale)', async () => {
    const pr = await setupPr('sha-3');
    await upsert(pr.id, sampleBrief('sha-3'), null);

    const [row] = await pg.handle.db
      .select()
      .from(t.prWhyRiskBrief)
      .where(eq(t.prWhyRiskBrief.prId, pr.id));

    expect(row!.freshnessKey).toBeNull();
  });

  it('carries workspace_id so briefs are scopable to a tenant (AC-16)', async () => {
    const pr = await setupPr('sha-4');
    await upsert(pr.id, sampleBrief('sha-4'), 'freshness-4');

    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${crypto.randomUUID()}` })
      .returning();

    // A query scoped to the OTHER workspace sees nothing.
    const foreign = await pg.handle.db
      .select()
      .from(t.prWhyRiskBrief)
      .where(
        and(eq(t.prWhyRiskBrief.prId, pr.id), eq(t.prWhyRiskBrief.workspaceId, otherWs!.id)),
      );
    expect(foreign).toHaveLength(0);

    // Scoped to the OWNING workspace it is visible.
    const owned = await pg.handle.db
      .select()
      .from(t.prWhyRiskBrief)
      .where(
        and(eq(t.prWhyRiskBrief.prId, pr.id), eq(t.prWhyRiskBrief.workspaceId, workspaceId)),
      );
    expect(owned).toHaveLength(1);
  });

  it('deleting the owning PR cascades the brief away (AC-1)', async () => {
    const pr = await setupPr('sha-5');
    await upsert(pr.id, sampleBrief('sha-5'), 'freshness-5');

    await pg.handle.db.delete(t.pullRequests).where(eq(t.pullRequests.id, pr.id));

    const rows = await pg.handle.db
      .select()
      .from(t.prWhyRiskBrief)
      .where(eq(t.prWhyRiskBrief.prId, pr.id));
    expect(rows).toHaveLength(0);
  });

  it('does NOT touch pr_brief (spec Non-goal): upsert leaves pr_brief empty', async () => {
    const pr = await setupPr('sha-6');
    await upsert(pr.id, sampleBrief('sha-6'), 'freshness-6');

    const briefRows = await pg.handle.db
      .select()
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, pr.id));
    expect(briefRows).toHaveLength(0);
  });
});
