import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Intent, Risks } from '@devdigest/shared';
import { Risks as RisksSchema } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

/**
 * Upsert the intent record for a PR.
 * Pass `headSha` (the PR's current head commit SHA) to enable stale detection:
 * intent is considered stale when `pr_intent.head_sha !== pull_requests.head_sha`.
 * Omitting `headSha` leaves the column NULL (pre-migration rows / legacy callers).
 */
export async function upsertIntent(
  db: Db,
  prId: string,
  intent: Intent,
  headSha?: string,
): Promise<void> {
  await db
    .insert(t.prIntent)
    .values({
      prId,
      intent: intent.intent,
      inScope: intent.in_scope,
      outOfScope: intent.out_of_scope,
      headSha: headSha ?? null,
    })
    .onConflictDoUpdate({
      target: t.prIntent.prId,
      set: {
        intent: intent.intent,
        inScope: intent.in_scope,
        outOfScope: intent.out_of_scope,
        headSha: headSha ?? null,
      },
    });
}

/** Intent record augmented with the head SHA used for stale detection. */
export type IntentWithMeta = Intent & { headSha: string | null };

export async function getIntent(db: Db, prId: string): Promise<IntentWithMeta | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    headSha: row.headSha ?? null,
  };
}

// ---- risks (pr_brief) -----------------------------------------------------

/**
 * Upsert the risks record for a PR into `pr_brief`. The WHOLE `Risks` object is
 * stored as the `pr_brief.json` payload (NOT a composed `PrBrief` — that requires
 * all four of `{ intent, blast, risks, history }` and is an L04+ concern).
 * Pass `headSha` (the PR's current head commit SHA) to enable stale detection:
 * risks are considered stale when `pr_brief.head_sha !== pull_requests.head_sha`.
 * Omitting `headSha` leaves the column NULL (pre-migration rows / legacy callers).
 */
export async function upsertRisks(
  db: Db,
  prId: string,
  risks: Risks,
  headSha?: string,
): Promise<void> {
  await db
    .insert(t.prBrief)
    .values({ prId, json: risks, headSha: headSha ?? null })
    .onConflictDoUpdate({
      target: t.prBrief.prId,
      set: { json: risks, headSha: headSha ?? null },
    });
}

/** Risks record augmented with the head SHA used for stale detection. */
export type RisksWithMeta = Risks & { headSha: string | null };

export async function getRisks(db: Db, prId: string): Promise<RisksWithMeta | undefined> {
  const [row] = await db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
  if (!row) return undefined;
  // `pr_brief.json` is untyped jsonb holding the raw `Risks` object — parse it
  // defensively (NOT `PrBrief.parse`, which requires all four brief sections).
  const json = RisksSchema.parse(row.json);
  return { risks: json.risks, headSha: row.headSha ?? null };
}
