# Running an Approved Plan with the `run-plan` Skill

> **Scope:** this manual is for the human operator. It covers how to launch the
> implementation pipeline (`implementer` → `test-writer` →
> `architecture-reviewer` ∥ `plan-verifier` → fix loop) over an approved
> Development Plan, what to expect while it runs, and what remains your job
> afterwards. The orchestration playbook itself lives in
> [.claude/skills/run-plan/SKILL.md](../../.claude/skills/run-plan/SKILL.md)
> and is loaded by the model — you never need to read it to use the skill.
>
> **Short version:** `/run-plan docs/plans/<feature>.md` — or, right after
> `implementation-planner` finished in the same chat, just say
> "запусти план" / "run the plan".

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Invocation](#2-invocation)
3. [What happens during a run](#3-what-happens-during-a-run)
4. [Use case: "запусти план" right after implementation-planner](#4-use-case-запусти-план-right-after-implementation-planner)
5. [When the run blocks (by design)](#5-when-the-run-blocks-by-design)
6. [After the run — your steps](#6-after-the-run--your-steps)
7. [Tuning](#7-tuning)

---

## 1. Prerequisites

- **An approved plan file** in `docs/plans/<feature>.md`, produced by the
  `implementation-planner` agent — it must carry an `Execution mode`, task
  lines shaped `- [ ] T<n> … → AC-… → test_…`, and a `Traceability matrix`.
  A missing or malformed plan is a hard blocker: the skill stops instead of
  guessing.
- **A clean git working tree.** Reviewers audit the uncommitted diff produced
  by the run, so a dirty baseline would poison the review. Commit or stash
  first.

## 2. Invocation

```
/run-plan docs/plans/<feature>.md
```

or in natural language: *"запусти конвеєр по плану docs/plans/smart-diff.md"*,
*"run the plan docs/plans/smart-diff.md"*.

In the **same message** you may add:

- **Additional prompt** — extra requirements or constraints on top of the plan
  (they are embedded into every implementer's brief).
- **Design images / descriptions** — attach them to the chat. Subagents cannot
  see chat attachments, so the orchestrator first verbalizes them into a
  textual *Design brief* and embeds that into the spawn prompts. If the visual
  details matter (exact copy, states, spacing), attaching them here is the
  only way they reach the implementers.

## 3. What happens during a run

1. **Gate** — plan exists and is structurally valid; clean tree; otherwise the
   run stops immediately.
2. **Pre-flight** — baseline commit recorded, phases ordered into waves by
   `depends on:`, phase → files ownership map built.
3. **Implementer waves** — one `implementer` per disjoint phase, parallel
   within a wave (`Execution mode: single-agent` → one implementer works the
   plan top-to-bottom instead).
4. **test-writer gap pass** — audits the Traceability matrix `Test` column
   against tests actually on disk and writes only the missing ones.
5. **Green barrier** — affected packages' `pnpm test` + typecheck; failures go
   back to the owning implementer until green.
6. **Review** — `architecture-reviewer` and `plan-verifier` run in parallel
   over the uncommitted changes.
7. **Fix loop** — must-fix findings (arch CRITICAL/HIGH; RTM
   MISSING/DIVERGENT/PARTIAL-major) are routed back to the owning implementer;
   re-verification covers only the delta. Hard cap: **2 iterations**, plus a
   no-progress guard — the loop cannot spin forever.
8. **Wrap-up** — final report (phases, tests, verdicts, leftover findings,
   follow-ups such as pending manual migrations); completed tasks get their
   checkboxes ticked in the plan file.

## 4. Use case: "запусти план" right after implementation-planner

The recommended flow is to chain the two in **one chat**:

1. You ask for a plan; `implementation-planner` finishes and reports the plan
   path (`docs/plans/<feature>.md`).
2. You reply with nothing more than:

   > запусти план / виконай план / запусти цей план на імплементацію /
   > run the plan

That works without repeating the path: the plan path is **unambiguously known
from the planner's report in the same conversation**, so resolving "цей план"
is a context lookup, not a guess — the "no plan → no run" gate is satisfied.
Your "запусти" message itself counts as the plan's approval (the approval
proxy: an explicitly designated plan + no open blocking questions).

Two edge cases where the gate will still stop you:

- **The planner stopped at pass 1 (stop-and-ask).** It returned blocking
  questions instead of writing the plan — there is no file yet. Answer the
  questions first (including the execution mode: multi-agent vs single-agent);
  once the planner writes the plan, "запусти план" proceeds.
- **A fresh chat with no context.** "Запусти цей план" points at nothing — the
  skill lists the `docs/plans/*.md` candidates and stops. Name the file:
  `/run-plan docs/plans/<feature>.md`.

## 5. When the run blocks (by design)

| Situation | Behaviour |
|---|---|
| No plan path resolvable / file missing | Stop; candidates from `docs/plans/` listed as a hint |
| Plan missing `Execution mode` / tasks / RTM | Stop; re-run `implementation-planner` |
| Dirty working tree | Stop and ask |
| A phase reports `Status: blocked` | Stop before dependent waves; blocker surfaced |
| Fix-loop cap reached / no progress | Stop; leftover findings reported honestly — your call |
| `AMBIGUOUS-IN-SPEC` findings | Never "fixed" in code; routed to you / `spec-creator` |

## 6. After the run — your steps

The skill **never** commits, pushes, opens PRs, or runs migrations. The
working tree holds the uncommitted result. Typically:

1. Review the diff yourself.
2. If flagged in the report: run the manual migration
   (`cd server && pnpm db:migrate`).
3. Say "коміть і пуш" — publishing goes through the `pr-self-review` gate as
   usual.
4. Optionally run `/workflow-retro` to measure the run (tokens, parallelism,
   duplicate reads) — its actions feed back into agent briefs and this skill.
   See [workflow-retro-usage.md](./workflow-retro-usage.md).

## 7. Tuning

The fix-loop cap (2 iterations) and the triage table live in
[.claude/skills/run-plan/SKILL.md](../../.claude/skills/run-plan/SKILL.md);
spawn-prompt templates in
[.claude/skills/run-plan/references/spawn-prompts.md](../../.claude/skills/run-plan/references/spawn-prompts.md).
Revisit the cap after the first few measured runs (`workflow-retro` ledger
shows whether 2 iterations converge in practice).
