# Retro — Export to CI (SDD → plan → run-plan → publish)

- **Session:** `9fdbf1e3` · **Date:** 2026-07-14 · **Mode:** multi-agent
- **Scope:** one continuous session covering the *whole* feature lifecycle — 4×Explore research → spec-creator → implementation-planner (+4 nested Explore) → run-plan (5 implementers + test-writer + arch-reviewer + plan-verifier) → commit + push (pr-self-review gate). 18 subagents + orchestrator.

## TL;DR verdict

**Went well.** The richest input yet (planner emitted an 86.8k-token plan with a verbatim C0–C12 context pack) bought a **zero-fix-loop** run: green barrier passed first try (server 727 unit + 202 integration, client 457, agent-runner 23), architecture-reviewer PASS (0 CRITICAL/HIGH), plan-verifier 44/45 IMPLEMENTED. Intra-stage parallelism was excellent — every wave fully overlapped (max 5 concurrent), file-disjoint slices never collided. The one PARTIAL (AC-34 severity split) was a *pre-accepted* plan-level DTO cap, not a miss.

**Went less well.** Two efficiency leaks, neither fatal: (1) **all 8 Explore scout agents ran on opus** doing pure read/grep mapping — a cheaper tier fits, as the test-writer (sonnet-5) already proves. (2) The same small seams were re-read by nearly every agent (`eval-ci.ts` 10×, `ci.json` 10×) despite the context pack — the recurring "reviewers/implementers cold-read the seams" theme from prior retros persists because the pack was *pointed to* (in the plan file) rather than *embedded* in each spawn prompt. Also: the publish gate cost one wasted cycle — a chained `git commit && git push` was denied wholesale (the hook scans the entire command string), so the commit never ran either.

## Metrics (deep — parsed from journals)

| agent | type (model) | depth→parent | in | out | cache-read | hit% | tools | err | dur |
|-------|--------------|--------------|----|----|------------|------|-------|-----|-----|
| a67b | Explore (opus) | 1→orch | 26 | 9.8k | 632k | 90.8 | 34 | 0 | 161s |
| a943 | Explore (opus) | 1→orch | 25 | 8.5k | 563k | 89.5 | 30 | 0 | 167s |
| af08 | Explore (opus) | 1→orch | 1.6k | 12.6k | 536k | 89.5 | 39 | 1 | 191s |
| aa75 | Explore (opus) | 1→orch | 2.3k | 12.0k | 700k | 88.3 | 34 | 0 | 180s |
| a1147 | **spec-creator** (opus) | 1→orch | 24 | 34.6k | 1.05M | 89.8 | 23 | 1 | 528s |
| a47d | **implementation-planner** (opus) | 1→orch | 844 | 86.8k | 1.16M | 70.7 | 24 | 0 | 1359s |
| af56 | Explore (opus) | 2→planner | 1.0k | 4.5k | 202k | 80.3 | 30 | 0 | 147s |
| a29e | Explore (opus) | 2→planner | 13 | 9.4k | 172k | 87.4 | 21 | 0 | 118s |
| aa2f | Explore (opus) | 2→planner | 25 | 18.5k | 527k | 91.0 | 40 | 0 | 233s |
| a8b0 | Explore (opus) | 2→planner | 18 | 7.6k | 449k | 87.1 | 27 | 3 | 234s |
| af16 | **implementer** impl-p1 (opus) | 1→orch | 109 | 30.4k | 6.66M | 97.8 | 56 | 0 | 641s |
| a3f2 | **implementer** impl-p5 (opus) | 1→orch | 7 | 5.3k | 203k | 73.8 | 7 | 0 | 121s |
| acf1 | **implementer** impl-p2 (opus) | 1→orch | 104 | 52.9k | 8.43M | 97.5 | 72 | 0 | 1417s |
| ae4e | **implementer** impl-p3 (opus) | 1→orch | 1.1k | 61.5k | 11.43M | 98.2 | 97 | 3 | 1464s |
| a1b0 | **implementer** impl-p4 (opus) | 1→orch | 90 | 42.3k | 5.55M | 97.3 | 57 | 0 | 862s |
| aaa4 | **test-writer** (sonnet-5) | 1→orch | 132 | 27.8k | 6.10M | 97.8 | 65 | 0 | 473s |
| a5cb | **architecture-reviewer** (opus) | 1→orch | 62 | 18.6k | 1.22M | 91.4 | 34 | 0 | 316s |
| af4d | **plan-verifier** (opus) | 1→orch | 40 | 27.4k | 1.96M | 93.2 | 47 | 0 | 398s |
| **agents total** | 18 subagents | — | **7.5k** | **470.5k** | **47.54M** | — | **737** | **8** | Σ 9011s |
| **orchestrator** | (opus, whole session) | — | 180 | 152.8k | 21.73M | 97.4 | 89 | 4 | — |
| **orch + agents** | — | — | **7.7k** | **623.2k** | **69.27M** | — | **826** | **12** | — |

**Parallelism:** agents wall-clock **5h09m** · Σ agent time **2h30m** · **parallel factor 0.49** · max concurrent **5** (the planner + its 4 nested Explores at 08:04).

> ⚠️ **The 0.49 factor is a measurement artifact, not a scheduling failure.** `agents_wall_clock_s` spans the whole session, which includes two large *human-gated* idle gaps between separately-invoked skill phases — most severely a **~2h36m gap** between the plan finishing (08:25) and the user invoking `/run-plan` (11:01), plus ~55m of `AskUserQuestion`/decision latency around spec+plan. Excluding those gaps, the compute-active spans were tight: SDD ≈ 35m agent-active, run-plan execution ≈ 63m wall with waves fully overlapped. Interpret parallelism **per stage**, not across the human-gated skill boundaries.

## Insights → actions

1. **8 Explore scouts ran on opus for pure read/grep mapping.** → **Action:** spawn Explore/scout agents with `model: sonnet` (fan-out research) — reserve opus for spec-creator/planner/implementers/reviewers. The test-writer already runs sonnet-5 cleanly (97.8% hit, 0 err), proving the cheaper tier handles mechanical passes. Biggest single cost lever this run (8 agents, ~82k opus output on grep/read).
2. **Hot seams re-read by ~every agent despite the context pack** (`eval-ci.ts` 10×, `ci.json` 10×, `ci.ts` 8×, plan 8×, `runs.ts`/`adapters.ts` 7×). The pack *pointed to* the plan's C-sections instead of embedding text, so agents opened the files anyway. → **Action:** for the 1–2 hottest *small* files (the frozen `eval-ci.ts` contract block, `ci.json`), paste their **full text** verbatim into the implementer/reviewer spawn prompts, not a shape summary + "read the plan". (Recurring: 2026-07-13 already actioned "context pack for the Stage-4 reviewers" — extend it to the frozen contract + i18n files.) Low urgency — 97% cache hits made the token cost small; the real win is per-agent context-window headroom.
3. **Publish gate denied the chained `git commit && git push` wholesale** (the `PreToolUse` hook scans the entire command string for `git push`), so the commit silently didn't run either — one wasted cycle. → **Action:** in a "commit and push" flow on this repo, always run `git commit`, `--record-pass`, and `git push` as **three separate** Bash calls. (Captured to `.claude/agents/INSIGHTS.md`.)
4. **Zero fix iterations — the verbose planner context pack (86.8k out) directly caused it.** Implementers hit 97–98% cache, 0–3 (recovered) errors, green first pass. → **Action:** keep the planner's "embed verbatim seams + recorded INSIGHTS conventions" approach for multi-agent runs; it is the highest-leverage quality investment (consistent with the whole ledger's context-pack trend).

## Trend note

- **Largest run in the ledger** (18 agents vs the prior 6–12) and the **first that includes publish** (commit + push + pr-self-review gate) in the same session. Output 623.2k is second only to the 2026-07-12 skill-eval (573.6k) despite double the agents — because 8 of the 18 were short scouts.
- **Lowest parallel factor recorded (0.49 vs 0.72–0.96 prior)** — entirely explained by the human-gated idle gaps between spec/plan/run-plan invocations (prior runs were mostly one continuous chain). Not a regression in scheduling.
- Continues the **zero/low-fix-loop streak** (2026-07-13 Case Editor "zero-fix-loop", this run also zero) whenever the plan ships a rich context pack — the ledger's strongest recurring signal.
