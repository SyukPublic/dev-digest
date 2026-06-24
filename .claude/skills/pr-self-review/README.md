# pr-self-review skill — basis & design

> Working document the `pr-self-review` skill is built from. Captures what it is, the agreed
> scope decisions, the dispatch/gate design, and the publish-gate mechanism. `SKILL.md` /
> `routing.md` are the runnable artifacts; this file is the rationale behind them.

## What it is

A **dispatcher / single-command workflow** that self-reviews a branch *before it goes outward*,
then publishes. It is not a new reviewer — it routes the existing skills onto the surfaces they
own and aggregates the result, gating on **CRITICAL**.

Pipeline: **review (route → run owning skills) → gate → push existing commits → create/update a
DRAFT PR description from the diff.**

## Scope decisions (agreed with the user)

| Decision | Choice | Why |
|---|---|---|
| Auto-trigger surface | `git push`, `gh pr create`, `gh pr merge` — **not** `git commit` | Commits are local/cheap/frequent; the meaningful "outward" boundary is publish/PR. |
| Re-trigger dedup | content fingerprint `merge-base(main,HEAD)..HEAD`; no re-run if HEAD unchanged between push and PR create/merge | Implements "don't re-trigger if nothing changed between them". |
| Conventional commit phase | **Removed** — the skill does **not** commit | Reviews commits that already exist; committing is the user's call. |
| PR mode | always `--draft` | Self-review precedes human review; the PR opens as a draft. |
| `gh pr merge` | kept as a hook **trigger** (backstop), but the skill **never merges** | Merge is the final human gate; the skill stops at draft PR. |
| Gate severity | only **CRITICAL** blocks; HIGH/MEDIUM advisory | Matches the severity scale the architecture skills already define. |

## Dispatch model

The judgment lives in the existing skills; this skill decides *which* runs *on which files*
(see [routing.md](./routing.md)). Same delegation model the architecture skills already use among
themselves ("Sibling skills — defer to them for mechanics"):

- **UI** (`client/**`) → `react-frontend-architecture` + `react-best-practices` +
  `next-best-practices`; UI tests → `react-testing-library`.
- **Backend** (`server/**`, `reviewer-core/**`) → `onion-architecture` + `fastify-best-practices`
  + `drizzle-orm-patterns` + `zod`; schema also → `postgresql-table-design`.
- **Cross-cutting** → `security`; type-heavy changes → `typescript-expert` (escalation).

## The publish gate (hook + marker)

`.claude/hooks/pre-publish-self-review.mjs`, wired in `.claude/settings.json` as a `PreToolUse`
hook on `Bash`:

- A hook can't run the LLM review, so on a publish command with **no marker** it returns
  `permissionDecision: "deny"` and routes Claude to this skill.
- The skill, after a CRITICAL-free pass, calls the **same script** with `--record-pass` (one
  source of truth for the fingerprint), which drops a marker in `os.tmpdir()` keyed by
  `merge-base(main,HEAD)..HEAD`.
- The retried push — and any later `gh pr create` / `gh pr merge` on the **same** HEAD — find the
  marker and proceed (no-op). A new/amended commit moves HEAD, invalidates the marker, and forces
  a fresh review.
- **Fails open** on any git/parse error: a backstop must never brick the user's git over an
  introspection glitch. The skill, not the hook, is the real gate.

Pure Node + git, no shell/jq — runs identically on Windows and Ubuntu (mirrors the existing
`stop-insights.mjs` precedent).

## Files

```
.claude/skills/pr-self-review/
├── SKILL.md      # phases: pre-check → review(dispatch) → gate → push → draft PR
├── routing.md    # surface → skill table + precedence notes
└── README.md     # this document
.claude/hooks/
└── pre-publish-self-review.mjs   # PreToolUse gate + `--record-pass` marker writer
```

Plus: `.claude/settings.json` (`PreToolUse` block) and a line in `AGENTS.md` skill-checkpoint
(work-type "publish / PR").

## Related

- `onion-architecture`, `react-frontend-architecture` — the surface owners this skill routes to,
  and the source of the CRITICAL/HIGH/MEDIUM scale.
- `engineering-insights` + `.claude/hooks/stop-insights.mjs` — the Stop-hook precedent this
  gate's hook design follows.
