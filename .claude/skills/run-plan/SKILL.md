---
name: run-plan
description: >-
  Executes an APPROVED Development Plan (docs/plans/*.md) through the DevDigest
  implementation pipeline: implementer wave(s) → test-writer gap pass → green
  barrier (tests + typecheck) → architecture-reviewer ∥ plan-verifier → bounded
  fix loop (max 2 iterations) → final report. HARD GATE: an existing plan file
  is a required input — no plan, no run. Unlike implementer (ships ONE slice) —
  this skill orchestrates the WHOLE plan across agents; unlike workflow-retro
  (measures a PAST run) — this skill performs the run; unlike pr-self-review
  (pre-publish diff audit) — this skill implements and verifies, it never
  publishes. Trigger terms: run-plan, run the plan, execute the plan, run the
  implementation pipeline, запусти план, запусти конвеєр, виконай план,
  прожени план через конвеєр.
---

# Run Plan — implementation pipeline orchestrator

Drive one approved Development Plan end-to-end with subagents:

```
Gate → Pre-flight → implementer wave(s) → test-writer gap pass
     → green barrier → architecture-reviewer ∥ plan-verifier
     → triage → fix loop (≤2 iterations) → wrap-up report
```

The main session is the orchestrator: it spawns agents via the `Agent` tool
(parallel calls in ONE message when independent), continues them via
`SendMessage`, tracks stages with `TodoWrite`, and never implements code
itself. Spawn-prompt templates live in
[references/spawn-prompts.md](references/spawn-prompts.md) — use them verbatim,
filling the `{{placeholders}}`.

## Inputs

- **Plan path (REQUIRED)** — `docs/plans/<feature>.md`, produced by
  `implementation-planner`.
- **Additional prompt (optional)** — extra requirements/constraints given in
  the invocation or the chat.
- **Design sources (optional)** — descriptions or images attached to the chat.

## Gate 0 — plan gate (blocking; no plan → no run)

1. **No path given, or the file does not exist → STOP.** Report the blocker and
   list `docs/plans/*.md` candidates as a hint. Never guess which plan was
   meant, never run without one.
2. **Validate structure.** The file must contain: `Execution mode`, `## Tasks`
   with task lines shaped `- [ ] T<n> … → AC-… → test_…`, and a
   `## Traceability matrix`. Invalid → STOP; advise re-running
   `implementation-planner`.
3. **Approval proxy.** Plans carry no Status field: an explicitly passed path +
   no open BLOCKING questions inside the plan counts as approved. Blocking open
   questions found → STOP and surface them.

## Pre-flight

1. **Clean tree check.** Run `git status` (git runs on Windows — see
   CLAUDE.local.md). A dirty working tree → STOP and ask: reviewers audit the
   uncommitted diff, so a dirty baseline poisons both the review and any later
   retro. Record the baseline `HEAD` sha.
2. **Read the plan fully.** Extract: execution mode, phases with
   `depends on:` / `parallel-safe` markers, per-phase `Disjoint scope`,
   `Shared scaffold (context pack)`, the traceability matrix (RTM).
3. **Build the dependency graph + initial waves** (multi-agent mode):
   topologically order phases by `depends on:`; phases with satisfied
   dependencies that are `parallel-safe` with each other form one wave. Waves
   are the INITIAL schedule, not a synchronization barrier — launch is eager
   (see Stage 1). Single-agent mode: one implementer executes the whole plan
   top-to-bottom (no waves, no test-writer partitioning changes — the rest of
   the pipeline is identical).
4. **Wave-balance gate (multi-agent, BEFORE any spawn).** Estimate each
   phase's relative size (task count + Disjoint-scope file count). Largest
   phase in a wave >2× the median of its wave siblings → do NOT spawn: send
   the plan back for a split — spawn `implementation-planner` with a revision
   request naming the oversized phase (template 7), re-read the revised plan,
   rebuild waves. (Retro 2026-07-05: P5 was splittable into PrBriefCard vs
   ReviewFocus+wiring with zero file overlap.)
5. **Design brief.** Subagents CANNOT see chat attachments. If designs/images
   were provided, verbalize them NOW into a textual Design brief (layout,
   components, states, exact copy, colors/spacing where relevant) and embed it
   in every spawn prompt that needs it. Never write "see the attached image".
6. **Ownership map.** Record phase → `Disjoint scope` files. The fix loop
   routes findings by this map.
7. `TodoWrite`: one todo per stage + one per phase.

## Stage 1 — implementation waves

Per wave, spawn one `implementer` per phase — all in ONE message, named
`impl-p<N>` (names keep journals readable for `workflow-retro`). Use the
implementer template (embeds: plan path + phase, context pack VERBATIM,
additional prompt, Design brief, disjoint-scope reminder).

- **Eager launch (waves are not a barrier):** a phase starts the moment EVERY
  phase in its `depends on:` has reported done — spawn it immediately, even if
  other phases of the previous wave are still running. The only true barrier
  is Stage 2: the test-writer gap pass waits for ALL phases to finish.
- `Status: blocked` in a report → resolve if the orchestrator can (e.g. missing
  info available in chat), else STOP and surface. Do not start the next wave on
  top of a blocked dependency.
- Implementers do NOT tick plan checkboxes and do NOT commit — that is by
  design; the orchestrator ticks at wrap-up.

## Stage 2 — test-writer gap pass

After the LAST phase completes, spawn ONE `test-writer` (template: gap pass). Scope: audit
the RTM `Test` column against tests that actually exist on disk; write ONLY the
missing/thin ones. It must not rewrite healthy tests the implementers already
added. Production-code follow-ups it reports are routed to the fix loop, not
fixed by it.

## Stage 3 — green barrier

Orchestrator runs the affected packages' `pnpm test` + typecheck in the dev
environment described in CLAUDE.local.md, and OBEYS any local barrier
constraints it declares (suite ordering/parallelism, exit-code capture) — on
this machine: WSL; tests never run in the Windows shell. Red → `SendMessage` the failure output to the implementer
that owns the failing files (ownership map); re-run; repeat until green. Only a
green suite proceeds to review — reviewing red code wastes the reviewers.

## Stage 4 — review (parallel, read-only)

Spawn BOTH in one message:

- `architecture-reviewer` — scope: all uncommitted changes vs the baseline sha
  (`git diff` + untracked files).
- `plan-verifier` — the plan path; audits requirement coverage, returns the RTM
  with verdicts.

## Stage 5 — triage & fix loop (max 2 iterations)

Aggregate both reports and triage each finding:

| Finding | Action |
|---|---|
| Arch CRITICAL / HIGH | must fix → implementer |
| RTM MISSING / DIVERGENT (Critical/Major) | must fix → implementer |
| RTM PARTIAL — Major | must fix → implementer |
| RTM PARTIAL — Minor | follow-up in the final report |
| Arch MEDIUM / LOW | follow-up (tech-debt candidate); do NOT iterate on these |
| AMBIGUOUS-IN-SPEC | never "fix" code — surface to the user / spec-creator |
| Test gap (RTM Test column uncovered) | → test-writer |

If any "must fix" findings remain, run a fix iteration:

1. **Group findings by ownership** (ownership map). Per group, prefer
   `SendMessage` to the wave implementer that owns those files (context is
   still warm); spawn a fresh `implementer` fixer only when ownership is mixed
   or the original agent is gone. Pass findings VERBATIM including the
   `file:line` evidence — never paraphrase away the evidence.
2. Disjoint groups run in parallel; overlapping groups run sequentially.
3. Re-run the green barrier (Stage 3) on affected packages.
4. **Re-verify the delta only:** `SendMessage` the SAME reviewer agent(s):
   "re-check findings #…, #… against the new diff" — never a fresh full audit.
5. Loop back to triage.

**Convergence guards (both mandatory):**
- Hard cap: **2 fix iterations**. Exhausted with blockers remaining → STOP and
  report the leftovers honestly; the user decides.
- No-progress guard: an iteration that does not reduce the must-fix count →
  STOP early and escalate (something is contested or the plan has a gap —
  a human call, not a third pass).

## Stage 6 — wrap-up

1. **Tick the plan.** For every task whose ACs the plan-verifier judged
   `IMPLEMENTED` (map via RTM), flip `- [ ]` → `- [x]` in the plan file. Leave
   the Commit column untouched (commits do not exist yet).
2. **Final report** (in the user's language):

```markdown
## Run-plan report — <feature>

**Plan:** docs/plans/<feature>.md · **Mode:** multi-agent | single-agent
**Outcome:** clean | clean-with-follow-ups | stopped (iteration cap / no progress / blocked)

### Phases
| Phase | Agent | Status | Files |
### Tests
<final suite command(s) + result>
### Architecture verdict
<executive summary + counts by severity; unresolved findings verbatim>
### Requirement coverage
<coverage summary; unresolved MISSING/PARTIAL/DIVERGENT/AMBIGUOUS verbatim>
### Fix iterations
<per iteration: findings addressed → re-verify outcome>
### Follow-ups for the user
- migrations needed? (`cd server && pnpm db:migrate` is MANUAL)
- deferred minor/tech-debt findings
- AMBIGUOUS-IN-SPEC items → spec-creator
### Suggested next steps
- review the diff → `pr-self-review` before any push/PR
- optionally `workflow-retro` to measure this run
```

3. Never commit, push, or open a PR from this skill — publishing is
   `pr-self-review`'s gate, on the user's explicit ask.
4. Confirmed a non-obvious orchestration finding? → `engineering-insights`
   (targets `.claude/agents/INSIGHTS.md`).

## Hard rules (recap)

- No plan file → blocker. Dirty tree → blocker (ask). Blocked phase → stop.
- Tests/typecheck run in the dev environment per CLAUDE.local.md; git runs on
  Windows. Migrations are MANUAL — only ever flagged, never run.
- The orchestrator writes ONLY: plan checkboxes at wrap-up, todos, the report.
  All code/test writes belong to subagents.
- Reply language: the user's language (per AGENTS.md); spawn prompts stay
  English, but tell each agent which language to report in.
