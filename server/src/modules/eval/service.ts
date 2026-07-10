import type { Container } from '../../platform/container.js';
import type {
  EvalCase,
  EvalCaseInput,
  EvalCaseListItem,
  EvalRunResult,
  EvalSuiteRunAccepted,
  RunAllResult,
  EvalSuiteDetail,
  EvalAgentDashboard,
  EvalWorkspaceDashboard,
  EvalCompareResult,
  EvalExpectation,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { EvalExpectedOutput } from '@devdigest/shared';
import type { SkillInput } from '@devdigest/reviewer-core';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../lib/diff-parser.js';
import type { AgentRow } from '../../db/rows.js';
import { EvalRepository } from './repository.js';
import { EvalRunExecutor, type SuiteSnapshot } from './run-executor.js';
import { scoreCase, regressionAlert } from './scoring.js';
import type { Logger } from '../reviews/run-executor.js';
import {
  suiteRowToDto,
  runRowToRecord,
  caseRowToDto,
  caseListItem,
  latestRunPerCase,
} from './helpers.js';
import { EVAL_OWNER_AGENT, RECENT_RUNS_LIMIT } from './constants.js';

/** Signed metric delta: null when either side is unknown. */
function diff(a: number | null | undefined, b: number | null | undefined): number | null {
  return a != null && b != null ? a - b : null;
}

/**
 * L06 Agent Eval Pipeline service. Orchestrates case creation (finding-derived +
 * manual), suite execution (fire-and-forget), single-case runs, dashboards, and
 * compare. Drizzle lives in the repository; the engine + scorer are reached via
 * the executor. Everything is workspace-scoped.
 */
export class EvalService {
  private repo: EvalRepository;
  private agents: Container['agentsRepo'];
  private reviews: Container['reviewRepo'];
  private executor: EvalRunExecutor;

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
    this.agents = container.agentsRepo;
    this.reviews = container.reviewRepo;
    this.executor = new EvalRunExecutor(container, this.repo);
  }

  /** Reap suites left `running` by a dead process. Called on boot (AC-25). */
  async reapStaleSuites(): Promise<number> {
    return this.repo.reapStaleRunningSuites();
  }

  // ===========================================================================
  // Case creation
  // ===========================================================================

  /**
   * T15 — create an eval case from a decided finding. Resolves finding→review→
   * agent (owner), captures the finding's CURRENT `pr_files` patch as the case
   * diff (a stale-anchor finding whose file is still present still yields a real
   * diff, AC-5), the PR meta, and an `expected_output` envelope keyed off the
   * accept/dismiss decision. Rejects (no empty case) when the file is gone (AC-4).
   */
  async createCaseFromFinding(workspaceId: string, findingId: string): Promise<EvalCase> {
    const ctx = await this.reviews.findingContext(findingId);
    if (!ctx) throw new NotFoundError('Finding not found');
    const { finding, review, pull } = ctx;
    // Workspace scope: findingContext is not scoped, so enforce it here.
    if (pull.workspaceId !== workspaceId) throw new NotFoundError('Finding not found');

    const agentId = review.agentId;
    if (!agentId) throw new AppError('finding_no_agent', 'Finding is not owned by an agent', 400);
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    // AC-3 server guard: a pending finding (no decision) cannot become a case.
    const accepted = finding.acceptedAt != null;
    const dismissed = finding.dismissedAt != null;
    if (!accepted && !dismissed) {
      throw new AppError('finding_pending', 'Finding has no decision yet', 400);
    }
    const expectation: EvalExpectation = accepted ? 'must_find' : 'must_not_flag';

    // Read the finding's file patch from the CURRENT pr_files (AC-1/AC-5).
    const files = await this.reviews.getPrFiles(pull.id);
    const file = files.find((f) => f.path === finding.file);
    if (!file || !file.patch) {
      // AC-4 — do NOT create an empty-diff case.
      throw new AppError(
        'file_absent',
        `File '${finding.file}' is no longer present in the PR`,
        400,
      );
    }
    const inputDiff = singleFileDiff(file.path, file.patch);
    if (parseUnifiedDiff(inputDiff).files.length === 0) {
      throw new AppError('file_absent', `File '${finding.file}' produced no diff`, 400);
    }

    const expected = {
      expectation,
      findings: [
        {
          file: finding.file,
          start_line: finding.startLine,
          end_line: finding.endLine,
          severity: finding.severity,
          category: finding.category,
          title: finding.title,
        },
      ],
    };
    const meta = {
      title: pull.title,
      ...(pull.body ? { body: pull.body } : {}),
      number: pull.number,
      base: pull.base,
    };

    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: EVAL_OWNER_AGENT,
      ownerId: agentId,
      name: finding.title,
      inputDiff,
      inputMeta: meta,
      expectedOutput: expected,
    });
    return caseRowToDto(row);
  }

  /** T16 — manual create. Rejects an unparseable diff (AC-30) + a bad envelope (AC-31). */
  async createCase(workspaceId: string, input: EvalCaseInput): Promise<EvalCase> {
    if (input.owner_kind !== EVAL_OWNER_AGENT) {
      throw new ValidationError('Only agent eval cases are supported');
    }
    const agent = await this.agents.getById(workspaceId, input.owner_id);
    if (!agent) throw new NotFoundError('Agent not found');

    const inputDiff = input.input_diff ?? '';
    if (parseUnifiedDiff(inputDiff).files.length === 0) {
      throw new ValidationError('Diff parses to zero files'); // AC-30
    }
    const expected = EvalExpectedOutput.parse(input.expected_output); // 422 on invalid (AC-31)

    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: EVAL_OWNER_AGENT,
      ownerId: input.owner_id,
      name: input.name,
      inputDiff,
      inputMeta: input.input_meta ?? null,
      expectedOutput: expected,
      notes: input.notes ?? null,
    });
    return caseRowToDto(row);
  }

  /** T16 — manual update (same validations as create). */
  async updateCase(workspaceId: string, id: string, input: EvalCaseInput): Promise<EvalCase> {
    const existing = await this.repo.getCase(workspaceId, id);
    if (!existing) throw new NotFoundError('Eval case not found');

    const inputDiff = input.input_diff ?? '';
    if (parseUnifiedDiff(inputDiff).files.length === 0) {
      throw new ValidationError('Diff parses to zero files'); // AC-30
    }
    const expected = EvalExpectedOutput.parse(input.expected_output); // AC-31

    const row = await this.repo.updateCase(workspaceId, id, {
      name: input.name,
      inputDiff,
      inputMeta: input.input_meta ?? null,
      expectedOutput: expected,
      notes: input.notes ?? null,
    });
    return caseRowToDto(row!);
  }

  /** T17 — delete a case; its per-case rows cascade, suite aggregates are preserved (AC-23). */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteCase(workspaceId, id);
  }

  /**
   * T18 — service-level agent-delete cascade (AC-24). `owner_id` / `agent_id`
   * carry no DB FK, so an agent delete must remove its eval cases + suite
   * history here. Called from the agents delete route.
   */
  async cascadeAgentDelete(workspaceId: string, agentId: string): Promise<void> {
    await this.repo.deleteCasesByOwner(workspaceId, agentId);
    await this.repo.deleteSuitesByAgent(workspaceId, agentId);
  }

  // ===========================================================================
  // Reads (case list)
  // ===========================================================================

  /** T19 — an agent's eval cases as list items (status + latest-run summary). */
  async listAgentCases(workspaceId: string, agentId: string): Promise<EvalCaseListItem[]> {
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const cases = await this.repo.listCasesByOwner(workspaceId, agentId);
    const runs = await this.repo.listRunsByCases(cases.map((c) => c.id));
    const latest = latestRunPerCase(runs);
    return cases.map((c) => caseListItem(c, latest.get(c.id) ?? null));
  }

  /** A single case (for the Case Editor). */
  async getCase(workspaceId: string, id: string): Promise<EvalCase> {
    const row = await this.repo.getCase(workspaceId, id);
    if (!row) throw new NotFoundError('Eval case not found');
    return caseRowToDto(row);
  }

  // ===========================================================================
  // Suite execution
  // ===========================================================================

  /** T24 — start a suite for an agent (409 if running, reject when zero cases). */
  async startSuite(
    workspaceId: string,
    agentId: string,
    logger?: Logger,
  ): Promise<EvalSuiteRunAccepted> {
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const running = await this.repo.oneRunningForAgent(workspaceId, agentId);
    if (running) throw new AppError('suite_running', 'A suite is already running for this agent', 409);

    const cases = await this.repo.listCasesByOwner(workspaceId, agentId);
    if (cases.length === 0) throw new AppError('no_cases', 'Agent has no eval cases to run', 400);

    const suiteRunId = await this.beginSuite(workspaceId, agent, cases.map((c) => c.id), logger);
    return { suite_run_id: suiteRunId, status: 'running' };
  }

  /** T25 — start a suite for every ENABLED agent with >=1 case (AC-33). */
  async runAllAgents(workspaceId: string, logger?: Logger): Promise<RunAllResult> {
    const agents = await this.agents.listEnabled(workspaceId);
    const started: RunAllResult['started'] = [];
    const skipped: RunAllResult['skipped'] = [];
    for (const agent of agents) {
      const cases = await this.repo.listCasesByOwner(workspaceId, agent.id);
      if (cases.length === 0) {
        skipped.push({ agent_id: agent.id, reason: 'no_cases' });
        continue;
      }
      const running = await this.repo.oneRunningForAgent(workspaceId, agent.id);
      if (running) {
        skipped.push({ agent_id: agent.id, reason: 'already_running' });
        continue;
      }
      const suiteRunId = await this.beginSuite(workspaceId, agent, cases.map((c) => c.id), logger);
      started.push({ agent_id: agent.id, suite_run_id: suiteRunId });
    }
    return { started, skipped };
  }

  /** Insert the running suite + fire-and-forget the executor; returns the id now. */
  private async beginSuite(
    workspaceId: string,
    agent: AgentRow,
    caseIds: string[],
    logger?: Logger,
  ): Promise<string> {
    const snapshot = await this.resolveSnapshot(workspaceId, agent, caseIds);
    const suite = await this.repo.insertSuite({
      workspaceId,
      agentId: agent.id,
      agentVersion: agent.version,
    });
    void this.executor.run(suite.id, snapshot, logger).catch((err) => {
      logger?.error({ suiteId: suite.id, err: (err as Error).message }, 'eval: suite crashed');
    });
    return suite.id;
  }

  /**
   * T20 — snapshot the agent config ONCE (systemPrompt/model/provider/strategy +
   * version + RESOLVED enabled-skill BODIES) so mid-run edits don't leak (AC-14).
   */
  private async resolveSnapshot(
    workspaceId: string,
    agent: AgentRow,
    caseIds: string[],
  ): Promise<SuiteSnapshot> {
    const linked = (await this.agents.linkedSkills(agent.id)).filter((l) => l.skill.enabled);
    const skills: SkillInput[] = linked.map((l) => ({
      body: l.skill.body,
      trusted: l.skill.source === 'manual' || l.skill.source === 'extracted',
    }));
    return {
      workspaceId,
      agentId: agent.id,
      agentName: agent.name,
      agentVersion: agent.version,
      provider: agent.provider as Provider,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      strategy: (agent.strategy ?? 'single-pass') as ReviewStrategy,
      skills,
      caseIds,
    };
  }

  /** T26 — run a single case through the same executor/scoring path. */
  async runSingleCase(workspaceId: string, caseId: string): Promise<EvalRunResult> {
    const caseRow = await this.repo.getCase(workspaceId, caseId);
    if (!caseRow) throw new NotFoundError('Eval case not found');
    const agent = await this.agents.getById(workspaceId, caseRow.ownerId);
    if (!agent) throw new NotFoundError('Agent not found');

    const snapshot = await this.resolveSnapshot(workspaceId, agent, [caseId]);
    const llm = await this.container.llm(snapshot.provider);

    try {
      const exec = await this.executor.executeCase(caseRow, snapshot, llm);
      const score = scoreCase(exec);
      const run = await this.repo.insertRun({
        caseId,
        suiteRunId: null,
        actualOutput: exec.review,
        pass: score.pass,
        recall: score.recall,
        precision: score.precision,
        citationAccuracy: score.citation_accuracy,
        durationMs: exec.durationMs,
        costUsd: score.cost_usd,
      });
      return {
        run_id: run.id,
        case_id: caseId,
        result: {
          recall: score.recall ?? 0,
          precision: score.precision ?? 0,
          citation_accuracy: score.citation_accuracy ?? 0,
          traces_passed: score.pass ? 1 : 0,
          traces_total: 1,
          duration_ms: exec.durationMs,
          cost_usd: score.cost_usd,
          per_trace: [
            { name: caseRow.name, pass: score.pass, expected: exec.expected, actual: exec.review },
          ],
        },
      };
    } catch (err) {
      // Persist the failure as an error row (mirrors the suite path, AC-21).
      await this.repo
        .insertRun({
          caseId,
          suiteRunId: null,
          actualOutput: null,
          pass: false,
          recall: null,
          precision: null,
          citationAccuracy: null,
          durationMs: 0,
          costUsd: null,
          error: (err as Error).message,
        })
        .catch(() => undefined);
      throw new AppError('case_run_failed', (err as Error).message, 502);
    }
  }

  /** T27 — a suite + its per-case rows (progressive read for polling). */
  async getSuiteDetail(workspaceId: string, suiteId: string): Promise<EvalSuiteDetail> {
    const suite = await this.repo.getSuite(workspaceId, suiteId);
    if (!suite) throw new NotFoundError('Suite run not found');
    const runs = await this.repo.listRunsBySuite(suiteId);
    const cases = await this.repo.listCasesByOwner(workspaceId, suite.agentId);
    const nameById = new Map(cases.map((c) => [c.id, c.name]));
    return {
      suite: suiteRowToDto(suite),
      runs: runs.map((r) => runRowToRecord(r, nameById.get(r.caseId) ?? null)),
    };
  }

  // ===========================================================================
  // Dashboards + compare
  // ===========================================================================

  /** T29 — per-agent dashboard aggregate (null-safe metrics; code-computed alert). */
  async buildAgentDashboard(workspaceId: string, agentId: string): Promise<EvalAgentDashboard> {
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const cases = await this.repo.listCasesByOwner(workspaceId, agentId);
    const suites = await this.repo.listSuitesByAgent(workspaceId, agentId, RECENT_RUNS_LIMIT);
    const completed = suites.filter((s) => s.status === 'done');
    const latest = completed[0];
    const prev = completed[1];

    const current = latest
      ? {
          recall: latest.recall ?? null,
          precision: latest.precision ?? null,
          citation_accuracy: latest.citationAccuracy ?? null,
          traces_passed: latest.passed,
          traces_total: latest.total,
          cost_usd: latest.costUsd ?? null,
        }
      : {
          recall: null,
          precision: null,
          citation_accuracy: null,
          traces_passed: 0,
          traces_total: 0,
          cost_usd: null,
        };

    const delta = {
      recall: diff(latest?.recall, prev?.recall),
      precision: diff(latest?.precision, prev?.precision),
      citation_accuracy: diff(latest?.citationAccuracy, prev?.citationAccuracy),
    };

    // Trend: one point per completed suite run, oldest-first for the chart.
    const trend = [...completed].reverse().map((s) => ({
      suite_run_id: s.id,
      ran_at: s.ranAt instanceof Date ? s.ranAt.toISOString() : (s.ranAt as unknown as string),
      agent_version: s.agentVersion,
      recall: s.recall ?? null,
      precision: s.precision ?? null,
      citation_accuracy: s.citationAccuracy ?? null,
      pass_rate: s.total > 0 ? s.passed / s.total : null,
      cost_usd: s.costUsd ?? null,
    }));

    const alert = regressionAlert(
      completed.map((s) => ({
        agent_version: s.agentVersion,
        recall: s.recall ?? null,
        precision: s.precision ?? null,
        citation_accuracy: s.citationAccuracy ?? null,
      })),
    );

    return {
      agent_id: agentId,
      agent_name: agent.name,
      model: agent.model,
      cases_total: cases.length,
      current,
      delta,
      trend,
      recent_runs: suites.map((s) => suiteRowToDto(s, agent.name)),
      alert,
    };
  }

  /** T29 — all-agents dashboard aggregate for `/eval`. */
  async buildWorkspaceDashboard(workspaceId: string): Promise<EvalWorkspaceDashboard> {
    const agents = await this.agents.list(workspaceId);
    const nameById = new Map(agents.map((a) => [a.id, a.name]));
    const summaries: EvalWorkspaceDashboard['agents'] = [];

    for (const a of agents) {
      const cases = await this.repo.listCasesByOwner(workspaceId, a.id);
      const suites = await this.repo.listSuitesByAgent(workspaceId, a.id, RECENT_RUNS_LIMIT);
      const completed = suites.filter((s) => s.status === 'done');
      const last = completed[0] ?? null;
      const chrono = [...completed].reverse();
      const series = (pick: (s: (typeof chrono)[number]) => number | null | undefined) =>
        chrono.map(pick).filter((n): n is number => n != null);
      summaries.push({
        agent_id: a.id,
        agent_name: a.name,
        model: a.model,
        enabled: a.enabled,
        cases_total: cases.length,
        current: last
          ? {
              recall: last.recall ?? null,
              precision: last.precision ?? null,
              citation_accuracy: last.citationAccuracy ?? null,
            }
          : { recall: null, precision: null, citation_accuracy: null },
        sparklines: {
          recall: series((s) => s.recall),
          precision: series((s) => s.precision),
          citation_accuracy: series((s) => s.citationAccuracy),
        },
        last_run: last ? suiteRowToDto(last, a.name) : null,
      });
    }

    const recent = await this.repo.listRecentSuites(workspaceId, RECENT_RUNS_LIMIT);
    return {
      agents: summaries,
      recent_runs: recent.map((s) => suiteRowToDto(s, nameById.get(s.agentId) ?? null)),
    };
  }

  /** T30 — compare two suite runs: metric deltas + system-prompt diff (AC-27/AC-28). */
  async compareRuns(
    workspaceId: string,
    runAId: string,
    runBId: string,
  ): Promise<EvalCompareResult> {
    const a = await this.repo.getSuite(workspaceId, runAId);
    if (!a) throw new NotFoundError('Suite run not found');
    const b = await this.repo.getSuite(workspaceId, runBId);
    if (!b) throw new NotFoundError('Suite run not found');

    const promptA = await this.systemPromptForRun(a.agentId, a.agentVersion);
    const promptB = await this.systemPromptForRun(b.agentId, b.agentVersion);

    return {
      run_a: suiteRowToDto(a),
      run_b: suiteRowToDto(b),
      delta: {
        recall: diff(b.recall, a.recall),
        precision: diff(b.precision, a.precision),
        citation_accuracy: diff(b.citationAccuracy, a.citationAccuracy),
        cost_usd: diff(b.costUsd, a.costUsd),
      },
      system_prompt_a: promptA,
      system_prompt_b: promptB,
      // Both prompts must be present for a meaningful diff; a missing
      // agent_versions row degrades to "config unavailable" (AC-28).
      config_available: promptA != null && promptB != null,
    };
  }

  /** Read a run's system prompt from its `agent_versions.config_json`, or null. */
  private async systemPromptForRun(agentId: string, version: number): Promise<string | null> {
    const row = await this.agents.getVersion(agentId, version);
    if (!row) return null;
    const config = row.configJson as { system_prompt?: string } | null;
    return config?.system_prompt ?? null;
  }
}

/** Build a minimal single-file unified diff from a stored `pr_files.patch`. */
function singleFileDiff(path: string, patch: string): string {
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, patch].join('\n');
}
