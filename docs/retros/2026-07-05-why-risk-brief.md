# Retro — Why+Risk Brief (spec → plan → run-plan pipeline → publish)

- **Session:** `e1e3cfec-4403-40eb-8f50-d7fe762ff2de` · 2026-07-05 15:48–19:58 UTC (4h10m total)
- **Run:** SPEC-2026-07-05-why-risk-brief → docs/plans/why-risk-brief.md (multi-agent, 8 phases, T1–T29) → implement → gap pass → green barrier → arch-review ∥ plan-verify → publish (PR #12)
- **Mode:** deep (journals parsed by `retro_metrics.py`; 15 subagent journals + orchestrator, 0 parse errors)

## TL;DR verdict

**Went well:** the cheapest and fastest of the three full feature runs to date despite the
largest diff (+8454 lines): 421.6k output tokens (vs 458.9k onboarding, 475.4k
project-context), 15 agents (vs 19/18), 837 tool calls with only 5 errors (vs ~1000/12),
agents wall-clock 3h55m. Zero fix-loop iterations, zero architecture findings, 21/21 AC
IMPLEMENTED on the first review pass. The cost discipline came from: execution mode + approved
spec passed to the planner up front (no interview round-trip), planner grounding via 2 cheap
haiku Explore agents instead of researcher fan-out, eager wave overlap (Wave 2 launched ~2min
after its dependencies reported), warm-agent barrier fix (TS2322 resolved by resuming impl-p8:
3 tool calls, 3.6min), and verbatim context packs in every spawn prompt (agents rarely flailed:
5 tool errors across 745 agent calls).

**Went badly (mildly):** the serial tail. After Wave 2 the pipeline ran single-file for ~2h
(P5 56m → P6 32m → P8 → gap-pass), with two structural causes: (1) Wave 2 was unbalanced —
impl-p5 (client UI, 9 tasks) took 55m37s vs impl-p4's 23m (2.4× — the phase-size balance rule
existed but wasn't enforced at Gate 0); (2) Phase 8 (i18n) declared a dependency on Phase 6
that turned out EMPTY — impl-p6 added zero new i18n keys, so P8 waited ~33min for nothing.
Parallel factor 1.27 (vs 1.42 project-context) reflects that tail. Also the green barrier ran
all three package suites concurrently in one WSL distro and flaked a pre-existing
Testcontainers file (`pulls-by-number.it.test.ts` — passes 5/5 in isolation), costing one
diagnosis cycle (insight already captured).

## Metrics

Skew note: `spec-brief` and `impl-p8` were resumed via `SendMessage` (interview round-trips /
barrier fix), so their `duration` includes idle gaps → **Σ agents and the parallel factor are
upper bounds** (impl-p8's real work was ≈15m of its 86m53s journal span).

| agent | type (model) | depth→parent | in | out | cache-read | hit% | tools | err | duration |
|---|---|---|---|---|---|---|---|---|---|
| spec-brief | spec-creator (opus-4-8) | 1→orch | 17.8k | 35.9k | 4.65M | 91.5 | 47 | 1 | 21m38s* |
| planner-brief | implementation-planner (opus-4-8) | 1→orch | 28.2k | 38.1k | 4.45M | 94.6 | 47 | 0 | 8m53s |
| └ Explore (server inputs) | Explore (haiku-4-5) | 2→planner | 0.9k | 3.3k | 0.53M | 89.0 | 40 | 0 | 1m09s |
| └ Explore (client surfaces) | Explore (haiku-4-5) | 2→planner | 1.5k | 11.6k | 0.85M | 94.6 | 53 | 1 | 2m00s |
| impl-p1 (contracts) | implementer (opus-4-8) | 1→orch | 6.2k | 12.3k | 1.43M | 93.6 | 32 | 0 | 9m34s |
| impl-p2 (prompt) | implementer (opus-4-8) | 1→orch | 6.8k | 13.1k | 1.83M | 94.7 | 32 | 0 | 6m36s |
| impl-p3 (DB) | implementer (opus-4-8) | 1→orch | 5.8k | 8.3k | 0.86M | 92.9 | 22 | 0 | 6m05s |
| impl-p7 (verify-only) | implementer (opus-4-8) | 1→orch | 7.6k | 10.6k | 1.17M | 94.5 | 29 | 0 | 13m00s |
| impl-p4 (server module) | implementer (opus-4-8) | 1→orch | 6.9k | 45.5k | 6.13M | 97.3 | 82 | 0 | 23m03s |
| impl-p5 (client UI) | implementer (opus-4-8) | 1→orch | 10.5k | 49.1k | 16.81M | 96.2 | 144 | 3 | 55m37s |
| impl-p6 (IntentCard) | implementer (opus-4-8) | 1→orch | 6.6k | 25.1k | 2.94M | 96.4 | 46 | 0 | 32m21s |
| impl-p8 (i18n) | implementer (opus-4-8) | 1→orch | 7.8k | 11.7k | 1.26M | 90.3 | 31 | 0 | 86m53s* |
| test-gap-pass | test-writer (sonnet-5) | 1→orch | 9.7k | 16.3k | 4.66M | 96.4 | 54 | 0 | 24m54s |
| arch-review | architecture-reviewer (opus-4-8) | 1→orch | 8.0k | 8.8k | 1.18M | 91.9 | 31 | 0 | 3m07s |
| plan-verify | plan-verifier (opus-4-8) | 1→orch | 8.0k | 13.1k | 3.21M | 94.3 | 55 | 0 | 4m03s |
| **agents total** | | | **132.4k** | **302.9k** | **51.96M** | | **745** | **5** | Σ 4h59m* |
| orchestrator | (fable-5, whole session) | 0 | 19.8k | 118.7k | 19.93M | 97.7 | 92 | 0 | 4h10m |
| **run total** | | | **152.2k** | **421.6k** | **71.89M** | **95.8** | **837** | **5** | wall 3h55m |

**Parallelism:** agents wall-clock 14 101s (3h55m) · Σ agents 17 932s* · factor **1.27*** ·
max concurrent **4** (Wave 1: impl-p1/p2/p3/p7). Waves overlapped eagerly (Wave 2 spawned the
moment P1–P3 reported, while P7 still ran).

## Insights → actions

1. **The i18n phase's dependency on the UI-rework phase was EMPTY** — the plan declared
   `Phase 8 (i18n) depends on: Phase 5, Phase 6`, but Phase 6 (IntentCard rework) reused
   existing keys and contributed zero new strings; P8 idled ~33min behind it. i18n phases
   depend on *key-introducing* phases only, and that set is knowable at planning time (new
   components introduce keys; reworks of existing UI usually don't).
   → **Action:** add to `.claude/agents/implementation-planner.md` (multi-agent profile): an
   i18n/strings phase declares dependencies ONLY on phases that introduce NEW user-facing
   strings; phases editing existing UI are assumed key-neutral unless their task text says
   otherwise. *(Also recorded in `.claude/agents/INSIGHTS.md`.)*
2. **Wave 2 imbalance (P5 = 2.4× P4) serialized the mid-run** — the phase-size balance rule
   (planner INSIGHTS 2026-07-04) exists but nothing enforced it when the plan passed Gate 0.
   P5 carried 9 tasks over two independent component trees (PrBriefCard vs ReviewFocusSection
   + hooks + wiring) and was splittable.
   → **Action:** extend `.claude/skills/run-plan/SKILL.md` Pre-flight: when building waves,
   flag any phase whose task count/scope is >2× its wave's median and ask the planner
   (SendMessage, plan edit-in-place) to split it BEFORE Stage 1 spawns.
3. **Warm-agent barrier fix beats a fresh fixer** — the one red-barrier finding (TS2322 in
   `brief-i18n.test.ts`) was fixed by resuming impl-p8 via `SendMessage`: 3 tool calls, 77k
   tokens, 3.6min — no re-onboarding cost. Confirms the existing routing rule
   (INSIGHTS 2026-07-04, pre-barrier fix routing).
   → **Action:** none new — keep routing barrier failures to the owning wave implementer.
4. **Parallel full-suite barrier flakes Testcontainers** — running server+client+reviewer-core
   suites concurrently in one WSL distro produced `[vitest-worker]: Timeout calling
   "onTaskUpdate"` in a heavy pre-existing it-file; 5/5 green in isolation.
   → **Action:** already captured in `.claude/agents/INSIGHTS.md` (2026-07-05): re-run the
   failing file alone before triaging a red barrier as a regression, or stagger the server
   suite off the parallel batch.
5. **Cheap grounding worked:** planner used 2 haiku Explore agents (14.9k out combined) instead
   of the researcher fan-out of previous runs; spec-creator used none (grounded directly).
   Combined with up-front inputs (spec path + execution mode), the planning stage cost 8m53s
   with zero stop-and-ask round-trips.
   → **Action:** none — keep passing spec path + execution mode in the planner spawn prompt.
6. **Duplicate reads are now mostly reviewer-inherent** — top entries (`PrBriefCard.tsx` ×8,
   `schema/reviews.ts` ×7 across 7 agents, `spec` ×11 of which 7 by its own author while
   editing) are dominated by review/verify agents reading freshly-written feature files, which
   is unavoidable. The residual context-pack candidates are small (`lib/hooks/reviews.ts` ×7,
   `github-urls.ts` ×4 — CP-8/CP-10 carried only short excerpts).
   → **Action (minor):** when a CP cites a client util/hook, include the full relevant
   function body, not a 2-line excerpt (planner CP rule refinement).

## Trend note

Third full feature run in the ledger. Versus onboarding-generator (2026-07-05) and
project-context-folder (2026-07-04): **cheapest output** (421.6k vs 458.9k vs 475.4k),
**fewest agents** (15 vs 19 vs 18), **fewest tool calls** (837 vs 968 vs 1064), **fewest
errors** (5 vs 12 vs 12), and **fastest wall** (3h55m vs 5h10m vs 4h18m) — while shipping the
largest diff of the three. The gains track exactly the prior retros' top actions now applied:
up-front planner inputs (no interview), context packs in every spawn prompt, targeted tests
inside phases (full suite only at the barrier), eager wave overlap. The remaining waste is
concentrated in the serial tail (imbalanced P5 + the empty P8→P6 dependency) — hence this
run's top action. Parallel factor 1.27* is below project-context's 1.42* but the absolute
wall-clock is still the best; factor comparisons remain skewed by resumed-agent idle gaps in
both runs.
