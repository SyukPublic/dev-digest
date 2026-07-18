# Retro — Agent & Skill Stats + Agent Performance dashboard

- **Session:** `95d2bcd0` · **Date:** 2026-07-17
- **Pipeline:** AskUser×4 → spec-creator → (approve) → AskUser×1 → implementation-planner → commit → run-plan [1×implementer → test-writer → green barrier → arch-reviewer ∥ plan-verifier → wrap-up] → engineering-insights
- **Execution mode:** single-agent (user choice) · **Outcome:** clean-with-follow-ups (0 fix iterations)

## TL;DR verdict

**Went well.** A full SDD→implementation run landed in one pass with **zero fix iterations**: 36 ACs, 35 IMPLEMENTED + 1 Minor PARTIAL (AC-27 PR-link), arch-review PASS (0 critical/high/medium), all suites green (818 server-unit / 254 server-it / 569 client / typecheck ×2). Heavy use of pre-scaffolded L07/L08 contracts (`AgentStats`/`AgentPerf`/`SkillStats`, `agentPerformance.json`) meant the implementer filled seams rather than inventing them — cache hit was exceptional (implementer **98.8%**, blended **96.6%**). Model routing was right: the mechanical test-writer ran on **sonnet-5**, everything reasoning-heavy on opus.

**Went less well.** The **context pack was empty again** — five separate agents each cold-read the same new seams (`runs.ts`, `observability.ts`, `nav.ts`, `agentPerformance.json`), and the plan-verifier alone did **45 Reads**. This is the *third* run (see 2026-07-10, 2026-07-13) whose top action is "fill the context pack"; the lever keeps being identified and not pulled. Single-agent mode also serialized 8 genuinely-disjoint phases (∥factor 0.68), so the implementer carried a 32-min / 128k-output monolith slice that multi-agent would have fanned out.

## Metrics

| agent | type (model) | depth→parent | in | out | cache-read | hit% | tools | err | duration |
|-------|--------------|--------------|----|-----|------------|------|-------|-----|----------|
| impl-all | implementer (opus-4.8) | 1→orch | 240 | 128.3k | 27.10M | 98.8% | 159 | 1 | 32m16s |
| — | implementation-planner (opus-4.8) | 1→orch | 37 | 43.9k | 2.18M | 92.4% | 47 | 0 | 9m46s |
| — | spec-creator (opus-4.8) | 1→orch | 414 | 39.5k | 659k | 73.9% | 29 | 1 | 8m12s |
| plan-verify | plan-verifier (opus-4.8) | 1→orch | 56 | 31.1k | 3.31M | 95.3% | 59 | 0 | 7m58s |
| arch-review | architecture-reviewer (opus-4.8) | 1→orch | 20 | 19.0k | 739k | 87.0% | 33 | 0 | 5m01s |
| test-gap-pass | test-writer (**sonnet-5**) | 1→orch | 65 | 16.7k | 2.61M | 95.7% | 34 | 0 | 4m39s |
| **agents Σ** | 6 agents | — | 832 | **278.5k** | 36.61M | ~96% | 361 | 2 | Σ 67.9m |
| orchestrator | (opus-4.8) — whole session | — | 106 | 65.0k | 9.00M | 94.7% | 76 | 1 | 4h30m* |
| **orch + agents** | | | 938 | **343.5k** | **45.61M** | **96.6%** | 437 | 3 | — |

**Parallelism:** agents wall-clock **1h40m*** · Σ agent time 67.9m · ∥ factor **0.68*** · max concurrent **2** (arch-review ∥ plan-verify — the only overlap). *`*` = skewed: single-agent mode + user round-trips (execution-mode ask, green-barrier runs) leave idle gaps between agents, and the orchestrator span (4h30m) includes human think-time — neither reflects compute.*

## Insights → actions

1. **Empty context pack, 3rd time running (top lever).** `duplicate_reads` shows `server/src/db/schema/runs.ts`, `contracts/observability.ts`, `client/src/vendor/ui/nav.ts`, `messages/en/agentPerformance.json` each read by **5** agents; spec+plan+`productionize.ts`+`trace.ts`+both editor `constants.ts` by 4 each. High cache hit masks the token cost, but it's redundant Read round-trips + latency on every agent. **Action:** the orchestrator must actually FILL the run-plan/SDD spawn-prompt `{{context_pack_verbatim}}` placeholder — inline the 4 hot shared fragments (runs/reviews schema excerpt, the three stats contract shapes, nav GLOBAL group, the pre-existing i18n keys) — and `implementation-planner` should emit a "Shared scaffold (context pack)" block for the orchestrator to forward. Both `.claude/agents/implementation-planner.md` and the run-plan spawn step already reference this; the gap is execution, not design.

2. **8 disjoint phases ran serially (single-agent, factor 0.68).** The plan pre-split into 8 parallel-safe phases (backend module + 3 independent client surfaces), but single-agent serialized them into a 32-min / 128k-output implementer slice. **Action:** when the planner produces ≥3 disjoint parallel-safe phases, the caller should default-*recommend* multi-agent at the execution-mode ask (state the wall-time trade-off), not present it as a neutral 50/50 — this run's three client tabs + backend module were textbook disjoint slices.

3. **Read-only reviewers on opus.** arch-reviewer (19k out, 33 tools) and plan-verifier (31k out, **45 Reads**) are analytical read agents; test-writer already proved sonnet-5 is enough for mechanical passes. **Action:** trial `model: sonnet-5` on `architecture-reviewer` / `plan-verifier` for the next comparable run and compare finding quality + cost via `eval:delta`; keep opus only if quality regresses. (Combined with #1, the plan-verifier's 45 reads shrink further.)

## Trend note

Cheaper and leaner than the comparable single-agent SDD runs: out **343.5k** vs Agent-Eval (2026-07-10) 526.2k and Stability-layer (2026-07-13) 317.6k; cache-read **45.6M** sits mid-pack; blended hit **96.6%** is the high end. **Zero fix iterations** matches the two cleanest prior runs (2026-07-13 ×2) and beats the publish-flow runs (12 & 16 errors). The standout: this is the **third** ledger row whose top action is the context pack (after 2026-07-10 "context pack also in single-agent plans" and 2026-07-13 "context pack for the Stage-4 reviewers") — the recurrence itself is the signal that it needs to become a mechanical orchestrator step, not advice.

## Audit verdict

Metrics are deep-parsed from journals (not in-context estimates). Token figures are trustworthy; **duration/∥factor are skewed bounds** (single-agent gaps + human round-trips) and are flagged `*`. No agent was resumed via SendMessage, so per-agent durations are clean work-time (only the inter-agent *gaps* are idle). One flaky server-it timing test (`multi-run-measurement.it`, unrelated file) failed once and passed on isolated re-run — not a regression.
