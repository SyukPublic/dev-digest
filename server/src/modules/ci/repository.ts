import { and, desc, eq, gte } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { AgentRunRow } from '../../db/rows.js';
import type { CiInstallation, CiRunSummary, CiTarget } from '@devdigest/shared';

/**
 * CI data-access (T9/T17/T18/T19). Owns reads of `ci_installations` and the
 * `agent_runs WHERE source='ci'` rollup (the `ci_runs` course table stays empty
 * — CI runs live in `agent_runs`). Module-private: constructed from
 * `container.db` by `CiService`; its DB access is exercised via integration
 * tests (real Postgres behind `MockGitHubClient`), not prototype spies.
 */

export type CiInstallationRow = typeof t.ciInstallations.$inferSelect;

/** Filters for the workspace CI-runs list (AC-35). */
export interface CiRunFilters {
  /** Only runs with `ran_at >= since` (the "last 7 days" window). */
  since?: Date;
  agentId?: string;
  repo?: string;
  status?: string;
  source?: string;
}

/** Column set for an ingest upsert into `agent_runs` (source='ci'). */
export interface CiRunUpsert {
  workspaceId: string;
  agentId: string | null;
  ciInstallationId: string;
  repo: string;
  githubUrl: string;
  prNumber: number | null;
  status: string;
  ranAt: Date;
  findingsCount?: number | null;
  /** Blocking (CRITICAL) finding count — drives the CI Runs severity split. */
  blockers?: number | null;
  costUsd?: number | null;
  durationMs?: number | null;
}

function toInstallationDto(row: CiInstallationRow): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType as CiTarget,
    installed_at: row.installedAt.toISOString(),
  };
}

/** Map an `agent_runs` row (+ joined agent name) to the CI-run DTO (C5). */
function toCiRunSummary(run: AgentRunRow, agentName: string | null): CiRunSummary {
  return {
    run_id: run.id,
    agent_id: run.agentId,
    agent_name: agentName ?? null,
    provider: run.provider,
    model: run.model,
    status: run.status,
    error: run.error,
    duration_ms: run.durationMs,
    tokens_in: run.tokensIn,
    tokens_out: run.tokensOut,
    findings_count: run.findingsCount,
    grounding: run.grounding,
    cost_usd: run.costUsd,
    ran_at: run.ranAt ? run.ranAt.toISOString() : null,
    score: run.score,
    blockers: run.blockers,
    source: run.source,
    repo: run.repo,
    pr_number: run.prNumber,
    github_url: run.githubUrl,
    ci_installation_id: run.ciInstallationId,
  };
}

export class CiRepository {
  constructor(private db: Db) {}

  // ---- ci_installations ---------------------------------------------------

  /** An installation for (agent, repo), if one already exists (idempotent export). */
  async findInstallation(agentId: string, repo: string): Promise<CiInstallation | undefined> {
    const [row] = await this.db
      .select()
      .from(t.ciInstallations)
      .where(and(eq(t.ciInstallations.agentId, agentId), eq(t.ciInstallations.repo, repo)));
    return row ? toInstallationDto(row) : undefined;
  }

  async insertInstallation(values: {
    agentId: string;
    repo: string;
    targetType: CiTarget;
  }): Promise<CiInstallation> {
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({ agentId: values.agentId, repo: values.repo, targetType: values.targetType })
      .returning();
    return toInstallationDto(row!);
  }

  /** Installations for one agent, newest first (the CI tab per-repo rows). */
  async listInstallationsForAgent(agentId: string): Promise<CiInstallation[]> {
    const rows = await this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId))
      .orderBy(desc(t.ciInstallations.installedAt));
    return rows.map(toInstallationDto);
  }

  /** All installations in a workspace (scoped via the agent join) — ingest source. */
  async listInstallationsForWorkspace(workspaceId: string): Promise<CiInstallation[]> {
    const rows = await this.db
      .select({ inst: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(eq(t.agents.workspaceId, workspaceId));
    return rows.map((r) => toInstallationDto(r.inst));
  }

  // ---- agent_runs WHERE source='ci' ---------------------------------------

  /** Workspace CI-runs list with optional filters, newest first (AC-32/AC-35). */
  async listCiRuns(workspaceId: string, filters: CiRunFilters = {}): Promise<CiRunSummary[]> {
    const conds = [eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.source, 'ci')];
    if (filters.since) conds.push(gte(t.agentRuns.ranAt, filters.since));
    if (filters.agentId) conds.push(eq(t.agentRuns.agentId, filters.agentId));
    if (filters.repo) conds.push(eq(t.agentRuns.repo, filters.repo));
    if (filters.status) conds.push(eq(t.agentRuns.status, filters.status));
    // `source` is a 'local' | 'ci' enum column; the base condition already pins
    // it to 'ci', so an extra non-'ci' filter simply matches nothing.
    if (filters.source) conds.push(eq(t.agentRuns.source, filters.source as 'local' | 'ci'));

    const rows = await this.db
      .select({ run: t.agentRuns, agentName: t.agents.name })
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .where(and(...conds))
      .orderBy(desc(t.agentRuns.ranAt));
    return rows.map(({ run, agentName }) => toCiRunSummary(run, agentName));
  }

  // ---- ingest upsert (idempotent by (workspace, installation, github_url)) --

  /** The existing CI run for this Actions run URL, if any (ingest idempotency). */
  async findRunByGithubUrl(
    workspaceId: string,
    ciInstallationId: string,
    githubUrl: string,
  ): Promise<{ id: string } | undefined> {
    const [row] = await this.db
      .select({ id: t.agentRuns.id })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.ciInstallationId, ciInstallationId),
          eq(t.agentRuns.githubUrl, githubUrl),
        ),
      );
    return row;
  }

  async insertCiRun(values: CiRunUpsert): Promise<void> {
    await this.db.insert(t.agentRuns).values({
      workspaceId: values.workspaceId,
      agentId: values.agentId,
      source: 'ci',
      status: values.status,
      ranAt: values.ranAt,
      repo: values.repo,
      githubUrl: values.githubUrl,
      prNumber: values.prNumber,
      ciInstallationId: values.ciInstallationId,
      findingsCount: values.findingsCount ?? null,
      blockers: values.blockers ?? null,
      costUsd: values.costUsd ?? null,
      durationMs: values.durationMs ?? null,
    });
  }

  async updateCiRun(id: string, values: CiRunUpsert): Promise<void> {
    await this.db
      .update(t.agentRuns)
      .set({
        status: values.status,
        ranAt: values.ranAt,
        prNumber: values.prNumber,
        findingsCount: values.findingsCount ?? null,
        blockers: values.blockers ?? null,
        costUsd: values.costUsd ?? null,
        durationMs: values.durationMs ?? null,
      })
      .where(eq(t.agentRuns.id, id));
  }
}
