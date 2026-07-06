# Retro — In-diff deep-links for brief risk refs (2026-07-06, session c531ed06)

> Deep-mode metrics parsed from disk journals (orchestrator + 6 subagents);
> parent-visible usage excludes subagents, so all totals below come from the
> per-journal parse. Full pipeline: research → 4 user decisions → spec-creator →
> implementation-planner → run-plan (implementer → test-writer gap pass → green
> barrier → arch-review ∥ plan-verifier) → commit/push → pr-self-review → PR #12.

## TL;DR verdict

**Went well.** The cheapest and fastest full-SDD feature run in the ledger to date:
6 agents, 59.3k in / 197.2k out, agents-wall 40m43s, zero fix-loop iterations,
12/12 ACs IMPLEMENTED on the first verify, 0 CRITICAL/HIGH from review. Two
levers did it: (1) the feature was born from a deep pre-pipeline research
conversation, so the orchestrator embedded VERIFIED file:line facts into every
spawn prompt (agents barely wandered — the implementer landed 15 tasks with 85
tool calls and 0 errors); (2) all four blocking decisions (English requirements,
query-param transport, scroll strategy, exec mode) were resolved via ONE
AskUserQuestion round BEFORE spawning spec-creator — both the spec-creator
interview round-trip and the planner's stop-and-ask were eliminated entirely.

**Went badly (minor).** Nothing structural. Three trivial agent tool errors
(vitest CLI filter vs `[repoId]` bracketed dir; a `Read` with empty `pages`; MCP
`get_conventions` called with `dev-digest` instead of `SyukPublic/dev-digest`).
Orchestrator-side green-barrier friction cost two extra command cycles:
`test-mirror.sh` launched from Windows Git Bash (no `rsync` — it must run inside
WSL) and `$VAR`-interpolated exit-code markers expanding empty through
`wsl.exe -- bash -lc` (both now captured in machine-local memory, not repo docs).

## Metrics

| agent | type (model) | depth→parent | in | out | cache-read | hit% | tools | err | duration |
|---|---|---|---|---|---|---|---|---|---|
| spec-creator | spec-creator (opus-4-8) | 1→orch | 9.3k | 18.7k | 683.0k | 87.1% | 20 | 1 | 4m32s |
| planner | implementation-planner (opus-4-8) | 1→orch | 9.3k | 13.2k | 599.6k | 82.3% | 16 | 0 | 3m20s |
| impl-p1-5 | implementer (opus-4-8) | 1→orch | 7.2k | 57.7k | 12.63M | 98.2% | 85 | 0 | 15m32s |
| test-gap-pass | test-writer (sonnet-5) | 1→orch | 5.9k | 13.4k | 3.38M | 94.7% | 34 | 1 | 5m23s |
| arch-review | architecture-reviewer (opus-4-8) | 1→orch | 7.0k | 8.4k | 624.2k | 88.2% | 22 | 1 | 2m35s |
| plan-verify | plan-verifier (opus-4-8) | 1→orch | 5.7k | 8.6k | 1.06M | 88.1% | 25 | 0 | 2m44s |
| **agents total** | 6 | — | **44.3k** | **120.0k** | **18.98M** | — | **202** | **3** | **Σ 34m05s** |
| orchestrator | fable-5 (whole session) | 0 | 15.0k | 77.2k | 11.86M | 96.3% | 80 | 0 | 1h36m56s |
| **orch + agents** | — | — | **59.3k** | **197.2k** | **30.84M** | ~95.9% | 282 | 3 | — |

Orchestrator numbers cover the WHOLE session (pre-pipeline grounding research on
brief risk refs, the SDD pipeline, publish via pr-self-review, insights sweep) —
not only the pipeline. No agent was resumed via `SendMessage`, so durations are
clean (no idle-gap skew).

**Parallelism:** agents wall-clock 40m43s, Σ agent time 34m05s, parallel factor
0.84, max concurrent 2 (arch-review ∥ plan-verify). Expected shape for
single-agent mode: spec → plan → impl → test-gap are dependency-ordered; the only
designed parallelism is Stage 4. The <1 factor reflects orchestrator work between
agents (green barrier, triage) — not lost concurrency.

**Tool errors (all trivial, all self-recovered):**
- test-writer: vitest CLI filter choked once on the `[repoId]` bracketed route
  dir; re-ran with an adjusted filter.
- arch-review: one `Read` with `pages: ""` (model slip, retried correctly).
- spec-creator: MCP `devdigest_get_conventions` first called with `dev-digest`;
  needs the full `owner/name` (`SyukPublic/dev-digest`) — retry succeeded.

**Duplicate reads (leads, not losses):** spec/plan files read by 4 agents each —
that IS the contract, not waste. `SmartDiffViewer.tsx` read 12× across 6 journals
(5× by the implementer editing it — offset reads of a large file). The four
surface files (IntentCard, ReviewFocusSection, DiffTab, page.tsx) were each
re-read once per agent despite context-pack fragments — expected for write/verify
mandates; the pack shrank wandering (agents went straight to the right lines)
rather than eliminating reads.

## Insights → actions

1. **Front-loading ALL blocking decisions kills both SDD round-trips.** One
   AskUserQuestion round (EN requirements approval + transport + scroll strategy
   + exec mode) before spec-creator meant: spec-creator produced a FINAL approved
   spec in one pass (zero `[NEEDS CLARIFICATION]`), and the planner never
   stop-and-asked. Compare: earlier runs paid interview round-trips for exactly
   these. → **Action:** captured in `.claude/agents/INSIGHTS.md` — when a feature
   emerges from a research conversation, resolve design decisions with the user
   BEFORE spawning spec-creator, then pass them as "user-approved decisions".
2. **Research-warm orchestrator = cheap pipeline.** The pre-pipeline grounding
   investigation produced verified file:line facts that went verbatim into every
   spawn prompt; the implementer (15 tasks, 6 files + 5 test files) needed just
   85 tool calls / 0 errors / 98.2% cache. → **Action:** none new — this is the
   existing context-pack rule working as designed; keep doing it.
3. **MCP-enabled agents need the full repo id.** spec-creator's first
   `devdigest_get_conventions` call failed with a bare `dev-digest`. → **Action:**
   when spawning spec-creator (or any MCP-consuming agent), state the repo as
   `SyukPublic/dev-digest` in the prompt.
4. **Green-barrier shell friction (machine-local).** Two wasted cycles:
   `test-mirror.sh` requires WSL (Windows Git Bash lacks `rsync`), and saved-var
   interpolation (`X=$?; echo "M:$X"`) expands empty through
   `wsl.exe -- bash -lc` — use `if cmd; then echo OK; else echo FAIL; fi`.
   → **Action:** already appended to auto-memory `wsl-verification-setup`
   (machine-local, not a repo concern).

## Trend note

Fourth single-agent run in the ledger. vs `2026-07-06 brief-onboarding-ui`
(closest analog: same 6-agent shape): tokens 59.3k/197.2k vs 70.0k/214.4k,
cache-read 30.84M vs 42.18M, tools 282 vs 393, err 3 vs 6 — cheaper on every
axis. vs the multi-agent feature runs (why-risk-brief 152k/422k, onboarding
192k/459k): a ~2.5× token reduction for a comparable spec→publish scope, at the
cost of no implementation parallelism (fine here — 5 dependent phases, one
package). Single-agent + front-loaded decisions + research-warm context pack is
now the demonstrated cheapest shape for a contained, single-package feature.
