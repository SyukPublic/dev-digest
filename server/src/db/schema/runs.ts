import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';
import { ciInstallations } from './ci';

// ============================================================ Observability

export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  provider: text('provider'),
  model: text('model'),
  durationMs: integer('duration_ms'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  /** Generation cost (USD) for this run; null when unknown (unpriced model /
   *  failed/cancelled run). NEVER 0 as a stand-in for "unknown" — the UI shows
   *  "—" on null and a real "$0.00" only when the cost is genuinely zero. */
  costUsd: doublePrecision('cost_usd'),
  status: text('status'),
  /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
  error: text('error'),
  source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
  findingsCount: integer('findings_count'),
  grounding: text('grounding'),
  /** Review score (0-100) for this run; null on failed/cancelled runs. */
  score: integer('score'),
  /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
  blockers: integer('blockers'),
  /** CI-only: SUGGESTION-severity finding count from the result artifact, so the
   *  CI Runs page can show a true CRITICAL/WARNING/SUGGESTION split (CRITICAL =
   *  `blockers`, WARNING = findings_count − blockers − suggestions). Null for
   *  local runs and legacy CI rows ingested before this column. */
  suggestions: integer('suggestions'),
  /** Groups every run of ONE `runReview()` fan-out ("Review all"). Lets the PR
   *  list sum the cost of the latest review BATCH deterministically, without
   *  relying on `ran_at` time-windows. Null for runs created before this column. */
  batchId: uuid('batch_id'),
  // ---- CI-run columns (source='ci'). All nullable/additive: local runs
  // (source='local') keep NULLs. Populated by the CI ingest from a repo's
  // GitHub Actions runs; `ci_runs` (course table) stays empty — CI runs live
  // here in `agent_runs WHERE source='ci'`.
  /** PR number the CI review ran against (from the Actions run / result artifact). */
  prNumber: integer('pr_number'),
  /** "owner/name" of the repo the CI review ran in. */
  repo: text('repo'),
  /** GitHub Actions run URL — the natural, idempotent ingest key. */
  githubUrl: text('github_url'),
  /** The installation this CI run belongs to; set null if the installation is removed. */
  ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
    onDelete: 'set null',
  }),
  /** Links this run to a persisted multi-agent review group (DEC-B). Nullable so
   *  legacy single-agent runs are unaffected; `set null` on delete degrades
   *  gracefully when the multi-run is removed. Read-side aggregates (agent_count,
   *  total_duration_ms, total_cost_usd) are computed from grouped runs, not stored. */
  multiAgentRunId: uuid('multi_agent_run_id').references(() => multiAgentRuns.id, {
    onDelete: 'set null',
  }),
});

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

export const multiAgentRuns = pgTable('multi_agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
});
