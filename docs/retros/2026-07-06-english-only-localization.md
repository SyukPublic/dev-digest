# Retro — english-only-localization run (2026-07-06, session bd75fd78)

Pipeline: propose → approve (AskUserQuestion) → `simple-implementation-planner` →
`run-plan` single-agent (`impl-all` whole plan) → green barrier → `arch-review` ∥
`plan-verify` → wrap-up → commit/push/PR via `pr-self-review`.
Plan: `docs/plans/english-only-localization.md` (12 ACs, deletions + docs/comment edits).

## TL;DR verdict

**Went well.** Cleanest outcome so far: 12/12 ACs IMPLEMENTED, 0 review findings,
0 fix iterations, 0 agent tool errors. The smallest run in the ledger by every
token measure (113.3k out vs 214.4k for the previous single-agent run) — scope
discipline worked: 4 agents only (no spec-creator — user-approved proposal served
as the spec; test-writer legitimately skipped for a deletion/docs plan). Passing
the execution mode + approval answers up front eliminated all stop-and-ask
round-trips. The commit→push→PR leg then flowed through the pre-publish gate as
designed (marker → push → append-only PR body update).

**Went badly.** Wall-clock is dominated by full test suites run TWICE (client)
and THREE times (server). Root cause is the orchestrator's own spawn prompt: it
explicitly relaxed the targeted-tests clause ("your slice spans both packages,
running both is expected here"), so `impl-all` ran both full suites (~40 min of
its 51 min), and the Stage-3 green barrier re-ran everything anyway. The barrier
itself then flaked: client+server suites launched in parallel in one WSL distro
reproduced the known `[vitest-worker]: Timeout calling "onTaskUpdate"` flake
(server "red" with 0 failed), and `pnpm test 2>&1 | tail` masked the real exit
code — costing a 15-min isolated server re-run plus triage. Minor friction: a
PowerShell here-string (`@'…'@`) pasted into the Bash tool corrupted the commit
message (fixed via `--amend`), and one `Monitor` call failed on an unloaded
deferred-tool schema.

## Metrics (deep — journals; orchestrator row covers the WHOLE session)

| agent | type (model) | depth→parent | in | out | cache-read | hit % | tools | err | duration |
|---|---|---|---|---|---|---|---|---|---|
| (planner) | simple-implementation-planner (opus-4-8) | 1→orch | 9.5k | 12.4k | 507k | 84.4% | 21 | 0 | 3m03s |
| impl-all | implementer (opus-4-8) | 1→orch | 8.3k | 12.1k | 2.10M | 84.0% | 44 | 0 | 50m45s |
| arch-review | architecture-reviewer (opus-4-8) | 1→orch | 4.5k | 6.5k | 230k | 81.0% | 11 | 0 | 1m50s |
| plan-verify | plan-verifier (opus-4-8) | 1→orch | 5.8k | 7.7k | 388k | 89.4% | 18 | 0 | 2m04s |
| **agents Σ** | | | **28.1k** | **38.6k** | **3.23M** | | **94** | **0** | **57m42s** |
| orchestrator | fable-5 / opus-4-8 | — | 13.8k | 74.7k | 6.64M | 92.3% | 71 | 2 | 2h41m (session) |
| **total** | | | **41.9k** | **113.3k** | **9.87M** | **89.6%** | **165** | **2** | |

Parallelism: agents wall-clock 2h02m, Σ agents 57m42s, factor **0.47**, max
concurrent **2** (arch-review ∥ plan-verify). The factor is expectedly < 1 for a
single-agent plan; the wall-clock span also contains the ~62-min orchestrator
green barrier between `impl-all` (ended 02:52) and the reviewers (started 03:55),
during which no agent ran. No agent was resumed via `SendMessage`, so durations
are not idle-skewed.

Orchestrator tool errors (2): a `Monitor` call without the deferred schema loaded
(InputValidationError — one wasted turn), and the `git push` denied by the
pre-publish hook (not a defect — the gate working as designed).

Duplicate reads: mild and structural — `spec-creator.md` ×4, the plan ×3, both
server `constants.ts` ×3 (planner built ground-truth excerpts; implementer must
Read before Edit; verifiers read for evidence). No action worth taking.

## Insights → actions

1. **The targeted-tests clause must survive single-agent mode.** The orchestrator
   prompt relaxed it because the slice spanned both packages — recreating exactly
   the duplication the clause prevents (client suite ×2, server ×3; ≈35–40 min of
   avoidable wall-clock, ~38% of the run). For a deletion/docs plan the targeted
   set is just typecheck + the touched files' suites; the barrier owns the full
   suites in every mode. → **Action:** keep the narrowing clause verbatim in ALL
   spawn prompts, including single-agent whole-plan ones; appended to
   `.claude/agents/INSIGHTS.md` (2026-07-06).
2. **Green barrier: never launch the client and server suites concurrently in one
   WSL distro, and never pipe the runner through `tail`.** The parallel batch
   reflaked `onTaskUpdate` (known 2026-07-05 insight) and the pipe reported exit 0
   for a failed run; only the printed `[ELIFECYCLE]` line revealed it. → **Action:**
   already captured in `.claude/agents/INSIGHTS.md` (2026-07-06, exit-code entry);
   run barrier suites staggered and end commands with `; echo "EXIT=$?"`.
3. **Suite duration is TD-010, not pipeline overhead.** Client: 2373s total for
   10.6s of actual tests (setup 1882s, environment 7145s CPU-s in jsdom). Any
   future run-time win here comes from fixing
   `docs/technical-debt/TD-010-client-vitest-jsdom-overhead.md`, not from
   orchestration tuning. → **Action:** none new (TD-010 already filed); treat it
   as the #1 lever on wall-clock.
4. **Scope-trimming the pipeline head worked.** Replacing spec-creator with an
   in-chat proposal + `AskUserQuestion` approval (for a rules/cleanup task with no
   product behavior change) and passing execution mode up front produced the
   cheapest run in the ledger with zero coverage loss (12/12, 0 findings).
   → **Action:** reuse this shape for rules/docs/cleanup tasks; full SDD head
   stays for product features.

## Trend note

vs 2026-07-06 `50804825` (previous single-agent run): tokens −47% out (113.3k vs
214.4k), tools −58% (165 vs 393), agents 4 vs 6, wall ≈ same (2h02m vs 2h06m) —
because suite time, not agent count, now dominates single-agent runs (see TD-010).
vs the multi-agent feature runs (07-04/07-05): an order of magnitude cheaper, as
expected for a cleanup-scale task. First run through the new commit→push→PR leg
with the pre-publish marker: no rework, one PR body append.
