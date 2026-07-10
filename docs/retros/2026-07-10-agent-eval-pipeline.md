# Retro — Agent Eval Pipeline (full SDD run, single-agent pipeline)

- **Session:** `72bba185` · 2026-07-10 12:49–16:31 UTC (~3h42m incl. user rounds)
- **Run shape:** 4×Explore (parallel research) → 3×AskUserQuestion rounds (decision
  front-loading + EN-requirements approval) → spec-creator → implementation-planner →
  run-plan (impl-all → test-gap-pass → green barrier → arch-review ∥ plan-verify).
  No publish stage (deliberate — `pr-self-review` is a separate user ask).
- **Outcome:** clean-with-follow-ups; 33/36 ACs IMPLEMENTED, 3 PARTIAL-Minor; 0 fix iterations.

## TL;DR verdict

**Went well.** The front-loading pattern delivered its third consecutive single-pass run:
research fan-out (4 parallel Explore agents, max-concurrency of the session) fed one
AskUserQuestion round; spec-creator and planner both completed with zero stop-and-ask
round-trips; the implementer executed all 41 tasks in one 47-minute pass at 99 % cache
hit with a single benign tool error; the green barrier (586+133 server, 329 client,
tsc ×2, e2e 9/9) was green on first try; reviewers ran in parallel and produced zero
must-fix findings. The 2026-07-06 retro's top action (pre-flight e2e probe) was applied
and paid off — no mid-barrier environment surprises.

**Went badly (mildly).** The single-agent plan carried no "Shared scaffold (context
pack)" section (the planner's single-agent profile omits it), so the same seam files
were re-read across agents — `db/schema/eval.ts` by 8 agents, `reviewer-core/review/run.ts`
by 7, `contracts/knowledge.ts`/`eval-ci.ts` by 6 each. Cheap per-read (cache), but it is
exactly the duplication a context pack exists to remove, and the pack's consumers are
not just implementers: test-writer and both reviewers re-read the same files. Explore
reports were also on the heavy side (3×22–23k output tokens).

## Metrics (deep mode; journals parsed on host)

| agent | type (model) | depth→parent | in | out | cache-read | hit% | tools | err | duration |
|---|---|---|---|---|---|---|---|---|---|
| Explore: server DB/routes | Explore (opus-4-8) | 1→orch | 8.2k | 22.0k | 1.12M | 88.2 | 53 | 0 | 4m50s |
| Explore: client UI | Explore (opus-4-8) | 1→orch | 5.8k | 22.4k | 1.18M | 92.3 | 55 | 0 | 5m16s |
| Explore: reviewer-core | Explore (opus-4-8) | 1→orch | 13.2k | 23.0k | 1.07M | 90.3 | 43 | 0 | 5m28s |
| Explore: harness/docs | Explore (opus-4-8) | 1→orch | 7.1k | 5.7k | 0.60M | 83.9 | 30 | 0 | 3m14s |
| spec-creator | spec-creator (opus-4-8) | 1→orch | 13.2k | 42.4k | 0.54M | 69.0 | 22 | 0 | 9m27s |
| implementation-planner | planner (opus-4-8) | 1→orch | 10.7k | 38.5k | 2.49M | 86.7 | 55 | 0 | 9m28s |
| impl-all (T1–T41) | implementer (opus-4-8) | 1→orch | 24.2k | 180.4k | 48.06M | 99.0 | 178 | 1 | 47m28s |
| test-gap-pass | test-writer (sonnet-5) | 1→orch | 10.5k | 50.1k | 9.53M | 97.6 | 75 | 0 | 13m20s |
| arch-review | architecture-reviewer (opus-4-8) | 1→orch | 8.0k | 19.8k | 1.21M | 90.7 | 33 | 0 | 5m35s |
| plan-verify | plan-verifier (opus-4-8) | 1→orch | 22.1k | 29.1k | 3.54M | 95.2 | 62 | 0 | 7m18s |
| **Σ agents** | 10 | — | **122.9k** | **433.4k** | **69.33M** | — | **606** | **1** | **Σ 1h51m** |
| orchestrator (whole session) | fable-5 | 0 | 18.2k | 92.8k | 6.37M | 93.9 | 47 | 2 | 3h42m |
| **Total (orch+agents)** | — | — | **141.0k** | **526.2k** | **75.71M** | **96.8** | **653** | **3** | — |

**Parallelism:** agents wall-clock 2h35m\* · Σ agents 1h51m · factor 0.72\* · max
concurrent 4 (the research fan-out). \*Wall includes user-response gaps (AskUserQuestion
rounds between research and spec) and the orchestrator-run green barrier (~13m incl.
background e2e) — no agent was resumed via SendMessage, so per-agent durations are clean.
Factor < 1 is expected for a single-agent pipeline: only the research stage and the
review stage ran in parallel.

**Errors (all benign):** impl-all — one Bash exit-code check quirk at the very end
(1/178 calls, environment class). Orchestrator — one transient "permission classifier
unavailable" on a WSL Bash call (succeeded on retry) and one InputValidationError from
calling the deferred `Monitor` tool without loading its schema first (self-inflicted;
the background-task notification made it unnecessary anyway).

## Insights → actions

1. **Single-agent plans omit the context pack, but its consumers are not just
   implementers.** `duplicate_reads` top: `server/src/db/schema/eval.ts` ×8 readers,
   `reviewer-core/src/review/run.ts` ×7, `contracts/knowledge.ts` ×6, `contracts/eval-ci.ts`
   ×6, `modules/agents/routes.ts` ×6 — test-writer and both reviewers re-read the same
   seams the plan could have carried.
   → **Action:** edit `.claude/agents/implementation-planner.md`: produce the
   "Shared scaffold (context pack)" section in BOTH execution modes (single-agent
   included); run-plan spawn templates already embed it verbatim into test-writer and
   reviewer prompts. *(Applied to `.claude/agents/INSIGHTS.md` via engineering-insights.)*
2. **41 tasks in one implementer is workable but near the practical ceiling.**
   impl-all: 147 API turns, 180k out, 48M cache-read, 99 % hit — stable, no context
   collapse, but the cache-read bill concentrates in one agent and a mid-run failure
   would have lost a 47-minute pass.
   → **Action:** implementation-planner should RECOMMEND an execution mode from plan
   size in its report (>~30 tasks → suggest multi-agent or flag the single-agent
   context/blast-radius trade-off) instead of only accepting the caller's choice.
3. **Explore report bloat.** 3 of 4 research reports were 22–23k output tokens; they were
   load-bearing for the spec, but ~30 % was verbatim shape-quoting that the spec-creator
   re-verified anyway.
   → **Action:** research spawn prompts: add an output budget line ("facts + file:line,
   ≤150 lines; no verbatim multi-paragraph quotes unless load-bearing").
4. **Confirmations (no action needed):** front-loading decisions via one AskUserQuestion
   round again produced zero interview round-trips (3rd run in a row — pattern holds);
   pre-flight e2e probe (top action of the 2026-07-06 mandatory-line-range retro)
   prevented mid-barrier environment stalls; test-writer on sonnet-5 closed 3 uncovered
   ACs in 13m with zero errors — the cheaper-model mix for the gap pass is fine.

## Trend note

vs the previous single-agent runs (2026-07-06): this was the largest single-agent run
retro'd so far — 41 tasks / 10 phases / full feature vs refinements — and the totals
scale accordingly (out 526k vs 197–298k; wall 2h35m vs 41m–2h33m). Output tokens are
the highest in the ledger, driven by one implementer doing the whole feature (180k) plus
four research reports (~73k). Cache hit 96.8 % is ledger-best alongside f6bdf438 (96.9 %),
helped by the implementer's 99 %. Error count (3) is at the low end (vs 2–12).
The multi-agent feature runs (07-04/05) delivered comparable-size features in similar
Σ-agent time but with 15–19 agents and 968–1064 tool calls; this run used 10 agents and
653 calls — single-agent trades wall-clock parallelism for lower coordination overhead,
which held up well at this feature size but argues for multi-agent beyond ~40 tasks.
