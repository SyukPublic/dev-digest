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

/**
 * Skill Eval Pipeline — the PARENT of a DIFFERENTIAL (delta) run over all of a
 * skill's cases (SPEC-2026-07-12-skill-eval-differential, decision 1). A SIBLING
 * of `evalSuiteRuns`, NOT an extension of it: the agent-typed table's shipped rows
 * stay untouched.
 *
 * A skill has no model/prompt/strategy, so it is only meaningful as a DELTA on a
 * HOST agent's review — hence the extra `host_agent_id`/`host_agent_version`
 * columns. Its pooled, micro-averaged metrics are IMMUTABLE aggregates once
 * written at terminal.
 *
 * Neither `skill_id` NOR `host_agent_id` carries a DB foreign key — deleting a
 * skill cascades its cases + skill-suite history at the SERVICE level (AC-31),
 * and deleting a host agent leaves the skill suites it hosted intact (AC-32),
 * mirroring `eval_suite_runs.agent_id`. Only `workspace_id` is FK-scoped (tenancy).
 */
export const evalSkillSuiteRuns = pgTable('eval_skill_suite_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  // No DB FK — service-level cascade on skill delete (AC-31).
  skillId: uuid('skill_id').notNull(),
  // Snapshot of `skills.version` at suite start — the skill body whose delta
  // produced these numbers.
  skillVersion: integer('skill_version').notNull(),
  // No DB FK — deleting the host agent preserves the skill suites it hosted
  // (AC-32); the delta was still real at run time.
  hostAgentId: uuid('host_agent_id').notNull(),
  // Snapshot of the host `agents.version` at suite start (the compare confounder,
  // AC-29): a delta shifts with EITHER the skill body OR the host config.
  hostAgentVersion: integer('host_agent_version').notNull(),
  status: text('status', { enum: ['running', 'done', 'failed'] }).notNull(),
  // Pooled micro-averaged DELTA metrics; NULL when the denominator is 0 (AC-14).
  recall: doublePrecision('recall'),
  precision: doublePrecision('precision'),
  citationAccuracy: doublePrecision('citation_accuracy'),
  passed: integer('passed').notNull().default(0),
  total: integer('total').notNull().default(0),
  // Sum of priced cases (both arms combined per case); NULL when none priced (AC-18).
  costUsd: doublePrecision('cost_usd'),
  durationMs: integer('duration_ms').notNull().default(0),
  // Links a differential suite run to its STABILITY GROUP (the N-repeat parent);
  // cascades when the group is deleted (which then cascades the per-case
  // `eval_runs` via `skill_suite_run_id`). NULL for a STANDALONE differential run
  // that is not part of a stability group (SPEC-2026-07-12-skill-eval-stability).
  stabilityGroupId: uuid('stability_group_id').references(() => evalSkillStabilityGroups.id, {
    onDelete: 'cascade',
  }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Skill Eval Pipeline — STABILITY LAYER: the PARENT of a *stability group*, i.e.
 * ONE frozen skill+host snapshot repeated `n_requested` times as N child
 * `eval_skill_suite_runs` (SPEC-2026-07-12-skill-eval-stability-layer, UD-2). A
 * SIBLING of `evalSkillSuiteRuns` (following the differential precedent of a
 * sibling table over columns on the parent), and deliberately THIN: it stores
 * only the snapshot identity + repeat count + status. The per-metric variance,
 * per-case flags, and noise-aware alert are DERIVED on read from the child suite
 * runs + their per-case `eval_runs` — no denormalized stats columns.
 *
 * Neither `skill_id` NOR `host_agent_id` carries a DB foreign key — deleting a
 * skill cascades its stability groups at the SERVICE level, and deleting a host
 * agent preserves the groups it hosted, mirroring `eval_skill_suite_runs`. Only
 * `workspace_id` is FK-scoped (tenancy). A group delete cascades its child suite
 * runs via `eval_skill_suite_runs.stability_group_id`.
 */
export const evalSkillStabilityGroups = pgTable('eval_skill_stability_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  // No DB FK — service-level cascade on skill delete (mirrors eval_skill_suite_runs).
  skillId: uuid('skill_id').notNull(),
  // Snapshot of `skills.version` at group start — frozen across all N runs (AC-2).
  skillVersion: integer('skill_version').notNull(),
  // No DB FK — deleting the host agent preserves the groups it hosted.
  hostAgentId: uuid('host_agent_id').notNull(),
  // Snapshot of the host `agents.version` at group start — frozen across N runs.
  hostAgentVersion: integer('host_agent_version').notNull(),
  // The requested repeat count (2 ≤ n ≤ STABILITY_MAX_N).
  nRequested: integer('n_requested').notNull(),
  status: text('status', { enum: ['running', 'done', 'failed'] }).notNull(),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
});

export const evalRuns = pgTable('eval_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => evalCases.id, { onDelete: 'cascade' }),
  // Links a per-case row to its AGENT suite; cascades when that suite is deleted.
  // NULL for a single-case run (not part of a suite). Mutually exclusive with
  // `skillSuiteRunId` by construction — a per-case row belongs to EXACTLY ONE of
  // the two suite parents (a service invariant, not a DB CHECK): an agent-suite
  // row sets `suiteRunId` and leaves `skillSuiteRunId` NULL, and vice versa.
  suiteRunId: uuid('suite_run_id').references(() => evalSuiteRuns.id, {
    onDelete: 'cascade',
  }),
  // Links a per-case row to its SKILL (differential) suite; cascades when that
  // skill suite is deleted (AC-31). NULL for agent-suite / single-case runs.
  // Mutually exclusive with `suiteRunId` (see above).
  skillSuiteRunId: uuid('skill_suite_run_id').references(() => evalSkillSuiteRuns.id, {
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
