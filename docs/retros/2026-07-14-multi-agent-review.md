# Retro — Multi-Agent Review (full SDD: spec → plan → pipeline → publish)

**Session:** `90a207f8` · **Date:** 2026-07-14 · **Mode:** multi-agent · **Branch:** `labs/I07-review`
**Scope:** the whole lifecycle in one session — 4 grounding scouts → spec-creator → implementation-planner → 9 implementers (3 waves) → test-writer gap pass → green barrier → architecture-reviewer ∥ plan-verifier → pr-self-review (client React-lens) → commit + push. 37 ACs, 92 files committed (`24415d8`).

## TL;DR verdict

**Went well.** The biggest run in the ledger by output (670k) and cache-read (77.3M) landed **zero fix iterations**: architecture-review 0 findings, plan-verifier 37/37 IMPLEMENTED, green barrier fully green (reviewer-core 117 / mcp 8 / server-unit 717 / client 450 / both typechecks / arch:check 0). The front-loaded `AskUserQuestion` round (D1–D4) gave a single-pass final spec and plan with no interview round-trips, and the plan's context pack + frozen contracts let backend and frontend waves converge with no drift (e.g. `MultiAgentRunLaunch` reusing `ReviewRunTarget`, `getLatestMultiRun` → service aggregates). Cache discipline was excellent (orchestrator 98.3%, agents 85–98%).

**Went less well.** `parallel_factor = 0.67` — wall-clock was **sequencing-bound**, not compute-bound: agents summed 2h46m of work across a 4h09m span. Two causes: (1) the tail phase `impl-p9` bundled e2e-flow authoring + the server measurement test + the `RunReviewDropdown` retirement into one 40-min agent; (2) the largest slice `impl-p8` (page + 4 view components + i18n, 25 min / 92k out / 14.7M cache-read) ran as ONE implementer despite the plan pre-authorizing a split. The wave-balance gate did not trip because a concurrent backend sibling (Phase 5) masked the frontend median. Orchestrator-side friction (5 tool errors) came from `wsl.exe`-from-PowerShell quoting failures on the green-barrier script and the `git commit && git push` publish-gate wholesale-denial — both now captured in `.claude/agents/INSIGHTS.md`.

## Metrics

| agent | type (model) | depth→parent | in | out | cache-read | hit% | tools | err | dur |
|-------|--------------|--------------|----|-----|------------|------|-------|-----|-----|
| adeb88df | Explore | 1→orch | 18 | 10.1k | 427k | 85.3 | 28 | 0 | 158s |
| af82cc3d | Explore | 1→orch | 101 | 11.7k | 395k | 90.3 | 37 | 0 | 188s |
| aa8a4130 | Explore | 1→orch | 30 | 10.5k | 748k | 91.5 | 26 | 0 | 187s |
| a5828534 | researcher | 1→orch | 1.3k | 14.3k | 1.09M | 93.0 | 53 | 0 | 232s |
| a6cb1e8e | spec-creator | 1→orch | 8 | 15.1k | 332k | 75.0 | 15 | 0 | 490s |
| a5d33ccb | implementation-planner | 1→orch | 25 | 40.3k | 1.60M | 79.6 | 35 | 0 | 682s |
| impl-p1 | implementer | 1→orch | 29 | 11.2k | 840k | 92.4 | 21 | 1 | 185s |
| impl-p2 | implementer | 1→orch | 15 | 3.2k | 411k | 89.5 | 8 | 0 | 92s |
| impl-p3 | implementer | 1→orch | 32 | 22.8k | 1.46M | 93.0 | 22 | 0 | 454s |
| impl-p4 | implementer | 1→orch | 41 | 22.9k | 1.95M | 94.5 | 29 | 0 | 393s |
| impl-p5 | implementer | 1→orch | 66 | 51.3k | 4.98M | 96.2 | 53 | 1 | 903s |
| impl-p6 | implementer | 1→orch | 83 | 30.5k | 4.69M | 97.1 | 57 | 3 | 579s |
| impl-p7 | implementer | 1→orch | 69 | 26.6k | 3.19M | 96.5 | 58 | 1 | 507s |
| impl-p8 | implementer | 1→orch | 170 | 92.1k | 14.73M | 98.4 | 106 | 4 | 1507s |
| impl-p9 | implementer | 1→orch | 109 | 81.3k | 9.70M | 93.1 | 79 | 1 | 2433s |
| test-gap-pass | test-writer | 1→orch | 34 | 7.2k | 814k | 92.0 | 16 | 0 | 130s |
| arch-review | architecture-reviewer | 1→orch | 20 | 14.0k | 652k | 87.9 | 15 | 0 | 243s |
| plan-verify | plan-verifier | 1→orch | 35 | 26.2k | 2.35M | 92.5 | 48 | 0 | 395s |
| selfreview-client | general-purpose | 1→orch | 20 | 7.6k | 766k | 85.3 | 11 | 0 | 206s |
| **agents total** | 19 | — | 2.2k | **498.9k** | 51.1M | — | 717 | 11 | Σ 9963s |
| **orchestrator** | (whole session) | — | 184 | 171.4k | 26.2M | 98.3 | 82 | 5 | 15345s |
| **orch + agents** | — | — | **2.4k** | **670.2k** | **77.3M** | ~95.7 | 799 | 16 | — |

**Parallelism:** agents wall-clock 14,963s (4h09m) · Σ agent duration 9,963s (2h46m) · **parallel_factor 0.67** · max concurrent **4** (the 4 grounding scouts). No agent was resumed via `SendMessage`, so per-agent durations are clean (low skew); the sub-1.0 factor is real sequencing (waves + barriers + long-pole tails), not journal-idle artifact.

**Trend vs ledger:** largest feature run to date — 9 implementers vs the prior max of 6 (skill-eval-differential) — and the **only** run that also published (pr-self-review + client-lens + commit/push). Output 670k > agent-eval-pipeline 526k > skill-eval-differential 574k, tracking the 37-AC / 92-file size. `parallel_factor 0.67` matches the other large multi-wave run (agent-eval 0.72) and is below the small single-slice runs (~0.84–0.96) — big wave-structured runs are inherently more sequencing-bound.

## Insights → actions

1. **The tail phase (`impl-p9`, 40 min) bundled three independent deliverables.** e2e flows + the server measurement `.it.test` + the `RunReviewDropdown` retirement are file-disjoint (e2e/** vs server/test/** vs client deletion) and could run as parallel slices, but were one agent — it was the single longest journal and defined the run's tail. **Action:** in the plan's Phase 9 (run-plan Wave 3), split integration-test authoring, e2e-flow authoring, and dead-code retirement into separate disjoint slices; codify in `.claude/agents/implementation-planner.md` (Wave-3 decomposition) so the tail parallelizes.

2. **The wave-balance gate missed the largest frontend slice because a backend sibling masked the median.** `impl-p8` (4 tasks: page + ColumnsView + TabsView + ConflictsBlock + i18n) was >2× the frontend-wave median (Phase 7 = 1 task) and the plan PRE-AUTHORIZED a `_components`-subfolder split, but the gate computed the median across ALL concurrently-eligible phases (incl. backend Phase 5), so it didn't trip and I ran it as one 25-min implementer. **Action:** the run-plan wave-balance gate should compute the median **within a surface** (frontend phases vs frontend phases), not across the whole eligible set — and when a plan already carries an in-phase split recipe, execute it by default. Update `.claude/skills/run-plan/SKILL.md` (Pre-flight wave-balance gate).

3. **Even with a context pack, the top seam files were re-read by 8–9 agents each** — `run-executor.ts` ×9, `schema/runs.ts` ×9, `observability.ts` ×8, `grounding.ts` ×6. The CP lifted 5–15 line fragments; agents opened the full files anyway. Some are legitimate (impl-p3 edits run-executor; reviewers audit it), but implementers reading a seam only for its shape shouldn't. **Action:** for the 2–3 highest-fanout seams, the planner's context pack should carry the FULL relevant section (the whole `agent_runs`/`multi_agent_runs` schema block, the whole `MultiAgentRun`/`AgentColumn` contract), and each implementer spawn prompt should say "the CP block is authoritative for X — do not re-open unless you EDIT it." Reinforce the existing context-pack rule in `.claude/agents/implementation-planner.md`.

4. **Orchestrator friction was all command-construction, not model flailing** (5 orch errors): multi-statement `wsl.exe … bash -lc '…'` from PowerShell mangled the green-barrier script, and `git commit && git push` was denied wholesale by the publish gate (string-match), silently skipping the commit. **Action:** already captured — `.claude/agents/INSIGHTS.md` (write barrier scripts to a file + `sed 's/\r$//' | bash`; commit and push as separate calls) and the machine-local `wsl-exe-via-powershell` memory. No further code action.

5. **Cache + front-loaded decisions worked — keep doing them.** 98.3% orchestrator cache hit, single-pass spec+plan from one `AskUserQuestion` round (D1–D4 embedded as user-approved decisions), and frozen cross-wave contracts → zero drift, zero fix iterations. **Action:** none; this is the target pattern — note it as the positive control in the ledger.

## Notes
- Green barrier's one red (`reviews.it.test.ts` A2) was the documented cold-start/testcontainers-race flake — passed 2/2 in isolation; not this diff. Reconfirms the "re-run the failing file alone before triaging" barrier rule.
- Migration `0023` needs a manual `pnpm db:migrate` for the dev DB (testcontainers auto-apply for tests).
- AC-36 live 429 is a documented manual-verification leg (per-route rate-limit is a no-op under tests).
