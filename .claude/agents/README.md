# DevDigest subagents

Project-local Claude Code subagents for the DevDigest repo. Each `*.md` file in
this folder defines one subagent: YAML frontmatter (`name`, `description`,
`tools`, `model`, optional `skills`) plus a system-prompt body. Claude delegates
to an agent based on its `description`; you can also invoke one explicitly by
name.

> Authoring note: the agent `*.md` files are written entirely in English (their
> "Reply language" section still makes each agent answer in the user's language).
> This README documents them; it is not loaded into any agent's context.

> Lessons log: non-obvious gotchas and "why it's like this" decisions about THIS
> agent layer (definitions + orchestration) live in [INSIGHTS.md](./INSIGHTS.md) —
> read it before changing an agent definition or how agents are orchestrated, and
> append to it via the `engineering-insights` skill. It is the agent meta-layer log,
> distinct from the four package `INSIGHTS.md` files (which cover product code).

## Agents at a glance

| Agent | Model | Context window (this harness) | Writes | Purpose |
|---|---|---|---|---|
| [`researcher`](./researcher.md) | sonnet | 200K | nothing (read-only) | Find info inside the project OR on the web; return a strictly structured report |
| [`implementation-planner`](./implementation-planner.md) | opus | 1M | `docs/specs/<feature>.md` only | Turn a request into a phased, parallelizable Development Plan |
| [`implementer`](./implementer.md) | sonnet | 200K | source/tests in its assigned slice | Ship code for one disjoint plan phase (UI or backend), tests to green |

The planner → implementer pair is a pipeline: the planner produces a spec whose
phases are split into **disjoint, parallelizable slices**, then one or more
implementers each take a slice and ship it.

## Shared design decisions

These conventions are baked into the two agents created in this session
(`implementation-planner`, `implementer`):

- **Per-model context windows (verified in this harness).** Sonnet 4.6 runs in a
  **200K** window here; Opus 4.8 runs in a **1M** window. Budgeting is done
  against the actual per-model window, not the model's catalog maximum.
- **Hybrid skill loading.** Only always-on skills are preloaded via the `skills:`
  frontmatter (`onion-architecture`, `typescript-expert`, `security`). Everything
  in `skills:` is injected at startup, so surface-specific skills are NOT listed
  there — the agent invokes them on demand with the `Skill` tool when it touches
  that surface. This keeps the Sonnet implementer's 200K window lean while still
  applying every relevant practice.
- **Surface → skill map.** The mapping is taken 1:1 from the project's
  [`pr-self-review`](../skills/pr-self-review) skill so conventions don't drift:
  | Surface | Skills |
  |---|---|
  | `client/**` (UI) | `react-frontend-architecture`, `react-best-practices`, `next-best-practices` (+ `react-testing-library` for tests) |
  | `server/**`, `reviewer-core/**` (backend) | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `zod` (+ `postgresql-table-design` for schema) |
  | `@devdigest/shared` contracts | `zod` |
  | Cross-cutting (untrusted input, secrets, authz) | `security` |
- **Least-privilege tools.** The planner is read-only over code (it may only
  `Write` the spec file); the implementer gets `Edit`/`Write` but cannot commit,
  push, open PRs, or run migrations.

---

## `researcher`

Read-only investigation agent. Operates in two modes — **PROJECT** (code, config,
docs, git history via `Grep`/`Glob`/`Read`/read-only `Bash`) and **WEB**
(`WebSearch`/`WebFetch`) — and returns a strictly structured report with a
mandatory "Not found" section and a confidence rating. Has an interview mode: if
a request is ambiguous it asks 1–4 clarifying questions instead of guessing. No
`Write`/`Edit` tools; never spawns subagents or runs a deep-research harness.

**Based on:** the least-privilege read-only reviewer pattern (tools restricted to
read/search only). This agent predates the current session; no external sources
are recorded for it.

## `implementation-planner`

Codebase-aware planning specialist. Produces a structured Development Plan and
writes it to `docs/specs/<feature>.md` (the only file it may write). Workflow
mirrors the built-in Plan agent: clarify requirements → build project awareness
(reads `AGENTS.md`, per-package `AGENTS.md`, and `INSIGHTS.md`) → design with
Onion Architecture in mind → decompose into disjoint, parallelizable phases →
write the spec. Each phase carries a disjoint-scope marker, the skills to apply,
acceptance criteria, and how to test; the spec ends with a "Critical files for
implementation" list. May delegate fact-finding to `researcher` via the `Agent`
tool. Model **opus** (1M window) because planning is reasoning-heavy and benefits
from the larger context.

**Based on:**
- The built-in Claude Code **Plan** agent (read-only, four-phase workflow,
  "Critical Files" conclusion) — see the official docs and the reverse-engineered
  prompt in [Piebald-AI/claude-code-system-prompts][piebald].
- Community planner patterns (PRD/plan-file output, project-awareness) from
  [zachwills.net][zachwills].
- The official subagents guidance on `description`-driven delegation, the `tools`
  allowlist, `model` choice, and the `skills:` field —
  [Create custom subagents][docs-subagents] and [Skills][docs-skills].

## `implementer`

Implementation specialist that ships one disjoint slice (UI or backend). Workflow:
read the slice → load the surface's skills via the `Skill` tool → implement with
Onion layering and the right per-surface conventions → run the package's
`pnpm test` to green → do a **light self-review of its own diff only** → emit a
structured completion report (`Status: done | blocked`, files changed, test
result, self-review, skills applied, follow-ups/blockers). Definition of Done is
"tests green + own diff reviewed"; it explicitly does NOT do a full
quality/security audit — that is the separate [`pr-self-review`](../skills/pr-self-review)
pass. Model **sonnet** (200K window) for cheaper/faster parallel runs; the hybrid
skill loading keeps that window lean.

**Based on:**
- The community **implementer / "senior-software-engineer"** pattern — autonomy,
  adopt-adapt-invent, tests-as-Definition-of-Done — from [zachwills.net][zachwills]
  and [PubNub's subagent best practices][pubnub].
- The official subagents guidance on restricting `tools`, choosing `model`, and
  preloading skills via `skills:` vs invoking the `Skill` tool at runtime —
  [Create custom subagents][docs-subagents], [Skills][docs-skills], and the
  filesystem-discovery clarification in [claude-code issue #32910][issue-32910].
- Parallel-safety considerations (worktrees, disjoint slices) — [Worktrees][docs-worktrees]
  and curated collections such as [wshobson/agents][wshobson] and
  [VoltAgent/awesome-claude-code-subagents][voltagent].

---

## Sources

External best practices were gathered via the `researcher` agent on 2026-06-25.

**Official (Anthropic / Claude Code):**
- [Create custom subagents][docs-subagents] — `https://code.claude.com/docs/en/sub-agents`
- [Skills][docs-skills] — `https://code.claude.com/docs/en/skills`
- [Worktrees][docs-worktrees] — `https://code.claude.com/docs/en/worktrees`
- [Subagents discover project skills via filesystem — issue #32910][issue-32910] — `https://github.com/anthropics/claude-code/issues/32910`

**Community:**
- [Piebald-AI/claude-code-system-prompts][piebald] (reverse-engineered Plan agent prompt) — `https://github.com/Piebald-AI/claude-code-system-prompts`
- [wshobson/agents][wshobson] — `https://github.com/wshobson/agents`
- [VoltAgent/awesome-claude-code-subagents][voltagent] — `https://github.com/VoltAgent/awesome-claude-code-subagents`
- [zachwills.net — parallel Claude Code agents][zachwills] — `https://zachwills.net/how-to-use-claude-code-subagents-to-parallelize-development/`
- [PubNub — best practices for subagents][pubnub] — `https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/`
- [claudekit.cc — subagents, common mistakes][claudekit] — `https://claudekit.cc/blog/vc-04-subagents-from-basic-to-deep-dive-i-misunderstood`
- [MindStudio — build custom subagents][mindstudio] — `https://www.mindstudio.ai/blog/build-custom-sub-agents-claude-code-yaml`

[docs-subagents]: https://code.claude.com/docs/en/sub-agents
[docs-skills]: https://code.claude.com/docs/en/skills
[docs-worktrees]: https://code.claude.com/docs/en/worktrees
[issue-32910]: https://github.com/anthropics/claude-code/issues/32910
[piebald]: https://github.com/Piebald-AI/claude-code-system-prompts
[wshobson]: https://github.com/wshobson/agents
[voltagent]: https://github.com/VoltAgent/awesome-claude-code-subagents
[zachwills]: https://zachwills.net/how-to-use-claude-code-subagents-to-parallelize-development/
[pubnub]: https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/
[claudekit]: https://claudekit.cc/blog/vc-04-subagents-from-basic-to-deep-dive-i-misunderstood
[mindstudio]: https://www.mindstudio.ai/blog/build-custom-sub-agents-claude-code-yaml

## Verifying agent triggering

New agents register in a fresh session. To confirm they trigger, run a headless
probe (`claude -p "<prompt>" --output-format stream-json --verbose`) and grep the
stream for an `Agent` tool call naming the target agent — e.g. "склади
development plan для …" should route to `implementation-planner`, "зімплементуй
фазу …" to `implementer`.
