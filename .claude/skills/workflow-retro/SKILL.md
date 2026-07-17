---
name: workflow-retro
description: "Post-run retrospective of the multi-agent SDD pipeline (spec-creator → implementation-planner → implementer / test-writer → architecture-reviewer / plan-verifier, plus nested researcher/Explore agents). Manually invoked after a run to produce TRUE token/tool/duration/parallelism metrics — deep mode parses session + subagent journals from disk because parent-visible usage EXCLUDES subagent tokens — plus insights with concrete optimization actions, a trend row appended to docs/retros/ledger.md, and an audit verdict. Trigger terms: workflow retro, retro, ретро, retrospective, pipeline metrics, agent token usage, cache hit, parallelism, як пройшов конвеєр."
---

# Workflow Retro

Retrospective of how a multi-agent pipeline run ACTUALLY went: metrics → insights →
concrete actions → trend ledger → audit verdict. Manual invocation only (no hook).

## Modes

- **deep (default)** — parse journals from disk with the bundled script. This is the only
  accurate source: a parent's `<usage>` does NOT include its subagents' tokens, so anything
  measured in-context undercounts the run (often by 5–10×).
- **in-context (fallback)** — only when journals are unavailable (other machine, cleaned up).
  Reconstruct what you can from the conversation and label every token figure
  "**lower bound — excludes subagent usage**". Never present in-context numbers as totals.

## Step 1 — collect metrics (deep)

1. Journals live in `~/.claude/projects/<slug>/` where `<slug>` = absolute repo path with
   every non-alphanumeric char replaced by `-`. The CURRENT session id is the UUID segment
   of your scratchpad path. Journals are on the HOST filesystem — run the script with host
   python, not inside WSL.
2. Run (from repo root; project dir auto-resolves from cwd):
   `python .claude/skills/workflow-retro/scripts/retro_metrics.py --session <uuid-or-prefix>`
   - retro of a past run → `--list` first (newest first, shows each session's agent types),
     pick the session whose `agent_types` match the pipeline, confirm with the user if ambiguous.
   - omitted `--session` → latest session that has subagent journals.
   - Redirect stdout to a scratchpad file and read that; don't dump raw JSON into the chat.
3. The JSON gives you per journal (orchestrator + each agent): usage (input / output /
   cache-read / cache-creation, deduped by `message.id`), `cache_hit_pct`, `api_turns`,
   `tool_calls_by_tool`, `tool_errors`, `skills_loaded`, `writes_paths`, start/end/duration,
   `parent` + `spawn_depth` (nesting tree); plus `totals`, `parallelism` (wall-clock,
   Σ agent time, parallel factor, max concurrent, timeline) and `duplicate_reads`
   (same file Read by several journals — context-duplication leads).

## Step 2 — analyze (qualitative)

The script gives leads; verify them by opening journals **selectively** (Grep/offset reads of
`<project-dir>/<session>/subagents/agent-<id>.jsonl`) — never read whole journals into context.

- `duplicate_reads` → files several agents each re-read = context-pack candidates
  (see the context-pack rule in [.claude/agents/INSIGHTS.md](../../agents/INSIGHTS.md)).
- `tool_errors > 0` → grep that journal for `is_error` neighborhoods; classify: environment
  quirk / brief gap / permission wall / model flailing.
- Low `cache_hit_pct` (< ~60 %) on a long agent → prompt churn; consider a stable shared prefix.
- `parallel_factor` ≈ 1 while plan slices were disjoint → orchestrator ran them serially;
  overlapping `writes_paths` between concurrent agents → slices were NOT disjoint.
- Stop-and-ask round-trips (implementation-planner pass-1 questions) → could the caller have
  passed the answers (spec path, execution mode) up front?
- Big `output_tokens` on a read-only agent → report bloat; tighten its output contract.
- Model/effort mismatch: haiku scouting is cheap; an opus agent doing mechanical Reads is not.

## Step 3 — report + ledger

1. Write the full retro to `docs/retros/<YYYY-MM-DD>-<short-slug>.md`:
   - **TL;DR verdict** — went well / went badly, one paragraph each.
   - **Metrics** — table: agent | type (model) | depth→parent | in | out | cache-read |
     hit % | tool calls | errors | duration; then totals row, orchestrator row, and the
     parallelism block. Note that orchestrator numbers cover the whole session.
   - **Insights → actions** — every insight MUST end in one concrete action:
     refine an agent brief (`.claude/agents/<agent>.md`), pre-fetch a shared file into the
     spawn-prompt context pack, merge/split agents, change concurrency, or change a
     `model`/`effort`/`skills:` frontmatter setting.
   - **Trend note** — compare against previous ledger rows (faster/slower, cheaper/dearer, why).
2. Append ONE row to `docs/retros/ledger.md` (create it with the header below if missing —
   check-before-create). Tokens = `totals.orchestrator_plus_agents`; wall/Σ/∥ from `parallelism`.
3. In chat: TL;DR verdict, the metrics table, top-3 actions. Reply in the user's language.
4. If a NON-OBVIOUS orchestration finding was confirmed, run the `engineering-insights`
   skill to append it to `.claude/agents/INSIGHTS.md`.

Ledger header (first line of a fresh `docs/retros/ledger.md`):

```markdown
# Pipeline run ledger

> One row per retro'd run; append-only. Tokens include orchestrator + ALL subagents.

| date | session | run | agents | in | out | cache-read | hit% | tools | err | wall | Σ agents | ∥max | factor | top action | report |
|------|---------|-----|--------|----|-----|------------|------|-------|-----|------|----------|------|--------|------------|--------|
```

Row example: `| 2026-07-04 | 9e4e3df5 | spec: PDF export | 3 (spec-creator+2×Explore) | 29.1k | 67.1k | 3.40M | 88% | 115 | 3 | 8m42s | 11m39s | 3 | 1.34 | pre-fetch shared UI files | [retro](2026-07-04-spec-pdf-export.md) |`

## Journal schema gotchas (verified 2026-07-04)

- A streamed assistant turn = SEVERAL jsonl lines sharing one `message.id` with CUMULATIVE
  usage; the script dedupes (per-field max per id). Never sum raw lines yourself.
- The parent-side `Agent` toolUseResult records only `agentId`/`status`/`resolvedModel` —
  no token totals. Subagent journals are the only usage source.
- `subagents/agent-<id>.meta.json` = `{agentType, description, name?, toolUseId, spawnDepth}`;
  nested agents (depth ≥ 2) sit FLAT in the same session's `subagents/`, parented by finding
  which journal contains the `tool_use` block with that `toolUseId` (the script does this).
- Journals are UTF-8; PowerShell `Get-Content` default encoding mangles Cyrillic — use the
  script or explicit UTF-8 reads.
- `duration_s` = first→last journal line. An agent resumed via `SendMessage` keeps ONE
  journal, so its duration INCLUDES the idle gap between passes (a "146m" implementer was
  ≈25m of work + ~2h idle) — treat `sum_agent_duration_s` and `parallel_factor` as skewed
  bounds whenever any agent was resumed, and say so in the report.
