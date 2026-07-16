/**
 * Unit tests for `buildConflicts` (server/src/modules/reviews/conflicts.ts).
 *
 * PURE function: AgentColumn[] → Conflict[]. No DB, no adapters, no stubs.
 * Covers AC-21 (grouping by file + overlapping line + category), AC-22 ("did not
 * flag" = synthesized `ignored` take for a reviewing agent), AC-23 (variant B: it
 * returns EVERY cross-agent group — disagreements AND agreement/duplicate groups;
 * the disagreement-only narrowing is the UI's default-ON "Show only conflicts"
 * toggle, not this grouping). A single reviewer yields no cross-agent group.
 */

import { describe, it, expect } from 'vitest';
import { buildConflicts } from '../src/modules/reviews/conflicts.js';
import type { AgentColumn, AgentColumnFinding, Severity } from '@devdigest/shared';

let colSeq = 0;
function column(
  name: string,
  findings: AgentColumnFinding[],
  status: AgentColumn['status'] = 'done',
): AgentColumn {
  const n = colSeq++;
  return {
    run_id: `run-${n}`,
    agent_id: `agent-${n}`,
    agent_name: name,
    provider: 'openai',
    model: 'gpt-4.1',
    status,
    verdict: 'comment',
    score: 80,
    summary: null,
    duration_ms: 100,
    cost_usd: 0.01,
    findings,
  };
}

let fSeq = 0;
function finding(
  file: string,
  line: number,
  severity: Severity,
  category = 'security',
  title = `Issue @ ${file}:${line}`,
): AgentColumnFinding {
  return { id: `f-${fSeq++}`, severity, category, title, file, start_line: line };
}

describe('buildConflicts', () => {
  // Unit under test : buildConflicts
  // Input           : two done agents flag the SAME file:line + category, divergent severities
  // Expected        : one conflict with two takes carrying each agent's severity (AC-23)
  it('emits a conflict when two agents flag the same location with divergent severities', () => {
    const a = column('Alpha', [finding('src/config.ts', 11, 'CRITICAL')]);
    const b = column('Beta', [finding('src/config.ts', 11, 'WARNING')]);

    const conflicts = buildConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
    const [c] = conflicts;
    expect(c!.file).toBe('src/config.ts');
    expect(c!.line).toBe(11);
    expect(c!.takes).toHaveLength(2);
    const verdicts = c!.takes.map((t) => t.verdict).sort();
    expect(verdicts).toEqual(['CRITICAL', 'WARNING']);
  });

  // Unit under test : buildConflicts
  // Input           : agent A flags a location; agent B reviewed (done) but did NOT flag it
  // Expected        : one conflict; B's take is the synthesized `ignored` "did not flag" (AC-22)
  it('synthesizes an `ignored` take for a reviewing agent that did not flag the location', () => {
    const a = column('Alpha', [finding('a.ts', 5, 'CRITICAL')]);
    const b = column('Beta', []); // reviewed, produced no findings

    const conflicts = buildConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
    const takes = conflicts[0]!.takes;
    const beta = takes.find((t) => t.persona === 'Beta')!;
    expect(beta.verdict).toBe('ignored');
    expect(beta.note).toBe('did not flag');
    const alpha = takes.find((t) => t.persona === 'Alpha')!;
    expect(alpha.verdict).toBe('CRITICAL');
  });

  // Unit under test : buildConflicts
  // Input           : two agents flag the same location with the SAME severity
  // Expected        : the cross-agent group IS returned (variant B) — both takes carry
  //                   the shared severity, so it is NOT a disagreement and the UI's
  //                   "Show only conflicts" toggle (ON by default) hides it; toggling
  //                   OFF surfaces this duplicate (US-4). Grouping no longer drops it.
  it('emits the cross-agent group when agents agree on the same severity (duplicate)', () => {
    const a = column('Alpha', [finding('a.ts', 9, 'WARNING')]);
    const b = column('Beta', [finding('a.ts', 9, 'WARNING')]);
    const conflicts = buildConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.takes.map((t) => t.verdict)).toEqual(['WARNING', 'WARNING']);
  });

  // Unit under test : buildConflicts
  // Input           : the only reviewing agent flags a location (no other reviewer)
  // Expected        : NOT a conflict — a lone flag cannot disagree with anyone
  it('does not emit a conflict for a lone flagging agent', () => {
    const a = column('Solo', [finding('a.ts', 3, 'CRITICAL')]);
    expect(buildConflicts([a])).toHaveLength(0);
  });

  // Unit under test : buildConflicts
  // Input           : a FAILED agent (no findings) alongside one flagging agent
  // Expected        : NO conflict — a failed run did not review, so it is excluded and
  //                   cannot be counted as a silent "did not flag" (AC-15 isolation)
  it('excludes failed / running agents from the reviewing set', () => {
    const a = column('Alpha', [finding('a.ts', 7, 'CRITICAL')]);
    const failed = column('Broken', [], 'failed');
    const running = column('Pending', [], 'running');
    expect(buildConflicts([a, failed, running])).toHaveLength(0);
  });

  // Unit under test : buildConflicts
  // Input           : different categories on the same file:line
  // Expected        : NOT grouped together (category is part of the group key), so each
  //                   is a lone flag ⇒ no conflict
  it('does not group findings of different categories', () => {
    const a = column('Alpha', [finding('a.ts', 4, 'CRITICAL', 'security')]);
    const b = column('Beta', [finding('a.ts', 4, 'CRITICAL', 'performance')]);
    // Location a.ts:4/security → Alpha flagged, Beta ignored ⇒ conflict.
    // Location a.ts:4/performance → Beta flagged, Alpha ignored ⇒ conflict.
    const conflicts = buildConflicts([a, b]);
    expect(conflicts).toHaveLength(2);
  });

  // Unit under test : buildConflicts
  // Input           : each agent flags a DIFFERENT location; both reviewed (done)
  // Expected        : two conflicts (each location is flagged-vs-ignored per the spec)
  it('treats flagged-vs-did-not-flag at each distinct location as a conflict', () => {
    const a = column('Alpha', [finding('a.ts', 11, 'CRITICAL')]);
    const b = column('Beta', [finding('a.ts', 50, 'WARNING')]);
    const conflicts = buildConflicts([a, b]);
    expect(conflicts).toHaveLength(2);
    for (const c of conflicts) {
      expect(c.takes).toHaveLength(2);
      expect(c.takes.some((t) => t.verdict === 'ignored')).toBe(true);
    }
  });

  // Unit under test : buildConflicts
  // Input           : no columns at all
  // Expected        : []
  it('returns [] for no columns', () => {
    expect(buildConflicts([])).toEqual([]);
  });
});
