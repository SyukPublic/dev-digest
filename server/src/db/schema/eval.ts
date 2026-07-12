import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, doublePrecision } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable('eval_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
  ownerId: uuid('owner_id').notNull(),
  name: text('name').notNull(),
  inputDiff: text('input_diff'),
  inputFiles: jsonb('input_files'),
  inputMeta: jsonb('input_meta'),
  expectedOutput: jsonb('expected_output'),
  notes: text('notes'),
});

/**
 * L06 Agent Eval Pipeline — the PARENT of a suite run. One row per
 * "run this agent against all its cases". Its pooled, micro-averaged metrics are
 * IMMUTABLE aggregates: deleting a case later cascades that case's per-case
 * `eval_runs` rows but never rewrites the suite's numbers (AC-23).
 *
 * `agent_id` carries NO DB foreign key — deleting an agent cascades its eval
 * cases + suite history at the SERVICE level (AC-24), mirroring
 * `eval_cases.owner_id`. Only `workspace_id` is FK-scoped (tenancy).
 */
export const evalSuiteRuns = pgTable('eval_suite_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  // No DB FK — service-level cascade on agent delete (AC-24).
  agentId: uuid('agent_id').notNull(),
  // Snapshot of `agents.version` at suite start (AC-14) — the version whose
  // config produced these numbers.
  agentVersion: integer('agent_version').notNull(),
  status: text('status', { enum: ['running', 'done', 'failed'] }).notNull(),
  // Pooled micro-averaged metrics; NULL when the denominator is 0 (AC-16/AC-18).
  recall: doublePrecision('recall'),
  precision: doublePrecision('precision'),
  citationAccuracy: doublePrecision('citation_accuracy'),
  passed: integer('passed').notNull().default(0),
  total: integer('total').notNull().default(0),
  // Sum of priced cases; NULL when none priced (AC-20).
  costUsd: doublePrecision('cost_usd'),
  durationMs: integer('duration_ms').notNull().default(0),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
});

export const evalRuns = pgTable('eval_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => evalCases.id, { onDelete: 'cascade' }),
  // Links a per-case row to its suite; cascades when the suite is deleted.
  // NULL for a single-case run (not part of a suite).
  suiteRunId: uuid('suite_run_id').references(() => evalSuiteRuns.id, {
    onDelete: 'cascade',
  }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  actualOutput: jsonb('actual_output'),
  pass: boolean('pass'),
  recall: doublePrecision('recall'),
  precision: doublePrecision('precision'),
  citationAccuracy: doublePrecision('citation_accuracy'),
  durationMs: integer('duration_ms'),
  costUsd: doublePrecision('cost_usd'),
  // Set when the case's LLM execution failed; the row keeps pass=false and the
  // suite continues (AC-21).
  error: text('error'),
});

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
