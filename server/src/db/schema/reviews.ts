import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Review & findings

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id'),
  /** The agent_run that produced this review (links the timeline run ↔ review). */
  runId: uuid('run_id'),
  kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
  verdict: text('verdict'),
  summary: text('summary'),
  score: integer('score'),
  model: text('model'),
  /** the commit this review ran against; used to derive per-finding anchor_status (Stage 2) */
  headSha: text('head_sha'),
  createdAt: now(),
});

export const findings = pgTable('findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),
  file: text('file').notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  rationale: text('rationale').notNull(),
  suggestion: text('suggestion'),
  confidence: doublePrecision('confidence').notNull(),
  kind: text('kind').notNull().default('finding'),
  trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  /**
   * sha256 of the normalized `anchoredText` the finding ran against, for L2-lite
   * content-aware staleness (Issue #3 `content_changed`). Nullable, no default:
   * legacy / pre-migration rows are NULL ⇒ NOT compared on read ⇒ stay `current`.
   * Written by run-executor, recomputed identically on read in `reviewsForPull`.
   */
  anchorFingerprint: text('anchor_fingerprint'),
});

export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /**
   * The PR head SHA at the time intent was last computed. Nullable — absent on
   * rows created before this column was added (pre-migration). Used for stale
   * detection: intent is stale when `pr_intent.head_sha !== pull_requests.head_sha`.
   */
  headSha: text('head_sha'),
  /**
   * Freshness key (sha256 over ALL output-determining inputs: head/base/title/
   * body/model/prompt-version). Supersedes the head_sha-only stale check (Stage 1)
   * — head_sha alone misses title/body/base/model/prompt changes. `head_sha` is
   * kept alongside for debug/parity. Nullable so legacy/pre-migration rows stay
   * valid (NULL ⇒ treated NOT stale, no false alarm).
   */
  freshnessKey: text('freshness_key'),
});

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
  /**
   * The PR head SHA at the time the brief was last computed. Nullable — absent on
   * rows created before this column was added (pre-migration). Used for stale
   * detection (parity with `pr_intent.head_sha`): the brief is stale when
   * `pr_brief.head_sha !== pull_requests.head_sha`.
   */
  headSha: text('head_sha'),
  /**
   * Freshness key (sha256 over ALL output-determining inputs: head/base/title/
   * body/model/prompt-version + the anchored intent's key). Supersedes the
   * head_sha-only stale check (Stage 1) — head_sha alone misses title/body/base/
   * model/prompt changes. `head_sha` is kept alongside for debug/parity. Nullable
   * so legacy/pre-migration rows stay valid (NULL ⇒ treated NOT stale).
   */
  freshnessKey: text('freshness_key'),
});
