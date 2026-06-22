---
name: pr-self-review
description: "Single-command pre-publish self-review for DevDigest. Runs a SECOND pass over the uncommitted/branch diff before changes go outward, ROUTING each changed surface to the skill that owns it — UI files (client/**) → react-frontend-architecture + react-best-practices + next-best-practices (+ react-testing-library for tests); backend files (server/**, reviewer-core/**) → onion-architecture + fastify-best-practices + drizzle-orm-patterns + zod; cross-cutting → security. Blocks publishing if ANY finding is CRITICAL; otherwise pushes existing commits and creates/updates a DRAFT PR description from the diff. Use this skill whenever the user is about to push, open, or merge a PR, says they are 'done'/'ready', asks to 'review my changes/diff before pushing', 'self-review', 'check my local changes', or runs git push / gh pr create / gh pr merge. It does NOT make commits and does NOT merge."
allowed-tools: Bash, Read, Grep, Glob, Skill
---

# PR Self-Review (DevDigest)

A **dispatcher / single-command workflow** that gives a branch a second pass *before it goes
outward*. It is the human "review your own PR before asking others to" step, automated: classify
what changed, hand each surface to the skill that actually knows how to judge it, gate on
**CRITICAL**, and only then publish + draft the PR.

This skill **orchestrates**, it does not re-implement. The judgment lives in the existing skills
(`onion-architecture`, `react-frontend-architecture`, …); this skill decides *which* of them runs
*on which files*, then aggregates. It **never makes a commit** and **never merges a PR** — it
reviews commits that already exist, pushes them, and opens/updates a **draft** PR.

## When it runs

- **Manual:** `/pr-self-review`, or any "review my changes before I push / open the PR", "self
  review", "am I ready to push". Default scope = the whole branch (`main...HEAD`).
- **Automatic backstop:** the `PreToolUse` hook `.claude/hooks/pre-publish-self-review.mjs`
  (wired in `.claude/settings.json`) blocks `git push`, `gh pr create`, and `gh pr merge` until
  this skill has passed for the current branch content. See [The publish gate](#the-publish-gate-marker-contract).

## Phase 0 — Pre-check (scope & safety)

1. Confirm a branch (not detached) and that it isn't `main`/`master`.
2. `git status --porcelain` — if there are **uncommitted** changes (staged or working-tree),
   **warn**: this skill reviews and publishes *committed* work (`main...HEAD`); uncommitted edits
   will NOT be pushed. Do not commit them yourself — that's the user's call.
3. Establish the review scope: `git diff main...HEAD --name-only` for the file list and
   `git diff main...HEAD` for the patch. (Fall back to `origin/main` if `main` is absent.)
4. If the diff is empty → report "no branch changes to review", stop (nothing to publish).

## Phase 1 — Review (dispatcher)

1. Classify every changed file into a **surface** using [routing.md](./routing.md). Read it now.
2. For each surface present in the diff, **invoke the owning skill(s)** and apply their rules as a
   review checklist **scoped to that surface's files only** — e.g. UI files go through
   `react-frontend-architecture` (+ siblings), backend files through `onion-architecture`
   (+ siblings). A file may match more than one lens (a Fastify route is both `onion-architecture`
   *layering* and `fastify-best-practices` *mechanics*) — run each that applies.
3. Collect findings. Every finding carries: **severity · surface · skill · `file:line` · why**.
   Reuse the severity vocabulary the skills already define (next section) — don't invent your own.

Run lenses for different surfaces independently; you don't need one surface's result before
starting another.

## Phase 2 — Gate (CRITICAL blocks)

- **Any CRITICAL** → verdict **BLOCK**. Print the CRITICAL findings (with `file:line` and the fix
  direction), do **not** push, do **not** create/update the PR, do **not** record the marker, and
  do **not** retry the publish command. Tell the user what to fix.
- **No CRITICAL** → verdict **PASS**. HIGH / MEDIUM findings are advisory: list them, but proceed.

## Phase 3 — Publish (only on PASS)

1. **Record the gate marker FIRST**, so the hook treats the upcoming push as already-reviewed:
   ```
   node .claude/hooks/pre-publish-self-review.mjs --record-pass
   ```
   (Run from the repo root. This computes the same `main...HEAD` fingerprint the hook checks.)
2. Push the existing commits: `git push -u origin HEAD` (or plain `git push` if upstream is set).

## Phase 4 — Draft PR (only on PASS)

1. Verify GitHub auth first — `gh auth status` (this repo authenticates `gh` via the WSL keyring;
   see `CLAUDE.local.md`). If unauthenticated, stop here with a clear note: **the push already
   happened**, only the PR step is skipped.
2. If a PR for this branch exists (`gh pr view --json number,isDraft`) → **update** its body:
   `gh pr edit --body <generated>`. Otherwise **create a draft**: `gh pr create --draft`.
3. Generate the PR description **from the diff**, not from memory — see the template below. Always
   create as a **draft** (`--draft`), regardless of branch state.
4. Print the PR URL and a one-line summary of the self-review verdict.

### PR description template

```
## What
<1–3 sentences: what this branch changes, derived from the diff>

## Why
<the motivation / linked issue if discoverable from commits>

## Surfaces touched
<bullet per surface from Phase 1: e.g. "client/ — UI architecture", "server/ — backend layering">

## Self-review
<PASS. N HIGH / M MEDIUM advisory findings (summarize), 0 CRITICAL.>

## Notes for reviewers
<anything non-obvious: migrations to run, follow-ups, intentional scope cuts>

🤖 Self-reviewed with the `pr-self-review` skill
```

## Severity levels

Same scale the architecture skills use — do not redefine:

- **CRITICAL** — the only severity that **blocks publishing**. Breaks a hard invariant
  (dependency direction, core purity, leaked infra/secret, server code reaching the client,
  unrepresentable-state bug).
- **HIGH** — erodes a boundary or will cause scaling/maintenance pain. Advisory here; report it.
- **MEDIUM** — navigability / DX. Advisory.

## The publish gate (marker contract)

The hook and this skill share one **content-addressed** fingerprint:
`merge-base(main,HEAD)..HEAD`. Consequences to keep in mind:

- The marker is written by **`--record-pass`** (Phase 3) and keyed to the current branch content.
  `git push` → `gh pr create` → `gh pr merge` on the **same** HEAD all reuse it → the hook is a
  no-op (this is the "no re-trigger if nothing changed between them" requirement).
- Any new or amended commit moves HEAD → the marker no longer matches → the next publish is
  blocked again until a fresh review passes. This is intended.
- On BLOCK, never record the marker. A manual `git push` afterward will be denied by the hook,
  which is the whole point.

## Edge cases

- **Only docs/config/lockfiles changed** (no code surface matched) → PASS with "no code surfaces";
  still allowed to publish + draft PR.
- **Merge commit with no branch diff** vs `main` → empty scope → PASS.
- **`gh pr merge`** is a hook trigger (backstop) but **not** a workflow phase — this skill never
  merges. If asked to "ship/merge", do the review + push + draft PR and stop.
- **`gh` not authenticated** → push still happens; PR step is skipped with a note (don't fail the
  whole run).
- **No `main` locally** → fall back to `origin/main` for both the diff scope and the fingerprint.
