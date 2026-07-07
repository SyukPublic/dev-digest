# Measuring a Pipeline Run with the `workflow-retro` Skill

> **Scope:** this manual is for the human operator. It covers when and how to
> run a retrospective over a finished multi-agent pipeline run (spec-creator →
> implementation-planner → implementer / test-writer → architecture-reviewer ∥
> plan-verifier, plus nested researcher/Explore agents), what the numbers mean,
> and where the results land. The retro playbook itself lives in
> [.claude/skills/workflow-retro/SKILL.md](../../.claude/skills/workflow-retro/SKILL.md)
> and is loaded by the model — you never need to read it to use the skill.
>
> **Short version:** right after a run (same chat) say `/workflow-retro` — or
> "зроби ретро прогону". For a past run: `/workflow-retro` + name the session,
> or let it list candidates. Results: a report in `docs/retros/`, a trend row
> in [docs/retros/ledger.md](../retros/ledger.md), and a verdict in chat.

---

## Table of contents

1. [What a retro gives you](#1-what-a-retro-gives-you)
2. [Why "deep mode" exists (the undercount problem)](#2-why-deep-mode-exists-the-undercount-problem)
3. [Prerequisites](#3-prerequisites)
4. [Invocation](#4-invocation)
5. [What happens during a retro](#5-what-happens-during-a-retro)
6. [Reading the numbers](#6-reading-the-numbers)
7. [Using the metrics script standalone](#7-using-the-metrics-script-standalone)
8. [Troubleshooting](#8-troubleshooting)
9. [References](#9-references)

---

## 1. What a retro gives you

Four outputs per run:

1. **Metrics** — per-agent tokens (input / output / cache-read / cache-creation),
   cache-hit %, tool calls by tool, tool errors, durations, the nesting tree
   (who spawned whom), and parallelism (wall-clock vs Σ agent time, parallel
   factor, max concurrent).
2. **Insights → actions** — what was hard, what got duplicated across agent
   contexts, what was missed; every insight ends in one concrete action
   (refine an agent brief, pre-fetch a shared file into the context pack,
   merge/split agents/phases, change concurrency / model / effort).
3. **Trend** — one appended row in [docs/retros/ledger.md](../retros/ledger.md)
   so runs stay comparable over time; the full report goes to
   `docs/retros/<YYYY-MM-DD>-<slug>.md`.
4. **Audit verdict** — an honest "went well / went badly" TL;DR in chat.

For a complete real example see
[docs/retros/2026-07-04-project-context-folder.md](../retros/2026-07-04-project-context-folder.md)
(18 subagents, 3 waves, 92.7M cache-read tokens).

## 2. Why "deep mode" exists (the undercount problem)

A parent agent's visible `<usage>` **excludes** its subagents' tokens, and the
parent-side record of an `Agent` call carries no totals either. Anything
measured "from inside the conversation" therefore undercounts a pipeline run —
typically by 5–10×. Deep mode (the default) instead parses the session journals
Claude Code writes to disk:

```
~/.claude/projects/<slug>/<session-id>.jsonl            ← orchestrator
~/.claude/projects/<slug>/<session-id>/subagents/       ← one journal + meta per agent
```

`<slug>` is the absolute repo path with every non-alphanumeric character
replaced by `-`. The skill falls back to **in-context mode** only when the
journals are unreachable (retro on another machine, journals cleaned up), and
then labels every token figure as a lower bound.

## 3. Prerequisites

- **A finished (or at least paused) pipeline run** — the retro measures what is
  in the journals at the moment it runs.
- **Journals on this machine.** Retro must run where the pipeline ran: journals
  live under the host's `~/.claude/projects/`, they do not travel with the repo.
- **Host python 3.9+ on PATH.** The bundled parser is stdlib-only. Note for this
  repo's WSL setup: journals are on the **Windows host**, so the script runs
  with Windows python — not inside the WSL distro.

## 4. Invocation

```
/workflow-retro
```

or in natural language: *"зроби ретро цього прогону"*, *"як пройшов конвеєр?"*,
*"workflow retro"*, *"скільки токенів з'їв конвеєр?"*.

Three addressing modes:

- **Same chat as the run (recommended).** No arguments needed — the current
  session is the run's session.
- **Past run.** Name it if you know it (session UUID or its prefix, e.g.
  `/workflow-retro session a764c5c2`); otherwise the skill lists recent
  sessions with their agent types (newest first) and asks you to pick the one
  matching the pipeline.
- **Different machine / journals gone.** Say so explicitly — the skill drops to
  in-context mode and marks all totals "lower bound".

## 5. What happens during a retro

1. **Locate** — resolve the journal directory and session (see §2).
2. **Parse** — run `scripts/retro_metrics.py`, which emits one compact JSON
   (per-agent metrics, totals, nesting tree, parallelism timeline, cross-agent
   duplicate file reads). Raw journals are never dumped into the chat.
3. **Analyze** — the model follows the leads qualitatively: opens journal
   fragments selectively around tool errors, checks stop-and-ask round-trips,
   compares `writes_paths` of concurrent agents, etc.
4. **Write** — full report to `docs/retros/<date>-<slug>.md` (TL;DR, metrics
   table, insights→actions, trend note) and one appended ledger row.
5. **Report in chat** — TL;DR verdict, the metrics table, top-3 actions.
6. **Feed back** — a confirmed non-obvious orchestration finding goes to
   `.claude/agents/INSIGHTS.md` via the `engineering-insights` skill; action
   items typically edit agent briefs (`.claude/agents/*.md`) or the `run-plan`
   spawn templates — with your approval, as separate follow-ups.

The skill only writes under `docs/retros/` (+ optional INSIGHTS entries). It
never commits or pushes; publishing the retro goes through the usual
"коміть і пуш" → `pr-self-review` flow.

## 6. Reading the numbers

| Signal | Healthy | Worth acting on |
|---|---|---|
| `cache_hit_pct` per agent | ≳ 85 % on long agents | < ~60 % → prompt churn, no stable prefix |
| `parallel_factor` (Σ agent time / wall-clock) | grows with wave width | ≈ 1 with disjoint phases → run was serialized |
| `max_concurrent` | ≈ planned wave width | far below plan → orchestrator under-fanned |
| `duplicate_reads` | few, small files | same file read by 3+ agents → context-pack candidate |
| `tool_errors` | one-offs | repeats of one kind → environment quirk or brief gap |
| `output_tokens` of read-only agents | small report | tens of k → report bloat, tighten output contract |

Caveats the report itself will flag (don't re-derive them the hard way):

- **Resumed agents skew durations.** An agent continued via `SendMessage` keeps
  ONE journal, so its `duration_s` (first→last line) includes the idle gap
  between passes — in the first measured run an implementer showed "146m" that
  was ≈25m of actual work. Whenever any agent was resumed, Σ agent time and the
  parallel factor are bounds, not exact values.
- **The orchestrator row covers the whole session**, including turns before and
  after the pipeline (interviews, commits, chat) — don't read it as pipeline
  cost alone.
- **In-context mode numbers are lower bounds** — never compare them against
  deep-mode ledger rows.

## 7. Using the metrics script standalone

The parser is usable without the skill (CI, manual digging):

```bash
# from the repo root — the project journal dir auto-resolves from cwd
python .claude/skills/workflow-retro/scripts/retro_metrics.py --list
python .claude/skills/workflow-retro/scripts/retro_metrics.py --session a764c5c2 > run.json
```

- `--list` — sessions newest-first with subagent counts and agent types (pick
  the row whose `agent_types` match the pipeline).
- `--session <uuid-or-prefix>` — analyze that session; omitted → the latest
  session that has subagent journals.
- `--project-dir <path>` — override journal-dir resolution (e.g. analyzing a
  copy of journals from elsewhere).

Output is one JSON document on stdout (UTF-8): `orchestrator` + `agents[]`
(usage deduped per `message.id`, `cache_hit_pct`, `tool_calls_by_tool`,
`tool_errors`, `skills_loaded`, `writes_paths`, `parent`/`spawn_depth`),
`totals`, `parallelism` (incl. a start/end timeline per agent) and
`duplicate_reads`.

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `no session with subagent journals found` | The pipeline ran in another session/machine, or agents never spawned — use `--list`, or check you are in the right repo (slug is cwd-derived). |
| `project journal dir not found` | cwd differs from where the run happened (slug mismatch) → pass `--project-dir`. |
| Mojibake in descriptions/prompts | Journals are UTF-8; PowerShell `Get-Content` mangles Cyrillic by default. The script already forces UTF-8 — read its output, not raw journals. |
| Token totals look absurdly large vs chat expectations | That's the point (§2): cache-read counts every request's cached prefix; compare runs against ledger rows, not gut feeling. |
| Durations look impossible | See the resumed-agent caveat in §6. |

## 9. References

- Playbook: [.claude/skills/workflow-retro/SKILL.md](../../.claude/skills/workflow-retro/SKILL.md)
  (incl. journal schema gotchas the parser depends on).
- Parser: [.claude/skills/workflow-retro/scripts/retro_metrics.py](../../.claude/skills/workflow-retro/scripts/retro_metrics.py).
- Trend ledger: [docs/retros/ledger.md](../retros/ledger.md).
- Example retro: [docs/retros/2026-07-04-project-context-folder.md](../retros/2026-07-04-project-context-folder.md).
- Running the pipeline itself: [run-plan-usage.md](./run-plan-usage.md) — its §6
  points here after every run.
