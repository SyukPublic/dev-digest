---
name: engineering-insights
description: Capture durable engineering insights into the right module's INSIGHTS.md, and prune that log. Use during any session when a non-obvious discovery is confirmed — a gotcha, a fix's root cause, a why-it's-like-this decision, an antipattern, or a tool/library quirk — and at session wrap-up to sweep for learnings. Also use to review, dedup, or declutter an INSIGHTS.md. Trigger terms: insight, learning, gotcha, INSIGHTS.md, lesson learned, wrap-up, retrospective, prune insights.
allowed-tools: Read, Edit, Write, Grep, Glob
---

# Engineering Insights

Persist hard-won, non-obvious engineering knowledge into the **`INSIGHTS.md` of the module
the work touched**, append-only — so the next session starts knowing what this one learned.

Two modes: **Capture** (default) and **Review / Prune**. Details, section rubric, routing,
examples, and the full prune procedure live in [reference.md](./reference.md) — read it before
a prune.

## Start of session — read first

When a session begins and the user has stated their task, BEFORE doing the work: identify the
module(s) it targets (see Routing) and **read that module's `INSIGHTS.md` first**. It may
already hold the gotcha, decision, or fix you'd otherwise rediscover. Mandatory, not optional —
treat the entries as high-confidence guidance unless something proves one stale.

## When to capture — double trigger

Capture at TWO moments:
- **As you go** — the instant you *confirm* something non-obvious during the work.
- **At wrap-up** — sweep the finished session for anything worth keeping.

Capture when a competent engineer reading the code would NOT already know it:
- a gotcha / footgun, or the **root cause** of a bug you just fixed;
- a "why it's like this" **decision** (with the reason);
- an **antipattern** ("X looks right but fails because…");
- a **tool/library quirk** (version-specific behavior, config landmine);
- something to revisit later → an **Open Question**.

**Cadence / what NOT to capture:** worth it after a substantive session (≈>30 min with a real
problem, solution, or discovery). Skip trivia — renames, formatting, routine config edits,
anything obvious from the code. Signal quality matters, not volume.

**Don't skip the negatives:** antipatterns and dead ends (What Doesn't Work / Recurring Errors)
are often the most valuable entries — capture them as readily as wins.

## Routing — which file

Write to the `INSIGHTS.md` of the package the insight is about (never a root file; there is
none):

| Work touched | File |
|---|---|
| `server/**` incl. `src/modules/**`, **repo-intel**, `src/vendor/shared` | `server/INSIGHTS.md` |
| `client/**` | `client/INSIGHTS.md` |
| `reviewer-core/**` | `reviewer-core/INSIGHTS.md` |
| `e2e/**` | `e2e/INSIGHTS.md` |

`repo-intel` is a sub-module *inside* `server/` → its insights roll up to `server/INSIGHTS.md`.
A change spanning packages → route to the **primary** package only; **never duplicate** the
same insight across files (duplication is what the prune step fights).

## Record format

One bullet, placed under the matching **section header** (the section is the category — see
reference for the 7 sections, created lazily). Preserve each file's existing `# … — INSIGHTS`
header + blockquote.

```
- [YYYY-MM-DD] <actionable gist — what to do / avoid / know>; `path` (symbol)
```

- Date today's entry (the harness provides the current date).
- Anchor evidence on a **stable** locator — `` `path` `` + symbol/function name (e.g.
  `` `server/src/db/migrate.ts` (runMigrations) ``). A line number is optional and approximate
  — lines drift, so don't rely on them.
- Keep it terse and **actionable cold**: a reader who wasn't here must know what to do.

## Anti-banality gate (apply before writing)

> If this were obvious to anyone reading the code, don't write it.

Reject three failure modes:
- **Too generic / platitude** — `async can be tricky`, `tests are important`.
- **Too specific / not transferable** — `fixed a bug on line 47`, `renamed x to y` (changelog or
  implementation detail, not a reusable lesson).
- **Too long** — keep each entry to **≤2 sentences**; split or summarize otherwise.

Good → ``- [2026-06-19] `Promise.all` on the index pipeline times out past ~30 items; use `Promise.allSettled` in batches of 10; `server/src/.../pipeline.ts` (runFullIndex) ``

If a candidate fails any check, sharpen it or drop it.

## Capture procedure

1. **Read the target file first** (routing table above) — the insight may already be there. If
   it (or an equivalent) is already recorded, **do NOT write it again** (append-only ≠ duplicate).
2. Apply the **anti-banality gate** — real, non-obvious, and substantial? If not, drop it.
3. Find or **lazily create** the right section header (only add a header once it has an entry —
   no empty sections).
4. **Append** one entry (never rewrite or delete existing entries here — that's prune's job).

If by wrap-up nothing substantial *and* new emerged, **write nothing** — an empty capture is the
correct outcome for a routine session.

## Review / Prune mode

Triggered by "prune insights" / "review INSIGHTS.md" / monthly cadence. The log is a **draft
under review**, so prune needs judgment — follow the full step-by-step in
[reference.md](./reference.md): dedup, conflict resolution (verify against live code; mark the
stale entry with a dated correction, never silent-delete), staleness flags, the ~200-entry
size cap → domain split (log what's dropped), and a final banality pass. **Show a summary and
apply only on confirmation.**

## Reliability note

A skill only runs when invoked, so capture is **best-effort**. The loop is closed by the
read-first rule + the `CLAUDE.md` wiring + manual `/engineering-insights`. As an **L06 preview
(prototype)**, a deterministic Stop-hook now backstops the *wrap-up* leg only:
`.claude/hooks/stop-insights.mjs` (wired in `.claude/settings.json`) re-invokes this skill when
the **user signals completion** — the last human prompt matches `DONE_PHRASES` (editable in the
script), the session made real code edits, and new edits exist since the previous sweep. Guarded
by `stop_hook_active` + a per-session edit cursor; the model's own "work is done" judgement
stays model-driven (not handled by the hook). It is a **trigger, not a second implementation**:
routing, the anti-banality gate, and read-before-write dedup still apply, so a redundant fire is
a no-op. The read-first and as-you-go legs stay model-driven.
