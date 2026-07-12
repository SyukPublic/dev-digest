import type {
  EvalSuiteRun,
  EvalSkillSuiteRun,
  EvalCaseRunRecord,
  EvalExpectedOutput,
  EvalCaseListItem,
  EvalCase,
} from '@devdigest/shared';
import { EvalExpectedOutput as EvalExpectedOutputSchema } from '@devdigest/shared';
import type {
  EvalCaseRow,
  EvalRunRow,
  EvalSuiteRunRow,
  EvalSkillSuiteRunRow,
} from '../../db/rows.js';

/**
 * Pure row → contract mappers + envelope parsing for the eval module. No I/O.
 */

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function caseRowToDto(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles,
    input_meta: row.inputMeta,
    expected_output: row.expectedOutput,
    notes: row.notes ?? null,
  };
}

export function suiteRowToDto(row: EvalSuiteRunRow, agentName?: string | null): EvalSuiteRun {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    agent_id: row.agentId,
    ...(agentName !== undefined ? { agent_name: agentName } : {}),
    agent_version: row.agentVersion,
    status: row.status,
    recall: row.recall ?? null,
    precision: row.precision ?? null,
    citation_accuracy: row.citationAccuracy ?? null,
    passed: row.passed,
    total: row.total,
    cost_usd: row.costUsd ?? null,
    duration_ms: row.durationMs,
    ran_at: iso(row.ranAt),
  };
}

/**
 * Skill (differential) suite row → DTO. Sibling of `suiteRowToDto`: it carries
 * the HOST agent the two arms ran on (id + version + optional joined name) in
 * addition to the skill identity. A skill delta is meaningless without a host,
 * so both are surfaced on every skill-suite DTO.
 */
export function skillSuiteRowToDto(
  row: EvalSkillSuiteRunRow,
  skillName?: string | null,
  hostAgentName?: string | null,
): EvalSkillSuiteRun {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    skill_id: row.skillId,
    ...(skillName !== undefined ? { skill_name: skillName } : {}),
    skill_version: row.skillVersion,
    host_agent_id: row.hostAgentId,
    ...(hostAgentName !== undefined ? { host_agent_name: hostAgentName } : {}),
    host_agent_version: row.hostAgentVersion,
    status: row.status,
    recall: row.recall ?? null,
    precision: row.precision ?? null,
    citation_accuracy: row.citationAccuracy ?? null,
    passed: row.passed,
    total: row.total,
    cost_usd: row.costUsd ?? null,
    duration_ms: row.durationMs,
    ran_at: iso(row.ranAt),
  };
}

export function runRowToRecord(row: EvalRunRow, caseName?: string | null): EvalCaseRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    ...(caseName !== undefined ? { case_name: caseName } : {}),
    ran_at: iso(row.ranAt),
    actual_output: row.actualOutput,
    pass: row.pass ?? null,
    recall: row.recall ?? null,
    precision: row.precision ?? null,
    citation_accuracy: row.citationAccuracy ?? null,
    duration_ms: row.durationMs ?? null,
    cost_usd: row.costUsd ?? null,
    suite_run_id: row.suiteRunId ?? null,
    error: row.error ?? null,
  };
}

/** Parse a stored `expected_output` jsonb into the envelope, or null if invalid. */
export function parseExpectedOutput(json: unknown): EvalExpectedOutput | null {
  const parsed = EvalExpectedOutputSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** Count grounded findings in a stored `actual_output` (a grounded Review), or null. */
export function actualFindingCount(actualOutput: unknown): number | null {
  if (actualOutput && typeof actualOutput === 'object' && 'findings' in actualOutput) {
    const findings = (actualOutput as { findings?: unknown }).findings;
    if (Array.isArray(findings)) return findings.length;
  }
  return null;
}

/**
 * Build one Evals-tab list item from a case row + its latest per-case run row
 * (or null when the case has never been run).
 */
export function caseListItem(
  caseRow: EvalCaseRow,
  latest: EvalRunRow | null,
): EvalCaseListItem {
  const envelope = parseExpectedOutput(caseRow.expectedOutput);
  return {
    id: caseRow.id,
    name: caseRow.name,
    expectation: envelope?.expectation ?? null,
    expected_count: envelope?.findings.length ?? 0,
    latest: latest
      ? {
          run_id: latest.id,
          pass: latest.pass ?? null,
          recall: latest.recall ?? null,
          precision: latest.precision ?? null,
          citation_accuracy: latest.citationAccuracy ?? null,
          actual_count: actualFindingCount(latest.actualOutput),
          duration_ms: latest.durationMs ?? null,
          cost_usd: latest.costUsd ?? null,
          ran_at: iso(latest.ranAt),
          error: latest.error ?? null,
        }
      : null,
  };
}

/** Reduce a newest-first list of run rows to the latest run per case id. */
export function latestRunPerCase(rows: EvalRunRow[]): Map<string, EvalRunRow> {
  const out = new Map<string, EvalRunRow>();
  for (const row of rows) {
    if (!out.has(row.caseId)) out.set(row.caseId, row);
  }
  return out;
}
