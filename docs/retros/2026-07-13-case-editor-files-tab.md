# Retro — Case Editor Files input tab (2026-07-13)

**Session:** `1e58c224` · **Mode:** multi-agent · **Pipeline:** AskUser×2 → spec-creator →
implementation-planner (AskUser×1 execution mode) → run-plan [4 implementers in 2 waves →
test-writer gap pass → green barrier → arch-review ∥ plan-verify] · **Publish:** none (stopped
before `pr-self-review`, per user).

## TL;DR verdict

**Went well.** A clean, cheap, zero-rework run: all **22/22 ACs IMPLEMENTED on the first pass**,
architecture **PASS with 0 findings**, and **0 fix iterations**. The full green barrier
(client 414 + server unit 690 + server integration 179 + both typechecks + shared sync-check)
was green with no red-loop. Only **1 tool error** across 291 tool calls (an implementer's
self-corrected test assertion) — the lowest error count of any multi-agent feature run in the
ledger. Output tokens (279k) came in roughly **half** the previous multi-agent feature
(differential, 574k) with fewer agents (9 vs 12), because the four implementer slices were
small, disjoint and pre-loaded with a verbatim context pack.

**What dragged.** Nothing broke, but two structural ceilings showed: (1) `parallel_factor 0.94`
with `∥max 2` — the plan's 2-waves-of-2-slices shape caps concurrency at two, and the strictly
sequential SDD front (spec 7m36s → planner 13m52s, ~9min of inter-phase gaps) plus the
sequential test-writer→reviews tail dominate wall-clock; (2) the two lead agents ran cold on
cache (spec-creator **47.8%**, planner **74.9%**) — inherent first-mover cost, since the context
pack they PRODUCE is what makes every later agent cheap (≥91%).

## Metrics (deep mode — parsed from journals; parent `<usage>` excludes subagents)

| agent | type (model) | depth→parent | in | out | cache-read | hit% | tools | err | duration |
|-------|--------------|--------------|----|-----|------------|------|-------|-----|----------|
| af305b81 | spec-creator (opus-4-8) | 1→orch | 33.9k | 35.3k | 271.4k | 47.8% | 18 | 0 | 7m36s |
| acaa29f3 | implementation-planner (opus-4-8) | 1→orch | 13.4k | 63.6k | 1.55M | 74.9% | 33 | 0 | 13m52s |
| a2e11adb | impl-p1 shared contract (opus-4-8) | 1→orch | 6.8k | 8.0k | 958.7k | 91.3% | 21 | 0 | 2m17s |
| a9064fde | impl-p2 client helpers+i18n (opus-4-8) | 1→orch | 6.6k | 8.0k | 919.5k | 91.5% | 17 | 1 | 2m15s |
| ac3d3e29 | impl-p3 server synth (opus-4-8) | 1→orch | 6.9k | 23.4k | 4.10M | 96.7% | 45 | 0 | 7m23s |
| a2128231 | impl-p4 client Files tab (opus-4-8) | 1→orch | 6.6k | 39.0k | 3.00M | 95.3% | 39 | 0 | 9m49s |
| a9024bbf | test-gap-pass (sonnet-5) | 1→orch | 8.4k | 15.5k | 1.67M | 92.5% | 26 | 0 | 3m37s |
| acf4a993 | arch-review (opus-4-8) | 1→orch | 8.0k | 10.4k | 562.2k | 85.4% | 19 | 0 | 2m41s |
| a53a4ca7 | plan-verify (opus-4-8) | 1→orch | 8.0k | 18.1k | 1.18M | 91.1% | 25 | 0 | 4m33s |
| **agents Σ** | 9 agents | | **98.6k** | **221.3k** | **14.21M** | | **243** | **1** | Σ 54m02s |
| orchestrator | (opus-4-8) | whole session | 17.3k | 58.0k | 5.87M | 93.8% | 48 | 0 | 1h33m58s |
| **TOTAL** | orch + agents | | **115.8k** | **279.2k** | **20.08M** | **90.9%** | **291** | **1** | — |

**Parallelism:** agents wall-clock **57m28s** (first-start→last-end span, incl. inter-phase gaps)
· Σ agent durations **54m02s** · **factor 0.94** · **∥max 2** (Wave 1 p1∥p2, Wave 2 p3∥p4,
Stage-4 arch∥plan). No agent was resumed via `SendMessage`, so durations are clean (no idle-gap
skew). Orchestrator row covers the whole session (my investigation, 2× AskUser, green-barrier
runs, this retro), not just pipeline dispatch.

## Insights → actions

1. **The context pack produced a zero-fix-loop run.** The planner lifted the load-bearing
   bodies verbatim (C1–C12) AND shared **golden fixtures (C12)** that BOTH synthesizer twins
   (server `diff-synth.ts`, client `helpers.ts`) assert byte-for-byte. Result: the twin-drift
   risk the plan flagged never materialised, arch-review found 0 issues, plan-verify found
   22/22 implemented. **Action:** keep lifting verbatim bodies + a shared golden-fixture block
   into the plan for ANY cross-package duplicated ("twin") logic — it is the mechanism that
   made the parallel implementers converge without a fix cycle. (Captured to
   `.claude/agents/INSIGHTS.md`.)

2. **`duplicate_reads` is dominated by legitimate work, not waste.** The plan file was read 10×
   and the shared-seam sources 4–7× each (`helpers.ts` ×7, `CaseEditor.tsx` ×6, `eval.json` ×6),
   but: editors MUST read-before-edit; read-only reviewers MUST audit the real on-disk code; and
   spec-creator + planner surveyed the seams to CREATE the pack. The only new cold-reads at
   Stage 4 were `diff-synth.ts`/`eval-files.ts` — files that did not exist when the pack was
   written, so they cannot be pre-packed. **Action:** none — this is the floor; the prior retro's
   "context pack for Stage-4 reviewers" action already applied here and worked for pre-existing
   seams. Do not over-optimise cache-cheap reads (hit% 90.9%).

3. **Concurrency is capped by plan shape, not orchestration.** `∥max 2` because each wave had
   exactly two disjoint slices; Wave 2 was mildly duration-imbalanced (p4 client 9m49s vs p3
   server 7m23s) but within the 2× wave-balance gate, so no split was warranted. The SDD front
   and the test→review tail are inherently sequential. **Action:** accept factor 0.94 for a
   feature this size — the 4-way implementer split already extracted the parallel win the
   feature's dependency graph allows (2 pairs). Wider waves would need more independent slices
   than a single-component UI + its backend seam can offer.

## Trend note

| run | mode | agents | out | cache-read | hit% | wall | factor | err | fix-loops |
|-----|------|--------|-----|------------|------|------|--------|-----|-----------|
| 2026-07-12 differential | multi | 12 | 573.6k | 52.78M | 94.8% | 2h48m* | 0.96* | 5 | — |
| 2026-07-13 stability | single | 6 | 317.6k | 40.50M | 95.5% | 1h07m | 0.84 | 0 | 0 |
| **2026-07-13 files-tab** | **multi** | **9** | **279.2k** | **20.08M** | **90.9%** | **57m28s** | **0.94** | **1** | **0** |

Cheapest and fastest of the last three eval-surface runs despite being multi-agent: half the
output of the differential run and less wall-clock than the single-agent stability run, because
the four slices were small, truly disjoint, and pre-packed. Lower hit% (90.9% vs ~95%) is the
cold SDD front (spec 47.8% / planner 74.9%) diluting an otherwise-hot session — a smaller total
prompt volume gives the cold agents proportionally more weight. Zero fix-loops for the second
run running, tracking the maturing context-pack discipline.

*Prior wall/factor carry `*` (SendMessage-resume skew); this run has none.*
