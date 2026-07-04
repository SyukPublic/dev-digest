# Retro — Project Context Folder: spec → plan → run-plan pipeline → publish (2026-07-04)

Session `a764c5c2` · deep mode (journal-parsed) · 18 subagents + orchestrator ·
scope: spec-creator interview → implementation-planner → run-plan (8 phases, 3 waves)
→ test-writer gap pass → green barrier → architecture-reviewer ∥ plan-verifier →
pre-barrier race fix → wrap-up → commit/push/PR via pr-self-review.

## TL;DR verdict

**Went well.** The pipeline shipped a 4-package feature (70 files, +8.1k lines) with a
**zero-must-fix review outcome** (0 CRITICAL/HIGH architecture findings, 22/23 AC
IMPLEMENTED) and **no fix-loop iterations** — the only production defect (trace/status
race) was caught by the test-writer and fixed *pre-barrier* via a warm `SendMessage` to
the owning implementer, turning a would-be red barrier into a single green pass. The
context pack + frozen API contract kept parallel server/client phases (P4 ∥ P6) drift-free.
Cache discipline was excellent everywhere (86–99% per agent, ≈95% aggregate).

**Went badly (mildly).** Wall-clock was dominated by long-tail phases: wave 1 = P1 22m
while its 3 siblings finished in 2–5m; wave 2 = P6 74m vs P7 16m. The parallel factor
(1.42 raw) is further *understated* by a metrics artifact: resumed agents
(impl-p4, spec-creator) carry idle gaps inside `duration_s`, inflating Σ agent time.
Reviewers/test-writer were spawned **without** the context pack, so the same six
server/platform files were re-read by 6–7 agents each.

## Metrics

Tokens deduped per `message.id`; `dur` = first→last journal line (**includes idle
resume gaps** for agents continued via `SendMessage` — see insight 2).

| agent | type (model) | d→parent | in | out | cache-read | hit% | tools | err | dur |
|---|---|---|---|---|---|---|---|---|---|
| ORCHESTRATOR | session (fable-5) | 0 | 13.5k | 108.2k | 13.72M | 97.4 | 66 | 1 | 281m (whole session) |
| spec-project-context | spec-creator (opus-4-8) | 1 | 34.0k | 30.0k | 1.81M | 86.9 | 42 | 1 | 18m43s* |
| researcher ×3 | researcher (sonnet-5) | 2→spec | 3.5k | 32.4k | 1.22M | 80–92 | 78 | 0 | ≈2m each |
| plan-project-context | implementation-planner (opus-4-8) | 1 | 27.4k | 28.9k | 2.42M | 92.8 | 50 | 1 | 7m13s |
| Explore ×2 | Explore (haiku-4.5) | 2→planner | 0.3k | 18.2k | 2.09M | 95–97 | 83 | 0 | ≈2m each |
| impl-p1 | implementer (opus-4-8) | 1 | 6.2k | 25.6k | 3.34M | 93.2 | 51 | 0 | 22m20s |
| impl-p2 | implementer (opus-4-8) | 1 | 5.9k | 10.9k | 1.07M | 93.9 | 20 | 0 | 4m29s |
| impl-p3 | implementer (opus-4-8) | 1 | 6.8k | 10.1k | 1.32M | 93.9 | 30 | 0 | 5m11s |
| impl-p5 | implementer (opus-4-8) | 1 | 5.4k | 5.0k | 0.46M | 88.2 | 11 | 0 | 2m22s |
| impl-p4 | implementer (opus-4-8) | 1 | 11.1k | 57.0k | 16.83M | 91.7 | 121 | 1 | 145m48s* |
| impl-p6 | implementer (opus-4-8) | 1 | 8.2k | 55.3k | 13.34M | 91.9 | 138 | 2 | 74m16s |
| impl-p7 | implementer (opus-4-8) | 1 | 9.5k | 20.0k | 3.29M | 97.2 | 53 | 2 | 16m18s |
| impl-p8 | implementer (opus-4-8) | 1 | 6.0k | 11.4k | 1.43M | 88.1 | 38 | 1 | 23m53s |
| test-gap-pass | test-writer (sonnet-5) | 1 | 9.7k | 41.1k | 26.77M | 99.3 | 193 | 3 | 28m14s |
| arch-review | architecture-reviewer (opus-4-8) | 1 | 8.0k | 8.2k | 1.13M | 92.0 | 31 | 0 | 3m27s |
| plan-verify | plan-verifier (opus-4-8) | 1 | 8.0k | 13.0k | 2.51M | 93.6 | 59 | 0 | 3m51s |
| **TOTAL (orch + agents)** | | | **163.5k** | **475.4k** | **92.74M** | **≈94.9** | **1064** | **12** | |

`*` duration includes idle resume gaps (spec-creator: interview round-trip;
impl-p4: ~2h between Phase 4 completion and the pre-barrier fix iteration).

**Parallelism:** agents wall-clock **4h18m**, Σ agent durations **6h06m**,
factor **1.42** (upper-bound-skewed by `*` rows), max concurrent **4**
(wave 1: P1∥P2∥P3∥P5; wave 2 ran P4∥P6∥P7).

**Tool errors (11 agent-side):** all one-off, none systemic — e.g. test-writer:
a python `IsADirectoryError`, one blocked bare `sleep 60` (harness guardrail),
one exit-1 test run that was *the deliberate reproduction of the trace/status race*.
No permission walls, no flailing loops.

## Insights → actions

1. **Long-tail phases cap the win from parallelism.** Wave walls were set by the
   largest slice (P1 22m; P6 74m ≈ 4.5× P7), while concurrency never exceeded 4 of a
   possible ~10. Balance matters more than width.
   → **Action (applied):** added a phase-size balance rule to
   `.claude/agents/implementation-planner.md` — when a phase's estimated scope is >2×
   the wave median, split it into disjoint sub-slices (P6 was naturally splittable:
   page / context-attach slice / editor-tab wiring).
2. **`duration_s` lies for resumed agents.** A `SendMessage` continuation reuses the
   journal, so first→last-line duration includes the idle gap; Σ agents and the
   parallel factor inherit the skew (impl-p4 "146m" was ≈25m of actual work).
   → **Action (applied):** documented in `.claude/skills/workflow-retro/SKILL.md`
   (Journal schema gotchas): treat Σ/factor as bounds when agents were resumed.
3. **Reviewers and test-writer sat outside the context pack.** `duplicate_reads`:
   `run-executor.ts` ×7 agents, `config.ts`/`container.ts`/`prompt.ts`/`trace.ts`
   ×6–7 — implementers had CP fragments, but Stage-2/4 spawn prompts carried none.
   → **Action (applied):** run-plan spawn templates for test-writer /
   architecture-reviewer / plan-verifier now instruct the orchestrator to embed the
   plan's context pack verbatim (`.claude/skills/run-plan/references/spawn-prompts.md`).
4. **Pre-barrier fix routing paid off** (race fixed before the barrier — one green pass
   instead of red→fix→rerun). Already codified in `.claude/agents/INSIGHTS.md`
   (2026-07-04, Stage 2→3 seam entry). No further action.
5. **Model routing was sound.** haiku→Explore, sonnet→researcher/test-writer (the
   Bash-heaviest journal, 113 Bash calls, at the cheap tier), opus→implementers and
   reviewers. No mismatch found; no action.

## Trend note

First row in the ledger — no prior runs to compare. This run sets the baseline for a
full SDD cycle (spec → plan → pipeline → publish): ≈476k output tokens, 4h18m agents
wall-clock, 18 agents, zero fix-loop iterations. Next comparable run should watch
whether the phase-balance rule (insight 1) lifts the parallel factor above ~1.4.
