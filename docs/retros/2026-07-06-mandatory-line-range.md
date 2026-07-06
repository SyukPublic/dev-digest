# Retro — mandatory line-range in risk refs (2026-07-06, session f6bdf438)

Full SDD delta cycle on an already-shipped feature, **single-agent** mode:
spec evolution (change request + English-only sync) → delta plan (Phases 9–13,
T30–T38) → run-plan pipeline → publish (commit/push/PR #12 update through the
pr-self-review gate, twice). Zero Stage-5 fix iterations; all fixing happened
INSIDE the Stage-3 green barrier (4 iterations, all routed to the same warm
implementer via `SendMessage`).

## TL;DR verdict

**Went well.** The requirements went from Ukrainian chat decisions to an approved
spec, a delta plan, green code, and a pushed PR in one session with clean reviews
(arch: 0 findings; RTM: 11/11 IMPLEMENTED) and no Stage-5 loop. The
single-implementer resume model proved itself: one agent absorbed the initial
build AND four barrier fix rounds (two stale test fixtures, the flow-08
real-browser click divergence, the e2e.sh boot-timeout/warm-up infra) at a 96.8 %
cache hit across 145 API turns — context stayed warm, no fresh-fixer respawns.
Deep, evidence-first debugging paid off: the flow-08 failure was bisected in the
running hermetic stack down to "CDP coordinate clicks don't reach React's
delegated onClick", fixed in the flow (eval native click), not by poking the UI.

**Went badly.** The e2e leg of the green barrier consumed ~1h25m wall-clock and
FOUR hermetic runs before going 8/8, and stalled twice on user-only machine
setup (`pnpm approve-builds` for esbuild, `sudo apt` for Chrome's shared libs) —
each a fail → diagnose → ask-user → rerun cycle. None of that was foreseeable
from the diff, but ALL of it was probeable up front: a pre-flight
"`agent-browser open about:blank` actually launches + the e2e pnpm gate is
approved" check would have batched both stalls before Stage 1 (insight recorded).
The 60 s hard-coded boot wait in `scripts/e2e.sh` also hid the real state of a
healthy-but-slow (86 s on 9p) API boot for one full run.

## Metrics

| agent | type (model) | depth→parent | in | out | cache-read | hit % | tools | err | duration |
|---|---|---|---|---|---|---|---|---|---|
| spec-creator | spec-creator (opus-4-8) | 1→orch | 38.8k | 39.7k | 8.74M | 95.0 % | 85 | 1 | 18m14s |
| implementation-planner | implementation-planner (opus-4-8) | 1→orch | 17.2k | 21.8k | 2.18M | 92.3 % | 37 | 0 | 5m55s |
| impl-p9-13 | implementer (opus-4-8) | 1→orch | 18.4k | 74.3k | 28.84M | 96.8 % | 164 | 8 | 108m07s* |
| test-gap-pass | test-writer (sonnet-5) | 1→orch | 6.1k | 13.3k | 2.93M | 94.4 % | 57 | 0 | 3m57s |
| arch-review | architecture-reviewer (opus-4-8) | 1→orch | 13.0k | 8.2k | 0.61M | 86.1 % | 24 | 0 | 2m29s |
| plan-verify | plan-verifier (opus-4-8) | 1→orch | 8.9k | 7.9k | 1.53M | 91.7 % | 29 | 1 | 2m34s |
| **agents total** | | | **102.4k** | **165.3k** | **44.82M** | | **396** | **10** | Σ 2h21m* |
| orchestrator | (fable-5, whole session) | — | 19.5k | 133.2k | 32.65M | 98.5 % | 138 | 8 | 3h38m |
| **orch + agents** | | | **121.8k** | **298.5k** | **77.48M** | ~96.9 % | 534 | 18 | |

Parallelism: agents wall-clock 2h33m, Σ agent time 2h21m, **factor 0.92**, max
concurrent 2 (test-writer overlapped the implementer's idle gap). `*` skew: the
implementer was resumed 5× via `SendMessage`, so its 108m duration INCLUDES the
idle gaps between passes (initial build ≈35m + four short fix rounds); Σ and the
factor are upper/lower bounds accordingly. Orchestrator numbers cover the whole
session (analysis, approvals, publish, retro prep included).

Session wall-clock 07:29→11:07 (3h38m), of which ~35m was waiting on two
user-unblock pauses and four hermetic e2e runs (~5–7m each: 86 s API boot +
next-dev cold compiles + flows).

## Insights → actions

1. **E2e prerequisites must be probed at pre-flight, not discovered mid-barrier.**
   Stage 3 stalled twice on user-only setup (esbuild `approve-builds`; Chrome
   shared libs via sudo apt) plus a missing global `agent-browser`. → Action:
   add to `.claude/skills/run-plan/SKILL.md` Pre-flight: "plan contains e2e
   tasks → probe `agent-browser open about:blank` and the e2e package's pnpm
   gate BEFORE Stage 1; surface all missing prereqs as ONE user ask". (Insight
   already appended to `.claude/agents/INSIGHTS.md` 2026-07-06.)
2. **The warm-implementer fix loop is the right default for barrier reds.**
   Four green-barrier iterations (2 stale fixtures, flow-08 divergence, e2e.sh
   infra) all went to the SAME resumed implementer at 96.8 % cache hit; no fresh
   fixer was spawned, no context was re-established. → Action: none (confirms
   the 2026-07-04 route-to-warm-owner insight; run-plan Stage 5 already prefers
   it) — keep citing evidence in spawn prompts (failure output verbatim).
3. **jsdom green ≠ real-browser green for interaction-dependent e2e asserts.**
   The flow-08 step passed as an RTL test but failed under agent-browser because
   CDP coordinate clicks never reach React's delegated `onClick` on
   `CollapsibleCard`; the deterministic fix is an `eval` native `.click()` step.
   → Action: recorded in `e2e/INSIGHTS.md`; when authoring future flows that
   must toggle React state, reach for `eval` native clicks directly instead of
   `find … click`.
4. **Hard-coded infra timeouts hide healthy-but-slow states.** The 60 s API wait
   in `scripts/e2e.sh` failed a boot that measurably succeeds at 86 s under 9p
   (TD-010 class). → Action: DONE in this run — `E2E_BOOT_TIMEOUT` (default
   240 s) + cold-route curl warm-up landed in `scripts/e2e.sh`; gotcha recorded
   in `e2e/INSIGHTS.md`.
5. **No-context-pack is an acceptable trade-off for single-agent deltas, priced
   by cache.** The plan was read 11×, `assembler.ts` 8×, the spec 25× (20 by
   spec-creator itself — its own working artifact) across sequential agents, yet
   every agent sat at 86–97 % cache hit, so duplicate reads cost latency, not
   meaningful tokens. → Action: none; keep "no CP, sources cited inline" for
   single-agent delta plans.
6. **test-writer on sonnet-5 is the right cost point for RTM gap audits.** It
   audited 9 RTM rows, wrote 1 test file, and mutation-checked it in under 4m /
   13.3k out. → Action: none (keep the model split: sonnet for the mechanical
   gap pass, opus for reviewers/planner).

## Trend note

Fourth pipeline retro in the ledger with single-agent mode (vs 50804825 and
bd75fd78): totals landed between the UI-refinements run (285k combined out was
214k) and the big multi-agent features — out 298.5k is higher than both prior
single-agent runs because this delta included a full spec evolution (39.7k out),
four barrier iterations with real-stack e2e debugging, and TWO gated publishes;
in exchange, Stage 5 was empty for the third run straight and reviews were
clean-on-first-pass. Parallel factor 0.92 is the expected single-agent shape
(only the two reviewers overlap); max-concurrent 2 matches. Cache hit ≥95 %
everywhere except arch-review (86 % — short run, mostly fresh files) continues
the 95–96 % trend. The recurring lesson class shifted again: 07-04 was about
phase sizing, 07-05 about targeted tests, 07-06(a/b) about single-agent DoD —
this run's is environment pre-flight (e2e prereqs), suggesting the pipeline's
remaining waste is now in ENVIRONMENT readiness, not agent orchestration.
