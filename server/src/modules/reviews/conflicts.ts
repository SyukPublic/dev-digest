import { rangesOverlap } from '@devdigest/reviewer-core';
import type { AgentColumn, AgentColumnFinding, Conflict, ConflictTake } from '@devdigest/shared';

/**
 * DEC-D / T9 — cross-agent conflict grouping. PURE + deterministic: it takes the
 * assembled per-agent columns and returns the file:line locations where the
 * reviewers DISAGREE. Nothing is stored — conflicts are computed on read when
 * serving `GET /pulls/:id/multi-agent` (AC-21).
 *
 * This is a pure helper (no DB / adapters), so it MAY import the pure
 * `rangesOverlap` primitive from `reviewer-core` (allowed for a pure helper; a
 * *service.ts could not). It lives OUTSIDE the service so the orchestration layer
 * stays thin and this grouping stays unit-testable without any I/O.
 *
 * Algorithm
 * ---------
 * 1. Consider only the columns that actually REVIEWED the PR — i.e. runs whose
 *    status is `done`. A `failed`/`running` agent produced no verdict at that
 *    location and therefore cannot be said to "disagree"; counting it as a
 *    silent "did not flag" would manufacture a conflict on every finding the
 *    instant one agent fails (AC-15 keeps failures isolated, so they must not
 *    leak into the disagreement view).
 * 2. Group every reviewing column's findings by the same `file` + overlapping
 *    line range (`rangesOverlap` — `AgentColumnFinding` exposes only
 *    `start_line`, so a finding is treated as the point `[start_line,start_line]`)
 *    + the same `category`.
 * 3. For each group emit ONE `ConflictTake` per reviewing agent: the finding's
 *    `severity` when that agent flagged the location, or the synthesized
 *    `'ignored'` ("did not flag") verdict when it reviewed but did not (AC-22).
 * 4. Return EVERY cross-agent group. Whether a group is a genuine DISAGREEMENT
 *    (divergent severities, or flagged-vs-did-not-flag) or an AGREEMENT/duplicate
 *    (all reviewers flagged the same severity) is decided DOWNSTREAM in the UI:
 *    the "Where agents disagree" block defaults its "Show only conflicts" toggle
 *    ON (disagreements only, via `isDisagreement`) and reveals the agreement /
 *    duplicate groups when toggled OFF — delivering US-4's "duplicates stop
 *    nagging, the same place is visible once" value (AC-22/23/27).
 *
 * NOTE: a cross-agent view needs at least TWO reviewing agents to compare; a lone
 * reviewer's findings already live in its own column/tab, so surfacing them here
 * would be noise — such a run yields no groups. The name `Conflict` is kept for
 * the contract even though the array now also carries agreements (the UI toggle
 * is the conflict filter).
 */

/** A reviewing agent is one whose run reached a `done` status (see step 1). */
function reviewed(column: AgentColumn): boolean {
  return column.status === 'done';
}

interface Group {
  file: string;
  category: string;
  /** Inclusive line span of the group's findings (grows as members are added). */
  minLine: number;
  maxLine: number;
  /** The findings in this group, paired with the column that produced them, in
   *  column-then-finding order (so the representative title is deterministic). */
  members: { column: AgentColumn; finding: AgentColumnFinding }[];
}

export function buildConflicts(columns: AgentColumn[]): Conflict[] {
  const reviewing = columns.filter(reviewed);
  // A cross-agent comparison needs at least two reviewers (step 4 / NOTE above).
  if (reviewing.length < 2) return [];

  // 1-2 — greedily bucket findings into (file, category, overlapping-line) groups.
  const groups: Group[] = [];
  for (const column of reviewing) {
    for (const finding of column.findings) {
      const existing = groups.find(
        (g) =>
          g.file === finding.file &&
          g.category === finding.category &&
          rangesOverlap(finding.start_line, finding.start_line, g.minLine, g.maxLine),
      );
      if (existing) {
        existing.minLine = Math.min(existing.minLine, finding.start_line);
        existing.maxLine = Math.max(existing.maxLine, finding.start_line);
        existing.members.push({ column, finding });
      } else {
        groups.push({
          file: finding.file,
          category: finding.category,
          minLine: finding.start_line,
          maxLine: finding.start_line,
          members: [{ column, finding }],
        });
      }
    }
  }

  // 3-4 — one take per reviewing agent (flagged severity, or 'ignored'); return
  // EVERY cross-agent group. The disagreement-vs-agreement decision is the UI's
  // "Show only conflicts" toggle, not this pure grouping (see step 4 / NOTE).
  return groups.map((group) => {
    const takes: ConflictTake[] = reviewing.map((column) => {
      const member = group.members.find((m) => m.column.run_id === column.run_id);
      if (member) {
        return {
          agent_id: column.agent_id,
          persona: column.agent_name,
          verdict: member.finding.severity,
          note: member.finding.title,
        };
      }
      return {
        agent_id: column.agent_id,
        persona: column.agent_name,
        verdict: 'ignored',
        note: 'did not flag',
      };
    });

    return {
      file: group.file,
      line: group.minLine,
      // The representative title is the first flagging agent's finding title.
      title: group.members[0]!.finding.title,
      takes,
    };
  });
}
