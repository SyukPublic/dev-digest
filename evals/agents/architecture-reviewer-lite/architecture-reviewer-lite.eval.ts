import { describeAgent, runAgentCases } from "../../src/index.js";
// Deliberately reuses the strict variant's cases — same fixtures, same practices, same
// thresholds. Only the injected agent artifact differs: architecture-reviewer-lite drops three
// of the strict variant's guardrails — (1) cite the specific rule per finding, (2) verbatim
// evidence quote per finding, and (3) the explicit "Do NOT flag" false-positive list — while
// keeping severity and the PASS/FAIL verdict as untouched controls. That is what makes this pair
// a controlled A/B rather than two unrelated evals.
//
// How to compare (the per-practice tables are the signal):
//   pnpm eval:repeat agents/architecture-reviewer      -n 2 --label strict
//   pnpm eval:repeat agents/architecture-reviewer-lite -n 2 --label lite
//   pnpm eval:delta strict lite
// NOTE: strict and lite live in SEPARATE .eval.ts files, so their records carry different
// `nodeid`s (nodeid = testPath > describe > test-name). `eval:delta` keys by nodeid, so it will
// list each side in its OWN block (Δ shows n/a) rather than one aligned per-practice Δ row. Read
// the per-practice pass-rate tables that each `eval:repeat --label` run prints — the shared test
// names + practice texts line up 1:1, so "cites the specific rule" and "quotes verbatim" should
// drop sharply for lite while severity / PASS-FAIL hold, and the benign/out-of-scope cases (2 & 4)
// show whether dropping the anti-hallucination guards raised fabrication.
import { cases } from "../architecture-reviewer/architecture-reviewer.cases.js";

describeAgent("architecture-reviewer-lite", () => runAgentCases("architecture-reviewer-lite", cases));
