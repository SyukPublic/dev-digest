import { randomUUID } from 'node:crypto';
import type { Container } from '../../platform/container.js';
import type {
  AgentColumn,
  AgentColumnFinding,
  AgentEstimate,
  MultiAgentRun,
  MultiAgentRunLaunch,
  ReviewRunTarget,
  Severity,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow, FindingRow } from '../../db/rows.js';
import type { ReviewRepository } from './repository.js';
import type { LatestMultiRun, MultiRunAgentRow } from './repository.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { buildConflicts } from './conflicts.js';

/**
 * Phase 5 (T10) — the multi-agent run coordinator (DEC-A: lives inside the
 * reviews module and reuses `ReviewRunExecutor` + `ReviewRepository` without
 * crossing a module facade). Orchestration only — the HTTP shape lives at the
 * route (Zod-parsed once at the edge), and every DB access stays in the
 * repository. Shared entities (agents/reviews) are reached via the container
 * facade, never by deep-importing another module.
 *
 * Responsibilities:
 *   - launch()    validate the requested agents belong to the workspace + are
 *                 enabled (reject foreign/unknown/disabled ids), persist the
 *                 multi-run grouping, create one `agent_runs` row per agent
 *                 (up-front so SSE can subscribe immediately), and fire-and-forget
 *                 the parallel executor. Returns the DEC-F ack.
 *   - getLatest() assemble the persisted grouping into a `MultiAgentRun`: map the
 *                 grouped rows to columns, derive aggregates ON READ (count / MAX
 *                 duration / SUM priced cost), and compute conflicts (DEC-D).
 *   - estimates() per-agent pre-launch estimate for every workspace agent.
 */
export class MultiRunService {
  private repo: ReviewRepository;
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;

  constructor(private container: Container) {
    // Shared repositories via the composition-root facade (never re-`new`ed here).
    this.repo = container.reviewRepo;
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
  }

  /**
   * Launch an N-agent review over a PR. `agentIds` is attacker-controllable, so
   * every id is authorized against the caller's workspace (reject cross-workspace
   * / unknown) AND must be an enabled agent before any run is created.
   */
  async launch(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: Logger,
  ): Promise<MultiAgentRunLaunch> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const targets = await this.resolveAgents(workspaceId, agentIds);

    // Persist the grouping identity first, then create one `agent_runs` row per
    // agent up-front (linked to the group) so a runId is available IMMEDIATELY —
    // the client subscribes to each run's SSE before the slow review starts. One
    // batchId stamps the whole fan-out (parity with `ReviewService.runReview`).
    const multiRunId = await this.repo.createMultiRun(workspaceId, prId);
    const batchId = randomUUID();
    const runs: ReviewRunTarget[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
        batchId,
        multiAgentRunId: multiRunId,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: the executor fans out in parallel (D1) and persists each
    // run as it finishes; the client reads the assembled result later via
    // GET /pulls/:id/multi-agent.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error(
        { prId, multiRunId, err: (err as Error).message },
        'multi-agent: background execution crashed',
      );
    });

    return { multi_run_id: multiRunId, pr_id: prId, runs };
  }

  /**
   * Resolve + authorize the requested agent ids. Duplicates are collapsed
   * (preserving first-seen order). An id that is not an agent in this workspace
   * is rejected 404; an agent that exists but is disabled is rejected 400 — the
   * two symptoms of a bad launch body, caught at the edge of the orchestration.
   */
  private async resolveAgents(workspaceId: string, agentIds: string[]): Promise<AgentRow[]> {
    const seen = new Set<string>();
    const out: AgentRow[] = [];
    for (const id of agentIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const agent = await this.agents.getById(workspaceId, id);
      if (!agent) throw new NotFoundError(`Agent not found: ${id}`);
      if (!agent.enabled) {
        throw new AppError('agent_disabled', `Agent is disabled: ${id}`, 400);
      }
      out.push(agent);
    }
    return out;
  }

  /**
   * Assemble the latest persisted multi-agent run for a PR into a `MultiAgentRun`
   * (columns + derived aggregates + on-read conflicts), or `null` when the PR has
   * no multi-agent run yet. Workspace scoping is enforced by the repository (a
   * foreign workspace reads `undefined`); the pull lookup also yields `pr_number`.
   */
  async getLatest(workspaceId: string, prId: string): Promise<MultiAgentRun | null> {
    const latest = await this.repo.getLatestMultiRun(workspaceId, prId);
    if (!latest) return null;
    const pull = await this.repo.getPull(workspaceId, prId);

    const columns = latest.agents.map((a) => toColumn(a));

    // Aggregates ON READ (DEC-B / AC-11/14): agents run in PARALLEL, so wall-clock
    // ≈ the MAX per-agent duration (not the SUM); cost is the SUM over PRICED runs
    // (null when none is priced — never 0-as-"unknown").
    const agentCount = columns.length;
    const totalDurationMs = columns.reduce((max, c) => Math.max(max, c.duration_ms ?? 0), 0);
    const pricedCosts = columns
      .map((c) => c.cost_usd)
      .filter((c): c is number => c != null);
    const totalCostUsd = pricedCosts.length
      ? pricedCosts.reduce((sum, c) => sum + c, 0)
      : null;

    return {
      id: latest.id,
      pr_id: latest.prId,
      pr_number: pull?.number ?? null,
      ran_at: latest.ranAt.toISOString(),
      agent_count: agentCount,
      total_duration_ms: totalDurationMs,
      total_cost_usd: totalCostUsd,
      columns,
      conflicts: buildConflicts(columns),
    };
  }

  /**
   * Per-agent pre-launch estimate for EVERY workspace agent (DEC-E). Historical
   * averages come from the repository over the agent's completed runs; agents
   * with no done runs are absent there, so the service fills them back with
   * `sample_size: 0` and null averages, joining the agent name.
   */
  async estimates(workspaceId: string): Promise<AgentEstimate[]> {
    const agents = await this.agents.list(workspaceId);
    const rows = await this.repo.agentRunEstimates(
      workspaceId,
      agents.map((a) => a.id),
    );
    const byId = new Map(rows.map((r) => [r.agent_id, r]));
    return agents.map((a) => {
      const row = byId.get(a.id);
      return {
        agent_id: a.id,
        agent_name: a.name,
        avg_duration_ms: row?.avg_duration_ms ?? null,
        avg_cost_usd: row?.avg_cost_usd ?? null,
        sample_size: row?.sample_size ?? 0,
      };
    });
  }
}

/** Map a grouped agent read-back to its result column. */
function toColumn(a: MultiRunAgentRow): AgentColumn {
  const { run, review } = a;
  return {
    run_id: run.id,
    // Deleted-agent runs keep `agent_id`/name null (E13, `set null` on delete) —
    // degrade gracefully rather than drop the column.
    agent_id: run.agentId ?? '',
    agent_name: a.agentName ?? 'Unknown agent',
    provider: run.provider,
    model: run.model,
    status: mapStatus(run.status),
    verdict: review?.verdict ?? null,
    score: review?.score ?? run.score ?? null,
    summary: review?.summary ?? null,
    duration_ms: run.durationMs,
    cost_usd: run.costUsd,
    findings: a.findings.map(toColumnFinding),
  };
}

/** Map a persisted finding row to its multi-agent column subset. */
function toColumnFinding(f: FindingRow): AgentColumnFinding {
  return {
    id: f.id,
    severity: f.severity as Severity,
    category: f.category,
    title: f.title,
    file: f.file,
    start_line: f.startLine,
    kind: f.kind,
  };
}

/**
 * Narrow the free-text run status to the column enum. A `cancelled` run is shown
 * as `failed` (it did not complete a review); a null / unknown status is treated
 * as still `running`.
 */
function mapStatus(status: string | null): AgentColumn['status'] {
  if (status === 'done') return 'done';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'running';
}
