# Retro — Brief & Onboarding UI Refinements (2026-07-06)

Session `50804825-aa51-4cd3-b1d5-aea8bafac710` · full SDD chain (spec-creator →
implementation-planner → run-plan pipeline → pr-self-review publish) · **first
single-agent execution-mode run** in the ledger. Deep mode: journals parsed from
disk (`retro_metrics.py`), orchestrator usage EXCLUDES subagents by design.

## TL;DR verdict

**Went well.** The first single-agent run went end-to-end clean: 23 tasks / 6
phases by ONE implementer (~22 min), a gap pass that found only 3 thin test
gaps, a green barrier that passed first try (server 637/637 incl. Testcontainers,
client 243/243, both typechecks), and a review stage with **zero must-fix
findings** (arch 0 CRITICAL/HIGH/MEDIUM; plan-verifier 18/18 ACs IMPLEMENTED) —
0 fix iterations. Cheapest full-chain run in the ledger by far: 214k output
tokens vs 421–475k for the three multi-agent feature runs (fair caveat: this was
a refinement round, ~⅓ the scope of those features). Cache hits 88–98% across
all agents.

**Went badly (cost hotspots, not failures).** The green barrier was the longest
stage (~41 min wall): the client suite alone took 24.4 min of which actual tests
were **10.5 s** — the rest is jsdom environment/transform/collect overhead — and
the known WSL flake rule forces server → client to run serially. The test-writer
spent 23 min on 3 small gaps, partly because it re-ran the FULL server unit
suite (528 tests) and 8 client files — its spawn template lacks the
"targeted-tests-only" clause the implementer template got after the 2026-07-05
retro. `parallel_factor` 0.53 is expected for a sequential single-agent
pipeline (wall includes the barrier + human approval gates), not a scheduling
defect.

## Metrics

| agent | type (model) | depth→parent | in | out | cache-read | hit% | tools | err | duration |
|---|---|---|---|---|---|---|---|---|---|
| spec-creator | spec-creator (opus-4-8) | 1→orch | 15.1k | 33.4k | 4.63M | 94.3% | 57 | 3 | 12m39s |
| (planner) | implementation-planner (opus-4-8) | 1→orch | 8.3k | 19.1k | 1.29M | 88.2% | 33 | 0 | 4m15s |
| impl-single | implementer (opus-4-8) | 1→orch | 8.4k | 43.3k | 13.43M | 98.2% | 94 | 0 | 21m52s |
| test-gap-pass | test-writer (sonnet-5) | 1→orch | 8.9k | 18.3k | 5.34M | 96.7% | 67 | 1 | 22m51s |
| arch-review | architecture-reviewer (opus-4-8) | 1→orch | 7.1k | 7.0k | 0.73M | 89.6% | 17 | 0 | 2m21s |
| plan-verify | plan-verifier (opus-4-8) | 1→orch | 7.1k | 11.4k | 1.34M | 90.6% | 35 | 0 | 2m59s |
| **agents total** | | | **54.7k** | **132.5k** | **26.77M** | | **303** | **4** | Σ 66m56s |
| orchestrator | main session (fable-5) | — | 15.3k | 81.9k | 15.41M | 97.6% | 90 | 2 | 2h39m (whole session) |
| **grand total** | | | **70.0k** | **214.4k** | **42.18M** | **96.6%** | **393** | **6** | |

**Parallelism:** agents wall-clock 2h06m (first spawn → last finish, includes
the ~41 min green barrier and the human approval gates between stages);
Σ agent time 1h07m; `parallel_factor` 0.53; max concurrent 2 (Stage 4:
arch-review ∥ plan-verify — the only by-design parallel stage in single-agent
mode). No agent was resumed mid-run except spec-creator (two passes:
clarifications resolved via SendMessage; its duration includes no idle skew —
the second pass ran immediately).

**Tool errors (6):** spec-creator 3 (incl. the known `devdigest_get_conventions`
"repository not found" on the self-repo), test-writer 1, orchestrator 2 (incl.
the expected first `git push` blocked by the pre-publish gate). None affected
the outcome.

## Insights → actions

1. **test-writer gap pass re-ran full suites.** Its journal shows a full server
   unit run (528 tests) + 8 client files for 3 thin gaps — the same
   full-suite-inside-a-phase waste the 2026-07-05 retro fixed for implementers,
   because spawn template 2 (test-writer) never got the equivalent clause.
   → **Action:** add to `.claude/skills/run-plan/references/spawn-prompts.md`
   template 2: "run ONLY the tests you added/extended (the full suite is the
   green barrier's job); this narrows your standard DoD for this run."
   (Applied to `.claude/agents/INSIGHTS.md` as a durable insight.)
2. **Client full suite is 99% overhead.** 1464.6s wall for 10.5s of actual
   tests (setup 1223s, environment 5037s, collect 7271s across 47 jsdom files).
   The barrier's serial rule (WSL flake) makes this the pipeline's longest
   single wait. → **Action (product follow-up, not process):** tune client
   `vitest` config — e.g. `pool: 'threads'` + `isolate: false` (jsdom
   environment reuse), or split heavy suites — tracked as a tech-debt
   candidate; re-measure at the next run's barrier.
3. **Single-agent mode fits refinement rounds.** 6 agents / 214k out / 0 fix
   iterations vs 15–19 agents / 421–475k out / 5–12 errors for the three
   multi-agent feature runs — and zero wave-coordination overhead (no context
   packs needed, no disjoint-scope policing, no wave-balance gate). Scope was
   smaller, but the coherence gain is real: one implementer holding all six
   phases produced tests the gap pass barely had to touch.
   → **Action:** when the spec is a polish/refinement round over shipped
   features (no new contracts, no parallelizable greenfield), recommend
   `single-agent` in implementation-planner's execution-mode question instead
   of treating multi-agent as the default.
4. **duplicate_reads are role-driven, not waste.** Top files (`service.ts`,
   `container.ts`, the spec at 11 reads, the five UI components at 6–7) were
   each read once per ROLE across the six sequential agents — with 88–98% cache
   hits this is cheap and expected in single-agent mode (the plan deliberately
   omits a context pack). → No action; do not add context packs to single-agent
   plans on this evidence alone.

## Trend note

vs the three multi-agent feature runs (2026-07-04 → 2026-07-05): **~2× cheaper
on output tokens** (214k vs 422–475k), **~2× shorter wall** (2h06m vs
3h55m–5h10m), **fewest agents** (6 vs 15–19), **fewest tool errors** (6 vs
5–12), and the first run with **zero fix iterations** and a zero-findings
architecture verdict. Caveat: scope was a refinement round (23 tasks, no new
contracts/migrations), so the comparison sets a baseline for the single-agent
mode rather than beating the feature runs like-for-like. The 2026-07-05 "top
action" (implementers: targeted tests only) demonstrably worked — impl-single
ran only targeted files — but the same fix is still missing for test-writer
(action 1).
