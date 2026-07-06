/**
 * Phase 12 (T36) — the demo seed populates a stored intent + Why+Risk Brief for
 * PR #482 (AC-26).
 *
 * Proves the seed is demo-ready and LLM-free: after `seed(db)`, PR #482
 *  - has a `pr_intent` row (summary + scope), and
 *  - has a `pr_why_risk_brief` row whose `json` is a contract-valid `Brief` with
 *    a risk whose `file_refs` carries the MANDATORY `path:N-M` range against a
 *    real seeded file (`src/middleware/ratelimit.ts:12-18`) plus a non-empty
 *    explanation (so the RISK AREAS expander has content to reveal), and
 *  - its `pr_files` for ratelimit.ts carry `patch` text so the runtime
 *    changed-hunk reconstruction is exercisable on seeded data.
 * Re-running `seed` stays idempotent (the "if not exists" PR guard).
 *
 * Skips cleanly when Docker is unavailable; the harness runs the generated
 * migrations. We never migrate the dev DB.
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
  console.warn('[brief-seed-pr482] Docker not available — skipping integration tests.');
}

d('seed — PR #482 stored intent + Why+Risk Brief (AC-26)', () => {
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

  async function pr482Id(): Promise<string> {
    const [repo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repo!.id), eq(t.pullRequests.number, 482)));
    return pr!.id;
  }

  it('seeds a pr_intent for PR #482 (summary + scope)', async () => {
    const prId = await pr482Id();
    const [intent] = await pg.handle.db
      .select()
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, prId));
    expect(intent).toBeDefined();
    expect(intent!.intent.length).toBeGreaterThan(0);
    expect(intent!.inScope.length).toBeGreaterThan(0);
  });

  it('seeds a Why+Risk Brief whose risk carries a path:N-M range + explanation (AC-26)', async () => {
    const prId = await pr482Id();
    const [row] = await pg.handle.db
      .select()
      .from(t.prWhyRiskBrief)
      .where(eq(t.prWhyRiskBrief.prId, prId));
    expect(row).toBeDefined();

    // The stored json is a contract-valid Brief.
    const brief = Brief.parse(row!.json);
    expect(brief.risks.length).toBeGreaterThan(0);

    // At least one risk ref is a real seeded file WITH a mandatory line range.
    const refs = brief.risks.flatMap((r) => r.file_refs);
    expect(refs).toContain('src/middleware/ratelimit.ts:12-18');

    // The risk has a non-empty explanation (the expander reveals it).
    const risk = brief.risks.find((r) =>
      r.file_refs.includes('src/middleware/ratelimit.ts:12-18'),
    )!;
    expect(risk.explanation.trim().length).toBeGreaterThan(0);
  });

  it('the seeded ratelimit.ts pr_file carries patch text (runtime range reconstruction)', async () => {
    const prId = await pr482Id();
    const [file] = await pg.handle.db
      .select()
      .from(t.prFiles)
      .where(and(eq(t.prFiles.prId, prId), eq(t.prFiles.path, 'src/middleware/ratelimit.ts')));
    expect(file).toBeDefined();
    expect(file!.patch).toBeTruthy();
    expect(file!.patch).toContain('@@');
  });

  it('re-running seed stays idempotent (one intent, one brief, no duplicate PR)', async () => {
    await seed(pg.handle.db);
    const prId = await pr482Id();

    const intents = await pg.handle.db
      .select()
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, prId));
    expect(intents).toHaveLength(1);

    const briefs = await pg.handle.db
      .select()
      .from(t.prWhyRiskBrief)
      .where(eq(t.prWhyRiskBrief.prId, prId));
    expect(briefs).toHaveLength(1);
  });
});
