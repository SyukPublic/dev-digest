# Retro — Skill Eval Pipeline (differential) · run-plan · 2026-07-12

- **Session:** `ac1ecd07-03ff-4cba-a757-8ba38cde0d73`
- **Pipeline:** AskUserQuestion×2 → spec-creator → implementation-planner → run-plan (6×implementer in 4 waves → test-writer gap pass → green barrier → architecture-reviewer ∥ plan-verifier) → wrap-up. No publish.
- **Mode:** multi-agent (first multi-agent run since the early-July features; L06, the base this built on, was single-agent).
- **Outcome:** clean-with-follow-ups — 33/33 ACs IMPLEMENTED, arch gate PASS (0 findings), green barrier fully green (server 630+160, client 383, e2e 10/10). Zero review fix-iterations.

## TL;DR verdict

**Went well.** A dependency-chain feature (contracts → schema → engine → service, plus a parallel client track) executed with 6 implementers across 4 waves and landed first-time-green at review: 0 architecture findings, 0 PARTIAL/MISSING ACs, no fix loop. Cache discipline was excellent (~95% hit across all 12 agents; the embed-verbatim context pack meant no agent re-derived a decision). The one green-barrier failure (an e2e locator) was a test-artifact fix, not a code defect, and the pre-existing cold-compile flake self-recovered on re-run. Model tiering was right: the test-writer gap pass ran on Sonnet 5 and still found the only real coverage gap (AC-12 mid-run snapshot).

**Went less well.** Wall-clock was dominated by things that aren't compute: two (necessary, sequential) product-decision approval rounds + a ~43-min gap waiting for the "запускай" go-ahead, and one green-barrier round-trip that left `impl-c3` resumed-but-idle for ~44 min (its journal reads 57m but was ≈13m of work). The biggest phase (P4, server service+routes) ran essentially alone because it sits at the end of the server dependency chain — the parallel windows were only P2∥C1 and P3∥C2∥C3. So `parallel_factor` reads 0.96 but is skewed by the idle gap and the approval waits; real compute was efficient and well-overlapped where the DAG allowed.

## Metrics (deep — orchestrator + all 12 subagents, deduped by message.id)

| agent | type (model) | in | out | cache-read | hit% | tools | err | duration |
|---|---|---|---|---|---|---|---|---|
| spec-creator | spec-creator (opus-4-8) | 11.9k | 46.2k | 1.10M | 80.0% | 23 | 0 | 9m36s |
| planner | implementation-planner (opus-4-8) | 10.4k | 42.8k | 2.62M | 90.8% | 43 | 0 | 11m43s |
| impl-p1 | implementer (opus-4-8) | 8.3k | 16.9k | 1.28M | 92.3% | 23 | 2 | 7m53s |
| impl-p2 | implementer (opus-4-8) | 6.8k | 27.6k | 3.02M | 95.7% | 37 | 0 | 7m10s |
| impl-c1 | implementer (opus-4-8) | 6.7k | 50.4k | 5.86M | 97.4% | 60 | 0 | 13m40s |
| impl-p3 | implementer (opus-4-8) | 11.2k | 33.3k | 1.80M | 93.2% | 32 | 0 | 7m44s |
| impl-c2 | implementer (opus-4-8) | 6.7k | 40.4k | 3.82M | 95.9% | 43 | 1 | 10m39s |
| impl-c3 | implementer (opus-4-8) | 10.0k | 56.8k | 5.03M | 93.0% | 58 | 1 | 57m29s* |
| impl-p4 | implementer (opus-4-8) | 7.9k | 71.9k | 8.69M | 97.3% | 63 | 0 | 18m51s |
| test-gap-pass | test-writer (**sonnet-5**) | 6.6k | 22.0k | 5.07M | 96.8% | 53 | 1 | 6m13s |
| arch-review | architecture-reviewer (opus-4-8) | 8.0k | 16.6k | 1.50M | 91.7% | 23 | 0 | 4m31s |
| plan-verify | plan-verifier (opus-4-8) | 9.0k | 23.4k | 2.72M | 93.2% | 40 | 0 | 5m38s |
| **agents total** | 12 agents | **103.5k** | **448.0k** | **42.50M** | ~95% | 498 | 5 | Σ 2h41m* |
| orchestrator | run-plan (opus-4-8) | 13.5k | 125.6k | 10.28M | 95.1% | 78 | 0 | 3h04m (whole session) |
| **orch + agents** | — | **117.0k** | **573.6k** | **52.78M** | ~94.8% | 576 | 5 | — |

\* `impl-c3` was resumed via `SendMessage` for the green-barrier flow-10 fix, so its ONE journal spans first-pass + a ~44-min idle gap + fix-pass (≈13m real work). This inflates `Σ agents` and skews `parallel_factor` — treat both as loose bounds.

### Parallelism
- **agents wall-clock:** 2h48m (first-agent-start → last-agent-end; includes a ~43-min user-approval gap between planner-end and wave-1-start, plus impl-c3's idle).
- **Σ agent durations:** 2h41m* (real work ≈ 1h58m after removing impl-c3 idle).
- **parallel_factor:** 0.96* (skewed — see above; the real signal is "2 parallel windows in a mostly-serial DAG", not a concurrency problem).
- **max concurrent:** 3 — wave 3 (impl-p3 ∥ impl-c2 ∥ impl-c3). Wave 2 ran impl-p2 ∥ impl-c1 (2 concurrent). No `writes_paths` overlap between any concurrent agents → slices were genuinely disjoint.

## Insights → actions

1. **The biggest phase ran alone at the tail of the chain.** P4 (server service+routes, 18m51s, 71.9k out — the single largest agent) depends on P2+P3 and is disjoint from the client phases (C2/C3), but it was spawned only after I collected ALL wave-3 reports (~19:19), while P3 finished at 19:14 and C2/C3 work ended ~19:17. → **Action:** in run-plan Stage 1, honor *eager* launch literally — spawn a phase the moment its `depends on:` set reports done, not when the whole prior wave drains. P4 could have overlapped C2/C3's tail (~5 min saved). (Reinforces the eager-launch line already in the skill; I under-applied it.)

2. **An e2e locator failure cost a barrier round-trip + 44 min of resumed-idle.** `impl-c3` wrote `agent-browser find role tab --name Agents`; agent-browser cannot resolve the vendored `Tabs` `role="tab"`, so flow 10 failed at the green barrier and c3 had to be resumed. The C3 brief *mentioned* the fallback but did not forbid the role-locator. → **Action:** the run-plan e2e spawn brief must **mandate** deterministic `wait --text` / URL-param locators for tab strips and **forbid** `find role tab` on vendored `Tabs`. Capture as an `e2e/INSIGHTS.md` entry (agent-browser role-query limitation) via `engineering-insights`.

3. **The embed-verbatim context pack + Sonnet-5 test-writer both paid off — keep them.** Despite heavy duplicate reads (the plan read by all 10 agents; `service.ts` ×7, `eval-run.repo.ts`/`repository.ts` ×6, `eval-suite.ts` ×5), the ~95% cache-hit made them nearly free, and no agent re-derived a decision the pack already stated. The Sonnet-5 gap pass found the only real gap (AC-12) in 6m13s. → **Action:** none required (confirmed defaults). Optional micro-win: add the exact backend seam signatures (`EvalRepository` facade, `eval-run.repo` `insertRun`, `scoring.ts` exports) to the backend context pack so P3/P4 skip the residual signature re-reads.

4. **Two AskUserQuestion rounds were necessary, not waste.** Round 2 (host + metric semantics) only became answerable after round 1 (differential vs harness). Sequencing was correct; the calendar cost is inherent to plan-first product-decision gating. → **Action:** none.

## Trend note

Eight prior runs were single-agent (2026-07-06/07-10); this is the first **multi-agent** run since the early-July features, and directly comparable to **L06 Agent Eval Pipeline** (2026-07-10, `72bba185`) which it builds on. Similar scope and output (573.6k vs L06's 526.2k out) but the work was split across **6 parallel implementers** instead of one, at a higher `∥max` (3 vs the single-agent runs' effective 1). Cache-hit held at the ~95% house norm. Errors stayed low (5 agent tool-errors, all benign environment/transient — none reached review). Versus the multi-agent *feature* runs from early July (Project Context 18 agents / 4h18m; Onboarding 19 agents / 5h10m), this was leaner (12 agents / ~2h real compute) because the DAG was a chain with only two fan-out windows — fewer researcher/Explore scouts were needed since the base (L06) was freshly in-context.
