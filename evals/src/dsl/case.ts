/**
 * Case types + the runners that turn a data array into vitest tests. This module owns the ONE
 * true measure → (log) → assert body, so case authors never rewrite it — which is exactly what
 * keeps the "assert before record" bug from recurring once record() lands (T2 slots into the
 * marked spot below, in this one file).
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { DEFAULT_THRESHOLD, SPAWN_TOOLS, WORKFLOW_ALLOWED_TOOLS } from "../config.js";
import { skillTask, agentTask, workflowTask } from "../tasks.js";
import { runClaude, type Result, type RunOptions } from "../runtime/run-claude.js";
import { patternMatch, type ExpectedPattern } from "../scoring/pattern-match.js";
import { llmJudge, type Verdict } from "../scoring/llm-judge.js";
import { logTrace, logVerdict } from "../logging/log.js";
import { record } from "../records/record.js";

// --- Case shapes ------------------------------------------------------------

/** A judge-and-grounding case. Same shape for skills and agents; only the task differs. */
export interface QualityCase {
  name: string;
  kind?: "quality" | "grounding";
  prompt: string;
  /** Practices the judge scores (quality). Omit for a pure grounding case. */
  practices?: string[];
  /**
   * Substrings that must ALL appear before the judge runs (cheap-tier gate). A slot may be an
   * array of alternatives — any one of them satisfies that slot (see patternMatch).
   */
  grounding?: ExpectedPattern[];
  /** Judge score gate (default 0.6). */
  threshold?: number;
  maxTurns?: number;
}
export type SkillCase = QualityCase;
export type AgentCase = QualityCase;

/** A trace-asserted workflow case — a discriminated union routed by `kind`. */
export type WorkflowCase =
  | { kind: "dispatch"; name: string; prompt: string; expectSubagent: string; maxTurns?: number }
  | {
      kind: "activation";
      name: string;
      prompt: string;
      skill: string;
      shouldActivate: boolean;
      maxTurns?: number;
      /**
       * Positive activation is model-dependent (the model may do the work inline instead of
       * invoking the Skill tool), so a POSITIVE (`shouldActivate: true`) case marked `indicative`
       * logs a miss instead of failing the suite — the outcome is still recorded for pass-rate
       * tracking (eval:repeat). Has NO effect on a negative case: a false activation stays a hard
       * failure regardless.
       */
      indicative?: boolean;
    }
  | {
      kind: "contrast";
      name: string;
      prompt: string;
      expectFileRead: string;
      tools?: string[];
      maxTurns?: number;
    }
  | {
      // A single-session composite: run ONE workflowTask and assert several trace facets at once.
      // Cheaper than separate dispatch/activation/contrast cases (one session, not N) at the cost
      // of coarser diagnostics and no control run — use contrast when you must isolate CLAUDE.md's
      // contribution. Every provided expectation must hold; omitted fields are not checked.
      kind: "trace";
      name: string;
      prompt: string;
      expectSubagents?: string[];
      expectSkills?: string[];
      expectFilesRead?: string[];
      maxTurns?: number;
    };

/** Did a skill engage? Either an explicit Skill tool-call, or reading its SKILL.md. */
function skillEngaged(p: { skillsInvoked: string[]; filesRead: string[] }, skill: string): boolean {
  return (
    p.skillsInvoked.some((s) => s === skill || s.endsWith(`:${skill}`)) ||
    p.filesRead.some((f) => f.includes(`skills/${skill}/SKILL.md`))
  );
}
export const activated = (result: Result, skill: string): boolean => skillEngaged(result, skill);

// --- Runners ----------------------------------------------------------------

type Task = (prompt: string, artifact: string, opts?: RunOptions) => Promise<Result>;

function runQualityCases(artifact: string, cases: QualityCase[], task: Task): void {
  for (const c of cases) {
    test(c.name, async () => {
      const threshold = c.threshold ?? DEFAULT_THRESHOLD;
      const result = await task(c.prompt, artifact, { maxTurns: c.maxTurns });
      logTrace(c.name, result);

      // measure → record → assert. Everything measurable runs in the try; record() fires in the
      // finally with whatever accumulated; the asserts happen strictly after. A failing config
      // (e.g. baseline: grounding gate fails, judge skipped) still leaves a record.
      let grounded: number | undefined;
      let verdict: Verdict | undefined;
      try {
        // Cheap deterministic tier first — the grounding gate. When it fails the judge is skipped.
        if (c.grounding?.length) grounded = patternMatch(result.text, c.grounding);
        if (c.practices?.length && (grounded === undefined || grounded === 1)) {
          verdict = await llmJudge(result.text, c.practices);
          logVerdict(c.name, verdict);
        }
      } finally {
        record(c.name, { result, verdict, grounded, threshold });
      }

      if (grounded !== undefined) {
        expect(grounded, `missing concrete evidence; output:\n${result.text}`).toBe(1);
      }
      if (verdict) {
        expect(verdict.score, JSON.stringify(verdict.results)).toBeGreaterThanOrEqual(threshold);
      }
    });
  }
}

export const runSkillCases = (skill: string, cases: SkillCase[]) => runQualityCases(skill, cases, skillTask);
export const runAgentCases = (agent: string, cases: AgentCase[]) => runQualityCases(agent, cases, agentTask);

export function runWorkflowCases(cases: WorkflowCase[]): void {
  for (const c of cases) {
    test(c.name, async () => {
      if (c.kind === "dispatch") {
        // Stop the moment the subagent is launched — no need to wait out its nested session.
        const expect1 = c.expectSubagent;
        const result = await workflowTask(c.prompt, {
          maxTurns: c.maxTurns,
          stopWhen: (p) => p.subagents.includes(expect1),
        });
        logTrace(c.name, result);
        try {
          expect(result.subagents, `subagents: ${result.subagents.join(", ")}`).toContain(c.expectSubagent);
        } finally {
          record(c.name, { result, outcome: result.subagents.includes(c.expectSubagent) });
        }
      } else if (c.kind === "activation") {
        // Stop the moment the skill engages — that IS the evidence, and stopping before the
        // skill's body runs also prevents a mutating skill (e.g. engineering-insights) from
        // reaching Write/Edit. A negative case never engages, so it runs to maxTurns as before.
        const skill = c.skill;
        const result = await workflowTask(c.prompt, {
          maxTurns: c.maxTurns,
          // No Task/Agent here: activation is measured on the session itself (a Skill call or a
          // SKILL.md read), so a spawned subagent proves nothing and only burns wall-clock — a
          // near-miss negative once spent 199s inside a researcher subagent with WebSearch.
          allowedTools: WORKFLOW_ALLOWED_TOOLS.filter((t) => !SPAWN_TOOLS.has(t)),
          stopWhen: (p) => skillEngaged(p, skill),
        });
        // A negative case's stopWhen never fires (by design), so it legitimately runs to the
        // turn cap — an expected max-turns end is not an error; don't render it as one.
        const ranToExpectedCap = !c.shouldActivate && result.errorSubtype === "error_max_turns";
        logTrace(c.name, ranToExpectedCap ? { ...result, isError: false } : result);
        const didActivate = activated(result, c.skill);
        try {
          // Indicative positive miss → warn, don't block (still recorded for pass-rate tracking).
          if (c.indicative && c.shouldActivate && !didActivate) {
            console.warn(
              `⚠ indicative: "${c.name}" did not activate ${c.skill} ` +
                `(model chose inline work) — not blocking | reads: ${result.filesRead.join(", ")}`,
            );
          } else {
            expect(
              didActivate,
              `skills: ${result.skillsInvoked.join(", ")} | reads: ${result.filesRead.join(", ")}`,
            ).toBe(c.shouldActivate);
          }
        } finally {
          // Explicit outcome: the assertion's truth, not !isError — a passing negative case ends
          // at the turn cap (isError=true), and an indicative positive miss can end cleanly.
          record(c.name, { result, outcome: didActivate === c.shouldActivate });
        }
      } else if (c.kind === "trace") {
        // One session, many asserts — every provided expectation is checked against the same trace.
        // Stop as soon as ALL expectations are satisfied (e.g. doc read + subagent launched), so a
        // dispatch-bearing trace doesn't pay for the nested subagent's full run.
        const subs = c.expectSubagents ?? [];
        const skls = c.expectSkills ?? [];
        const files = c.expectFilesRead ?? [];
        const result = await workflowTask(c.prompt, {
          maxTurns: c.maxTurns,
          stopWhen: (p) =>
            subs.every((s) => p.subagents.includes(s)) &&
            skls.every((s) => skillEngaged(p, s)) &&
            files.every((f) => p.filesRead.some((r) => r.includes(f))),
        });
        logTrace(c.name, result);
        try {
          for (const sub of c.expectSubagents ?? []) {
            expect(result.subagents, `subagents: ${result.subagents.join(", ")}`).toContain(sub);
          }
          for (const skill of c.expectSkills ?? []) {
            expect(
              activated(result, skill),
              `skill ${skill} not engaged | skills: ${result.skillsInvoked.join(", ")} | reads: ${result.filesRead.join(", ")}`,
            ).toBe(true);
          }
          for (const file of c.expectFilesRead ?? []) {
            expect(
              result.filesRead.some((f) => f.includes(file)),
              `${file} not read | reads: ${result.filesRead.join(", ")}`,
            ).toBe(true);
          }
          expect(result.isError).toBe(false);
        } finally {
          record(c.name, {
            result,
            outcome:
              !result.isError &&
              subs.every((s) => result.subagents.includes(s)) &&
              skls.every((s) => activated(result, s)) &&
              files.every((f) => result.filesRead.some((r) => r.includes(f))),
          });
        }
      } else {
        // contrast: treatment (real harness) vs control (empty tmpdir, no on-disk config).
        const tools = c.tools ?? ["Read", "Grep", "Glob"];
        const treatment = await workflowTask(c.prompt, { allowedTools: tools, maxTurns: c.maxTurns });
        const emptyCwd = mkdtempSync(join(tmpdir(), "eval-control-"));
        const control = await runClaude(c.prompt, {
          allowedTools: tools,
          maxTurns: c.maxTurns,
          cwd: emptyCwd,
          settingSources: [],
        });
        logTrace(`${c.name} [treatment]`, treatment);
        logTrace(`${c.name} [control]`, control);
        try {
          const treatmentRead = treatment.filesRead.some((f) => f.includes(c.expectFileRead));
          const controlRead = control.filesRead.some((f) => f.includes(c.expectFileRead));
          expect(treatmentRead, `treatment reads: ${treatment.filesRead.join(", ")}`).toBe(true);
          expect(controlRead, `control reads: ${control.filesRead.join(", ")}`).toBe(false);
        } finally {
          const treatmentRead = treatment.filesRead.some((f) => f.includes(c.expectFileRead));
          const controlRead = control.filesRead.some((f) => f.includes(c.expectFileRead));
          record(`${c.name} [treatment]`, { result: treatment, outcome: treatmentRead });
          record(`${c.name} [control]`, { result: control, outcome: !controlRead });
        }
      }
    });
  }
}
