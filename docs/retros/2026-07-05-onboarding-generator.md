# Retro — Onboarding Generator (spec → plan → run-plan → pr-self-review)

**Session:** `af9c1cdd` · **Date:** 2026-07-05 · **Mode:** deep (journal metrics)
**Run:** full SDD loop for SPEC-2026-07-05-onboarding-generator — spec-creator (interview,
3 user Q-rounds) → implementation-planner → run-plan (7 implementer phases in 3 overlapping
waves, test-writer gap pass, green barrier, arch-review ∥ plan-verify, ZERO fix iterations)
→ pr-self-review (PASS, push, PR #12 update).

## TL;DR verdict

**Went well.** Second consecutive zero-fix-iteration pipeline run: 23/23 AC IMPLEMENTED on the
first verify, one advisory MEDIUM (in-service `new OnboardingRepository` bypassing the
composition-root getter — traced to a disjunctive CP-6 instruction, insight recorded). The
eager wave-2 launch (impl-p3 spawned the moment Phase 1 landed, impl-p5 the moment Phase 4
landed, instead of waiting for the full wave) overlapped waves and kept 4 implementers
concurrent at peak. Cache discipline stayed excellent (79–98.6 % per agent, ≈95.3 % overall).
The orchestrator-level INSIGHTS sweep caught a real plan error pre-execution (the plan claimed
"no sync script" while `scripts/sync-shared.mjs` exists — fixed before any implementer ran).

**Went badly.** Wall-clock is dominated by WSL test runs, not model work: the client full
suite costs ~36 min and the server full suite ~31 min, and they were run repeatedly — impl-p6
and impl-p7 each ran the FULL client suite inside their phases (~35 min each of mostly
redundant waiting) on top of the orchestrator's own green barrier. The measured
`parallel_factor` 1.07 is a skewed lower bound (user interview gaps + serial spec/plan stages
+ resumed-agent journals sit inside `agents_wall_clock`), but the test-run duplication is real
and actionable.

## Metrics

| agent | type (model) | depth→parent | in | out | cache-read | hit % | tools | err | duration |
|---|---|---|---|---|---|---|---|---|---|
| spec-onboarding | spec-creator (opus-4-8) | 1→orch | 60.6k | 39.0k | 3.67M | 88.6 | 46 | 2 | 51m56s* |
| — researcher ×4 (repo-intel / LLM / client-UI / DB) | researcher (sonnet-5) | 2→spec | 6.5k | 43.7k | 1.76M | 79–95 | 124 | 0 | 1.4–3.1m each |
| plan-onboarding | implementation-planner (opus-4-8) | 1→orch | 31.8k | 36.9k | 4.71M | 95.6 | 57 | 0 | 10m42s |
| — Explore ×3 (facade+LLM / client page / backend module) | Explore (haiku-4.5) | 2→plan | 1.7k | 25.0k | 3.08M | 94–95 | 137 | 1 | 1.8–9.5m each |
| impl-p1 contracts | implementer (opus-4-8) | 1→orch | 6.2k | 8.9k | 0.94M | 91.8 | 18 | 0 | 13m39s |
| impl-p2 prompt | implementer (opus-4-8) | 1→orch | 6.0k | 7.1k | 0.50M | 90.9 | 16 | 0 | 2m38s |
| impl-p3 server module | implementer (opus-4-8) | 1→orch | 5.9k | 32.7k | 3.75M | 96.1 | 47 | 1 | 18m23s |
| impl-p4 UI primitives | implementer (opus-4-8) | 1→orch | 7.6k | 18.3k | 3.18M | 97.1 | 57 | 1 | 28m38s |
| impl-p5 tour page | implementer (opus-4-8) | 1→orch | 12.0k | 34.9k | 8.74M | 95.2 | 101 | 2 | 63m39s |
| impl-p6 sidebar nav | implementer (opus-4-8) | 1→orch | 5.4k | 10.6k | 1.50M | 92.1 | 35 | 2 | 27m0s |
| impl-p7 i18n | implementer (opus-4-8) | 1→orch | 6.3k | 9.9k | 1.22M | 81.4 | 33 | 0 | 33m55s |
| test-gap-pass | test-writer (sonnet-5) | 1→orch | 11.1k | 30.5k | 12.73M | 98.6 | 101 | 1 | 50m45s |
| arch-review | architecture-reviewer (opus-4-8) | 1→orch | 7.1k | 10.8k | 2.14M | 95.6 | 33 | 1 | 3m52s |
| plan-verify | plan-verifier (opus-4-8) | 1→orch | 7.0k | 14.3k | 1.95M | 92.7 | 54 | 0 | 3m38s |
| **agents total (19)** | | | **175.3k** | **322.5k** | **49.87M** | | **859** | **11** | Σ 5h30m* |
| orchestrator (whole session) | fable-5 | 0 | 16.7k | 136.3k | 22.57M | 96.5 | 109 | 1 | 5h51m |
| **orchestrator + agents** | | | **192.0k** | **458.9k** | **72.44M** | **95.3** | **968** | **12** | wall 5h51m |

**Parallelism:** agents wall-clock 5h10m, Σ agent durations 5h30m, factor **1.07**\*,
max concurrent **5** (spec-creator + its 4 researchers). \*Skewed lower bound: spec-creator and
the planner were resumed via `SendMessage`, so their durations include user-interview idle;
the serial spec→plan→waves→barrier→review chain (with user decision gaps) sits inside the
wall-clock. Within waves, concurrency was real: W1 ran 4 implementers at once; W2 overlapped
p3∥p5 by eager per-dependency launch.

**Green barrier (orchestrator-run, parallel):** server 574/574 (~31 min) ∥ client 196/196
(~36 min) + both typechecks — the single largest wall-clock block after impl-p5.

## Insights → actions

1. **Implementers re-ran full package suites inside their phases.** impl-p6 and impl-p7 each
   ran the whole client suite (~35 min each); the orchestrator then re-ran it at the green
   barrier anyway. The implementer brief says "run the relevant test suite to green" — too
   loose. **Action:** in `.claude/skills/run-plan/references/spawn-prompts.md` (implementer
   template) add: "run ONLY the tests for your slice (targeted `vitest run <files>` +
   package typecheck); the full-suite gate is the orchestrator's green barrier."
2. **A disjunctive wiring instruction in the context pack became the run's only MEDIUM.**
   CP-6 offered "container getter OR construct in the service"; the implementer picked the
   variant that bypasses the composition root. Already recorded in
   `.claude/agents/INSIGHTS.md` (2026-07-05). **Action (done):** planner rule — CP wiring
   choices must name ONE canonical mechanism.
3. **Module INSIGHTS conventions reached agents only via the orchestrator relay.** impl-p4
   discovered the "fireEvent, no user-event" convention by trial (it was already in
   `client/INSIGHTS.md`); the orchestrator then hand-injected it into later spawn prompts.
   **Action:** in `.claude/agents/implementation-planner.md` (context-pack rule) add: "harvest
   the touched modules' INSIGHTS.md conventions relevant to the phases into the context pack
   (test conventions, tooling quirks) — don't leave them for implementers to rediscover."
4. **Orchestrator-level INSIGHTS sweep pays for itself.** The wrap-up sweep after planning
   caught the plan's false "no sync script" claim against `server/INSIGHTS.md` BEFORE any
   implementer ran on it; a memory rule now generalizes it (verify subagent negative claims
   against INSIGHTS). No further action — pattern confirmed working.
5. **Eager per-dependency wave launch worked.** Spawning impl-p3 the moment Phase 1 finished
   (not waiting for the whole wave) and impl-p5 right after Phase 4 shaved the W1→W2 barrier;
   no scope conflicts because slices were disjoint. **Action:** codify in
   `.claude/skills/run-plan/SKILL.md` Stage 1: "a phase may start as soon as its `depends on:`
   set is satisfied — waves are a scheduling default, not a barrier."
6. **Duplicate reads are now mostly legitimate.** Top files (plan ×9, spec ×9, prompt ×7)
   were read by role-appropriate agents (verifiers MUST re-read from disk; spec-creator
   iterated on its own file). No context-pack gap comparable to the previous run.

## Trend note (vs 2026-07-04 project-context run)

Comparable scale, better shape: 20 journals vs 18, output 458.9k vs 475.4k (−3 %),
cache-read 72.4M vs 92.7M (−22 % — leaner context per agent), tool calls 968 vs 1064,
errors 12 vs 12, zero fix-iterations both runs. Max concurrency rose 4→5. Wall time grew
(5h51m vs 4h18m) but includes three user decision rounds (section-set discussion) and one
full pr-self-review + publish cycle that the previous retro's window did not; the WSL
full-suite cost (~31–36 min per package) is unchanged and remains the dominant fixed cost —
now targeted by action #1.
