# Retro — Skill Eval stability layer (spec-finalize → plan → run-plan pipeline, single-agent)

- **Session:** `5d01a2b6` · **Date:** 2026-07-13 (agents ran 2026-07-12 ~20:55–22:02 UTC)
- **Mode:** deep (journals parsed from disk) · **Pipeline:** SDD chain — spec-creator (finalize to approved) → implementation-planner → run-plan [implementer → test-writer gap pass → architecture-reviewer ∥ plan-verifier]
- **Outcome:** clean-with-follow-ups — 11/11 AC IMPLEMENTED, green barrier fully green, **0 tool errors across all 6 agents (244 calls) + orchestrator (61)**, **0 fix iterations**.

## TL;DR verdict

**Went well.** The cheapest, cleanest run in the ledger to date on a per-error basis: **zero** tool errors and **zero** fix iterations on a 3-package change (shared contract + server DB/service/routes + client dashboard). Front-loading paid off end-to-end — the 4 UD decisions were handed to spec-creator (one-pass finalize, no interview), execution-mode + spec path handed to the planner (no stop-and-ask), and a pre-verified symbol set + a verbatim WSL env block handed to the implementer (107 tool calls incl. many WSL `Bash` runs, 0 errors). Cache discipline was excellent (implementer 98.5 % on 20.7 M cache-read; session-wide 95.5 %). Single-agent was the right call for a layer-on-a-shipped-feature: half the output tokens and ~40 % of the wall-clock of its multi-agent sibling (`ac1ecd07`, the differential feature).

**Went less well (minor).** `parallel_factor` 0.84 — inherent to single-agent SDD (only Stage 4 review overlapped, `max_concurrent` 2), not a defect, but ~10.5 m of the 67 m agent wall-clock was idle gaps (orchestrator running the green barrier + composing prompts between sequential stages). The one real efficiency lead: the two read-only Stage-4 reviewers each **cold-read the same new seam files** (`stability.ts`, `skill-stability-executor.ts`, `eval-skill-stability.repo.ts`, `service.ts`, `routes.ts`, `schema/eval.ts`, contracts) — arch-review sat at 78.9 % cache hit precisely because its inputs were cold. Cache made it cheap in $, but it costs reviewer turns + context budget.

## Metrics

| agent | type (model) | in | out | cache-read | hit % | tools | err | duration |
|---|---|---|---|---|---|---|---|---|
| — | spec-creator (opus) | 9.3k | 17.8k | 1.12M | 92.8 | 18 | 0 | 4m12s |
| — | implementation-planner (opus) | 10.6k | 39.6k | 1.02M | 77.4 | 26 | 0 | 8m04s |
| impl-p1 | implementer (opus) | 8.2k | 102.6k | 20.72M | 98.5 | 107 | 0 | 24m07s |
| test-gap-pass | test-writer (**sonnet-5**) | 8.5k | 30.0k | 5.48M | 96.8 | 46 | 0 | 10m30s |
| arch-review | architecture-reviewer (opus) | 6.8k | 19.8k | 0.38M | 78.9 | 14 | 0 | 4m39s |
| plan-verify | plan-verifier (opus) | 9.9k | 19.0k | 1.53M | 89.4 | 33 | 0 | 4m51s |
| **agents Σ** | 6 agents | **53.3k** | **228.8k** | **30.25M** | — | **244** | **0** | Σ 56m24s |
| orchestrator | (opus, whole session) | 17.9k | 88.9k | 10.25M | 93.1 | 61 | 0 | 8h03m (session wall) |
| **orch + agents** | — | **71.2k** | **317.6k** | **40.50M** | **95.5** | **305** | **0** | — |

> Orchestrator numbers cover the WHOLE session jsonl (incl. the earlier conversational Q&A about evals + idle), NOT just the pipeline; its 8h03m wall is not the pipeline duration.

**Parallelism:** agents wall-clock **66m57s** · Σ agent durations **56m24s** · `parallel_factor` **0.84** · `max_concurrent` **2** (`arch-review` ∥ `plan-verify`, the only parallel stage — by design). No agent was resumed via `SendMessage`, so the factor is unskewed: the sub-1.0 factor is genuine idle time between sequential SDD stages (incl. the orchestrator-run green barrier at 21:50→21:57).

## Insights → actions

1. **Stage-4 reviewers cold-read the same new seams (biggest lead).** `duplicate_reads` shows `stability.ts` (×3), `skill-stability-executor.ts` (×2), `eval-skill-stability.repo.ts` (×2), `service.ts` (×6 across the chain), `routes.ts`/`schema/eval.ts` (×3) re-read by arch-review + plan-verify (+ implementer/planner). arch-review's 78.9 % hit confirms cold inputs.
   → **ACTION:** add a **context-pack block to the run-plan Stage-4 spawn templates** (`.claude/skills/run-plan/references/spawn-prompts.md` templates 3 & 4): the orchestrator already holds the changed-files list — pre-read the NEW files once and embed their signatures/key fragments so both reviewers audit rather than locate. Reinforces the existing ledger action "context pack also in single-agent plans" (2026-07-10), now pinned to the review stage specifically.

2. **Model tiering held: test-writer on sonnet-5 was clean and cheap** (96.8 % cache, 30k out, 46 tools, 0 errors) — the differential retro introduced `[sonnet-5]`; this run confirms it for a gap pass. The two read-only reviewers (arch-review, plan-verify) are also pattern-match + evidence-quote tasks.
   → **ACTION (low-confidence experiment):** try `plan-verifier` on `model: sonnet-5` on the next single-agent run and compare RTM verdict quality against this opus baseline; keep `architecture-reviewer` on opus (needs architectural judgment) until measured. Frontmatter: `.claude/agents/plan-verifier.md`.

3. **Front-loaded decisions + rich spawn prompts → 0 stop-and-ask, 0 errors, 0 rework.** The 4 UD decisions (spec-creator), execution-mode + spec path (planner), and the pre-verified symbol set + verbatim WSL env block (implementer) eliminated every interview round-trip and kept `tool_errors` at 0 across 107 implementer calls that included WSL `Bash` mirror runs + `pnpm db:generate` — the class of call that historically flails on env quirks.
   → **ACTION:** codify "embed the pre-verified symbol set + the verbatim WSL test/env block in the single-agent implementer spawn prompt" as the default (it is what bought the 0-error 3-package run). Orchestration insight → `.claude/agents/INSIGHTS.md` if not already present.

## Trend note

Versus its multi-agent sibling `ac1ecd07` (Skill Eval differential, 2026-07-12): 6 agents vs 12, **out 317.6k vs 573.6k (~55 %)**, **wall 1h07m vs 2h48m (~40 %)**, cache-read 40.5M vs 52.8M. Single-agent + a layer-on-a-shipped-base is dramatically cheaper than the multi-agent feature build, as expected. Versus the closest single-agent shape `c531ed06` (in-diff links, 6 agents, 40m wall, factor 0.84): same factor, this run ~27m longer because the lone implementer carried 22 tasks across 3 packages (24m alone). **Errors: 0** — the cleanest in the ledger (differential 5, agent-eval 3, project-context 12); the front-loading discipline is compounding across runs.
