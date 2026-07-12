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
  EvalCaseDraft,
  EvalExpectation,
  Severity,
  FindingCategory,
  Provider,
  ReviewStrategy,
  EvalSkillSuiteRunAccepted,
  RunAllSkillsResult,
  EvalSkillSuiteDetail,
  EvalSkillDashboard,
  EvalSkillSummary,
  EvalSkillsWorkspaceDashboard,
  EvalSkillCompareResult,
  EvalSkillHostCandidates,
} from '@devdigest/shared';
import { EvalExpectedOutput } from '@devdigest/shared';
import type { SkillInput } from '@devdigest/reviewer-core';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../lib/diff-parser.js';
import type { AgentRow, SkillRow, EvalSkillSuiteRunRow } from '../../db/rows.js';
import { EvalRepository } from './repository.js';
import { EvalRunExecutor, type SuiteSnapshot } from './run-executor.js';
import {
  SkillEvalRunExecutor,
  type SkillSuiteSnapshot,
  type HostLinkedSkill,
} from './skill-run-executor.js';
import { scoreCase, regressionAlert } from './scoring.js';
import type { Logger } from '../reviews/run-executor.js';
import {
  suiteRowToDto,
  skillSuiteRowToDto,
  runRowToRecord,
  caseRowToDto,
  caseListItem,
  latestRunPerCase,
} from './helpers.js';
import { EVAL_OWNER_AGENT, EVAL_OWNER_SKILL, RECENT_RUNS_LIMIT } from './constants.js';

/** A trusted skill body (source ∈ {manual, extracted}); imported/community are untrusted. */
function skillTrusted(source: SkillRow['source']): boolean {
  return source === 'manual' || source === 'extracted';
}

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
  private skillExecutor: SkillEvalRunExecutor;

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
    this.agents = container.agentsRepo;
    this.reviews = container.reviewRepo;
    this.executor = new EvalRunExecutor(container, this.repo);
    this.skillExecutor = new SkillEvalRunExecutor(container, this.repo);
  }

  /** Reap suites left `running` by a dead process. Called on boot (AC-25). */
  async reapStaleSuites(): Promise<number> {
    return this.repo.reapStaleRunningSuites();
  }

  /** Reap differential (skill) suites left `running` by a dead process (AC-22). */
  async reapStaleSkillSuites(): Promise<number> {
    return this.repo.reapStaleRunningSkillSuites();
  }

  // ===========================================================================
  // Case creation
  // ===========================================================================

  /**
   * T15 — create an eval case from a decided finding. Persists the derived draft
   * (see `deriveDraftFromFinding`) straight to a case. Used by the direct
   * `POST /findings/:id/eval-case` path (and integration seeding).
   */
  async createCaseFromFinding(workspaceId: string, findingId: string): Promise<EvalCase> {
    const draft = await this.deriveDraftFromFinding(workspaceId, findingId);
    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: EVAL_OWNER_AGENT,
      ownerId: draft.agent_id,
      name: draft.name,
      inputDiff: draft.input_diff,
      inputMeta: draft.input_meta,
      expectedOutput: draft.expected_output,
    });
    return caseRowToDto(row);
  }

  /**
   * Preview the case a finding WOULD produce, without persisting it — feeds the
   * Case Editor opened from a PR finding so the user can review/edit before Save
   * creates the case via `createCase`. Same derivation + guards (AC-3/AC-4) as
   * `createCaseFromFinding`; nothing is written.
   */
  async previewCaseFromFinding(workspaceId: string, findingId: string): Promise<EvalCaseDraft> {
    return this.deriveDraftFromFinding(workspaceId, findingId);
  }

  /**
   * Shared derivation: resolves finding→review→agent (owner), captures the
   * finding's CURRENT `pr_files` patch as the case diff (a stale-anchor finding
   * whose file is still present still yields a real diff, AC-5), the PR meta, and
   * an `expected_output` envelope keyed off the accept/dismiss decision. Rejects
   * a pending finding (AC-3) and one whose file is gone (AC-4, no empty case).
   */
  private async deriveDraftFromFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<EvalCaseDraft> {
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
          // Runtime values are already the stored enum members (this envelope
          // round-trips through EvalExpectedOutput); the row types them as string.
          severity: finding.severity as Severity,
          category: finding.category as FindingCategory,
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

    return {
      agent_id: agentId,
      agent_name: agent.name,
      name: finding.title,
      input_diff: inputDiff,
      input_meta: meta,
      expected_output: expected,
    };
  }

  /**
   * T16 — manual create. Owner-generic: an `agent` owner must resolve to an agent,
   * a `skill` owner to a skill (differential surface). Rejects an unparseable diff
   * (AC-30) + a bad envelope (AC-31) for both.
   */
  async createCase(workspaceId: string, input: EvalCaseInput): Promise<EvalCase> {
    await this.assertOwnerExists(workspaceId, input.owner_kind, input.owner_id);

    const inputDiff = input.input_diff ?? '';
    if (parseUnifiedDiff(inputDiff).files.length === 0) {
      throw new ValidationError('Diff parses to zero files'); // AC-30
    }
    const expected = EvalExpectedOutput.parse(input.expected_output); // 422 on invalid (AC-31)

    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: input.owner_kind,
      ownerId: input.owner_id,
      name: input.name,
      inputDiff,
      inputMeta: input.input_meta ?? null,
      expectedOutput: expected,
      notes: input.notes ?? null,
    });
    return caseRowToDto(row);
  }

  /** Validate the case owner exists (agent OR skill) before create/update. */
  private async assertOwnerExists(
    workspaceId: string,
    ownerKind: EvalCaseInput['owner_kind'],
    ownerId: string,
  ): Promise<void> {
    if (ownerKind === EVAL_OWNER_SKILL) {
      const skill = await this.repo.getSkill(workspaceId, ownerId);
      if (!skill) throw new NotFoundError('Skill not found');
      return;
    }
    const agent = await this.agents.getById(workspaceId, ownerId);
    if (!agent) throw new NotFoundError('Agent not found');
  }

  /** T16 — manual update (same owner-generic validations as create). */
  async updateCase(workspaceId: string, id: string, input: EvalCaseInput): Promise<EvalCase> {
    const existing = await this.repo.getCase(workspaceId, id);
    if (!existing) throw new NotFoundError('Eval case not found');
    await this.assertOwnerExists(workspaceId, input.owner_kind, input.owner_id);

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

  // ===========================================================================
  // Differential (skill) eval — the DELTA surface
  //
  // A skill has no model/prompt/strategy, so it is only meaningful as a delta on
  // a HOST agent's review: run the host twice over each case (WITHOUT / WITH the
  // skill) and score the findings the skill caused. Orchestration mirrors the
  // agent path; the two-arm work lives in `SkillEvalRunExecutor`, the metric math
  // in the reused `scoring.ts`.
  // ===========================================================================

  /** T17 — a skill's eval cases as list items (mirror `listAgentCases`). */
  async listSkillCases(workspaceId: string, skillId: string): Promise<EvalCaseListItem[]> {
    const skill = await this.repo.getSkill(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');
    const cases = await this.repo.listCasesByOwner(workspaceId, skillId);
    const runs = await this.repo.listRunsByCases(cases.map((c) => c.id));
    const latest = latestRunPerCase(runs);
    return cases.map((c) => caseListItem(c, latest.get(c.id) ?? null));
  }

  /**
   * T18 — the host agents a skill can be evaluated on (AC-4/AC-6). Default host =
   * the FIRST enabled agent already LINKING the skill; when none links it the
   * picker falls back to the full enabled-agent list (default stays null so a
   * host must be chosen explicitly). Each candidate carries its enabled flag.
   */
  async resolveSkillHosts(workspaceId: string, skillId: string): Promise<EvalSkillHostCandidates> {
    const skill = await this.repo.getSkill(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');

    const linking = await this.agents.listEnabledLinkingSkill(workspaceId, skillId);
    const defaultHostId = linking[0]?.id ?? null;
    // Fall back to all enabled agents when no enabled agent links the skill, so
    // the user can still pick a host manually (a skill delta needs some host).
    const source = linking.length > 0 ? linking : await this.agents.listEnabled(workspaceId);
    return {
      default_host_id: defaultHostId,
      candidates: source.map((a) => ({
        id: a.id,
        name: a.name,
        version: a.version,
        enabled: a.enabled,
      })),
    };
  }

  /**
   * T19 — start a differential suite for a skill on an explicit host (AC-8/AC-19/
   * AC-20). 409 if a skill suite is already running; reject a missing/disabled
   * host and a zero-case skill (no empty suite). Fire-and-forget: the id returns
   * immediately.
   */
  async startSkillSuite(
    workspaceId: string,
    skillId: string,
    hostAgentId: string,
    logger?: Logger,
  ): Promise<EvalSkillSuiteRunAccepted> {
    const skill = await this.repo.getSkill(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');
    const host = await this.requireEnabledHost(workspaceId, hostAgentId);

    const running = await this.repo.oneRunningForSkill(workspaceId, skillId);
    if (running) {
      throw new AppError('suite_running', 'A suite is already running for this skill', 409);
    }

    const cases = await this.repo.listCasesByOwner(workspaceId, skillId);
    if (cases.length === 0) {
      throw new AppError('no_cases', 'Skill has no eval cases to run', 400);
    }

    const suiteRunId = await this.beginSkillSuite(
      workspaceId,
      skill,
      host,
      cases.map((c) => c.id),
      logger,
    );
    return { suite_run_id: suiteRunId, status: 'running' };
  }

  /**
   * T20 — start a differential suite for EVERY skill with >=1 case AND a
   * resolvable default host (the first enabled agent linking it). Skips
   * `no_cases` / `no_host` / `already_running`; reports started + skipped (AC-25).
   */
  async runAllSkills(workspaceId: string, logger?: Logger): Promise<RunAllSkillsResult> {
    const skills = await this.repo.listSkills(workspaceId);
    const started: RunAllSkillsResult['started'] = [];
    const skipped: RunAllSkillsResult['skipped'] = [];

    for (const skill of skills) {
      const cases = await this.repo.listCasesByOwner(workspaceId, skill.id);
      if (cases.length === 0) {
        skipped.push({ skill_id: skill.id, reason: 'no_cases' });
        continue;
      }
      const linking = await this.agents.listEnabledLinkingSkill(workspaceId, skill.id);
      const host = linking[0];
      if (!host) {
        skipped.push({ skill_id: skill.id, reason: 'no_host' });
        continue;
      }
      const running = await this.repo.oneRunningForSkill(workspaceId, skill.id);
      if (running) {
        skipped.push({ skill_id: skill.id, reason: 'already_running' });
        continue;
      }
      const suiteRunId = await this.beginSkillSuite(
        workspaceId,
        skill,
        host,
        cases.map((c) => c.id),
        logger,
      );
      started.push({ skill_id: skill.id, suite_run_id: suiteRunId });
    }
    return { started, skipped };
  }

  /** Insert the running skill suite + fire-and-forget the executor; returns the id now. */
  private async beginSkillSuite(
    workspaceId: string,
    skill: SkillRow,
    host: AgentRow,
    caseIds: string[],
    logger?: Logger,
  ): Promise<string> {
    const snapshot = await this.resolveSkillSnapshot(workspaceId, skill, host, caseIds);
    const suite = await this.repo.insertSkillSuite({
      workspaceId,
      skillId: skill.id,
      skillVersion: skill.version,
      hostAgentId: host.id,
      hostAgentVersion: host.version,
    });
    void this.skillExecutor.run(suite.id, snapshot, logger).catch((err) => {
      logger?.error({ suiteId: suite.id, err: (err as Error).message }, 'skill-eval: suite crashed');
    });
    return suite.id;
  }

  /**
   * T17 / AC-12 — snapshot EVERYTHING a differential run needs ONCE at start so a
   * mid-run skill OR host edit can't leak: the skill under eval (body + version +
   * source), the host agent config + version, and the host's enabled linked skill
   * BODIES (id-tagged, trust-flagged). Bodies are captured here, not re-read per
   * case.
   */
  private async resolveSkillSnapshot(
    workspaceId: string,
    skill: SkillRow,
    host: AgentRow,
    caseIds: string[],
  ): Promise<SkillSuiteSnapshot> {
    const linked = (await this.agents.linkedSkills(host.id)).filter((l) => l.skill.enabled);
    const hostSkills: HostLinkedSkill[] = linked.map((l) => ({
      skillId: l.skill.id,
      body: l.skill.body,
      trusted: skillTrusted(l.skill.source),
    }));
    return {
      workspaceId,
      skillId: skill.id,
      skillVersion: skill.version,
      skillBody: skill.body,
      skillSource: skill.source,
      hostAgentId: host.id,
      hostAgentName: host.name,
      hostAgentVersion: host.version,
      provider: host.provider as Provider,
      model: host.model,
      systemPrompt: host.systemPrompt,
      strategy: (host.strategy ?? 'single-pass') as ReviewStrategy,
      hostSkills,
      caseIds,
    };
  }

  /** T21 — run a single skill case through the same two-arm executor + scorer (AC-9). */
  async runSingleSkillCase(
    workspaceId: string,
    caseId: string,
    hostAgentId: string,
  ): Promise<EvalRunResult> {
    const caseRow = await this.repo.getCase(workspaceId, caseId);
    if (!caseRow) throw new NotFoundError('Eval case not found');
    if (caseRow.ownerKind !== EVAL_OWNER_SKILL) {
      throw new AppError('not_a_skill_case', 'Case is not a skill eval case', 400);
    }
    const skill = await this.repo.getSkill(workspaceId, caseRow.ownerId);
    if (!skill) throw new NotFoundError('Skill not found');
    const host = await this.requireEnabledHost(workspaceId, hostAgentId);

    const snapshot = await this.resolveSkillSnapshot(workspaceId, skill, host, [caseId]);
    const llm = await this.container.llm(snapshot.provider);

    try {
      const exec = await this.skillExecutor.executeCase(caseRow, snapshot, llm);
      const score = scoreCase(exec);
      // A single-case run belongs to NEITHER suite parent (both FKs null).
      const run = await this.repo.insertRun({
        caseId,
        skillSuiteRunId: null,
        actualOutput: exec.delta,
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
            { name: caseRow.name, pass: score.pass, expected: exec.expected, actual: exec.delta },
          ],
        },
      };
    } catch (err) {
      await this.repo
        .insertRun({
          caseId,
          skillSuiteRunId: null,
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

  /** A host must exist AND be enabled at run start — never an empty/dead suite (AC-6). */
  private async requireEnabledHost(workspaceId: string, hostAgentId: string): Promise<AgentRow> {
    const host = await this.agents.getById(workspaceId, hostAgentId);
    if (!host) throw new NotFoundError('Host agent not found');
    if (!host.enabled) {
      throw new AppError('host_disabled', 'Host agent is disabled', 400);
    }
    return host;
  }

  /** T22 — a skill suite + its per-case delta rows (progressive read for polling). */
  async getSkillSuiteDetail(
    workspaceId: string,
    suiteId: string,
  ): Promise<EvalSkillSuiteDetail> {
    const suite = await this.repo.getSkillSuite(workspaceId, suiteId);
    if (!suite) throw new NotFoundError('Suite run not found');
    const runs = await this.repo.listRunsBySkillSuite(suiteId);
    const cases = await this.repo.listCasesByOwner(workspaceId, suite.skillId);
    const nameById = new Map(cases.map((c) => [c.id, c.name]));
    const skill = await this.repo.getSkill(workspaceId, suite.skillId);
    const host = await this.agents.getById(workspaceId, suite.hostAgentId);
    return {
      suite: skillSuiteRowToDto(suite, skill?.name ?? null, host?.name ?? null),
      runs: runs.map((r) => runRowToRecord(r, nameById.get(r.caseId) ?? null)),
    };
  }

  /** T23 — per-skill dashboard aggregate (null-safe delta metrics; code-computed alert). */
  async buildSkillDashboard(
    workspaceId: string,
    skillId: string,
  ): Promise<EvalSkillDashboard> {
    const skill = await this.repo.getSkill(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');

    const cases = await this.repo.listCasesByOwner(workspaceId, skillId);
    const suites = await this.repo.listSkillSuitesBySkill(workspaceId, skillId, RECENT_RUNS_LIMIT);
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

    // Trend: one point per completed skill suite run, oldest-first for the chart;
    // tooltip carries BOTH the skill version and the host agent version + cost.
    const trend = [...completed].reverse().map((s) => ({
      suite_run_id: s.id,
      ran_at: s.ranAt instanceof Date ? s.ranAt.toISOString() : (s.ranAt as unknown as string),
      skill_version: s.skillVersion,
      host_agent_id: s.hostAgentId,
      host_agent_version: s.hostAgentVersion,
      recall: s.recall ?? null,
      precision: s.precision ?? null,
      citation_accuracy: s.citationAccuracy ?? null,
      pass_rate: s.total > 0 ? s.passed / s.total : null,
      cost_usd: s.costUsd ?? null,
    }));

    // Reuse the L06 regression alert verbatim (feed skill_version as the version),
    // then adapt the label to name the skill and note a host change (AC-27).
    const base = regressionAlert(
      completed.map((s) => ({
        agent_version: s.skillVersion,
        recall: s.recall ?? null,
        precision: s.precision ?? null,
        citation_accuracy: s.citationAccuracy ?? null,
      })),
    );
    const alert = adaptSkillAlert(base, latest, prev);

    return {
      skill_id: skillId,
      skill_name: skill.name,
      cases_total: cases.length,
      current,
      delta,
      trend,
      recent_runs: suites.map((s) => skillSuiteRowToDto(s, skill.name)),
      alert,
    };
  }

  /** T24 — all-skills dashboard aggregate for `/eval?tab=skills` (AC-24). */
  async buildSkillsWorkspaceDashboard(
    workspaceId: string,
  ): Promise<EvalSkillsWorkspaceDashboard> {
    const skills = await this.repo.listSkills(workspaceId);
    const skillNameById = new Map(skills.map((s) => [s.id, s.name]));
    const agents = await this.agents.list(workspaceId);
    const agentNameById = new Map(agents.map((a) => [a.id, a.name]));
    const summaries: EvalSkillSummary[] = [];

    for (const skill of skills) {
      const cases = await this.repo.listCasesByOwner(workspaceId, skill.id);
      const suites = await this.repo.listSkillSuitesBySkill(
        workspaceId,
        skill.id,
        RECENT_RUNS_LIMIT,
      );
      const completed = suites.filter((s) => s.status === 'done');
      const last = completed[0] ?? null;
      const chrono = [...completed].reverse();
      const series = (pick: (s: EvalSkillSuiteRunRow) => number | null | undefined) =>
        chrono.map(pick).filter((n): n is number => n != null);
      summaries.push({
        skill_id: skill.id,
        skill_name: skill.name,
        enabled: skill.enabled,
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
        last_run: last
          ? skillSuiteRowToDto(last, skill.name, agentNameById.get(last.hostAgentId) ?? null)
          : null,
      });
    }

    const recent = await this.repo.listRecentSkillSuites(workspaceId, RECENT_RUNS_LIMIT);
    return {
      skills: summaries,
      recent_runs: recent.map((s) =>
        skillSuiteRowToDto(
          s,
          skillNameById.get(s.skillId) ?? null,
          agentNameById.get(s.hostAgentId) ?? null,
        ),
      ),
    };
  }

  /**
   * T25 — compare two differential runs: metric + cost deltas, the SKILL BODY diff
   * (from `skill_versions`, null → "body unavailable"), each run's host id/version
   * (from the preserved suite row — no host FK, AC-32) and a `host_changed`
   * confounder flag (AC-28/AC-29). A deleted host degrades to a null host name.
   */
  async compareSkillRuns(
    workspaceId: string,
    runAId: string,
    runBId: string,
  ): Promise<EvalSkillCompareResult> {
    const a = await this.repo.getSkillSuite(workspaceId, runAId);
    if (!a) throw new NotFoundError('Suite run not found');
    const b = await this.repo.getSkillSuite(workspaceId, runBId);
    if (!b) throw new NotFoundError('Suite run not found');

    const bodyA = (await this.repo.getSkillVersionBody(a.skillId, a.skillVersion)) ?? null;
    const bodyB = (await this.repo.getSkillVersionBody(b.skillId, b.skillVersion)) ?? null;

    return {
      run_a: skillSuiteRowToDto(a, ...(await this.skillAndHostNames(workspaceId, a))),
      run_b: skillSuiteRowToDto(b, ...(await this.skillAndHostNames(workspaceId, b))),
      delta: {
        recall: diff(b.recall, a.recall),
        precision: diff(b.precision, a.precision),
        citation_accuracy: diff(b.citationAccuracy, a.citationAccuracy),
        cost_usd: diff(b.costUsd, a.costUsd),
      },
      skill_body_a: bodyA,
      skill_body_b: bodyB,
      // A delta shift is confounded when the host agent OR its version differs.
      host_changed: a.hostAgentId !== b.hostAgentId || a.hostAgentVersion !== b.hostAgentVersion,
    };
  }

  /** Joined display names for a skill-suite row (host name null when the agent is gone). */
  private async skillAndHostNames(
    workspaceId: string,
    suite: EvalSkillSuiteRunRow,
  ): Promise<[string | null, string | null]> {
    const skill = await this.repo.getSkill(workspaceId, suite.skillId);
    const host = await this.agents.getById(workspaceId, suite.hostAgentId);
    return [skill?.name ?? null, host?.name ?? null];
  }

  /**
   * T26 — service-level skill-delete cascade (AC-31). `owner_id` / `skill_id` carry
   * no DB FK, so a skill delete must remove its eval cases + differential suite
   * history here. Per-case `eval_runs` cascade via the `skill_suite_run_id` FK.
   * Called from the skills delete route once the skill row is gone.
   */
  async cascadeSkillDelete(workspaceId: string, skillId: string): Promise<void> {
    await this.repo.deleteCasesByOwner(workspaceId, skillId);
    await this.repo.deleteSkillSuitesBySkill(workspaceId, skillId);
  }
}

/**
 * Adapt the reused L06 regression label to the skill surface: name the skill
 * (`on v4` → `on skill v4`) and note a host change between the two latest
 * completed runs (a delta shift is confounded by the host — AC-27/AC-29). The
 * two-latest-completed logic itself stays in the pure `regressionAlert`.
 */
export function adaptSkillAlert(
  base: string | null,
  latest: Pick<EvalSkillSuiteRunRow, 'hostAgentId' | 'hostAgentVersion'> | undefined,
  prev: Pick<EvalSkillSuiteRunRow, 'hostAgentId' | 'hostAgentVersion'> | undefined,
): string | null {
  if (!base) return null;
  let label = base.replace(/ on v(\d+)$/, ' on skill v$1');
  if (
    latest &&
    prev &&
    (latest.hostAgentId !== prev.hostAgentId || latest.hostAgentVersion !== prev.hostAgentVersion)
  ) {
    label += ' (host changed)';
  }
  return label;
}

/** Build a minimal single-file unified diff from a stored `pr_files.patch`. */
function singleFileDiff(path: string, patch: string): string {
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, patch].join('\n');
}
