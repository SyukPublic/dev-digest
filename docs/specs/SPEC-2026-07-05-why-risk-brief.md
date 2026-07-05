# Spec: Why+Risk Brief | Spec ID: SPEC-2026-07-05-why-risk-brief | Status: implemented
Supersedes: — | Superseded by: —

## Problem & context

A reviewer opening a pull request today has to reconstruct the "so what" of a PR
by hand: read the diff, guess the author's intent, mentally trace what the change
can break, and decide where to look first. DevDigest already computes most of the
raw material for that judgement — the **intent** (`pr_intent`), the deterministic
**blast radius** (impact map from repo-intel), the **smart-diff** reviewer-ordered
groups (`core` / `wiring` / `boilerplate` with per-file stats), the linked GitHub
**issue**, and any project **specs** attached to reviewer agents/skills — but none
of it is fused into a single human answer to "what does this PR do, why, how risky
is it, and what should I read first?".

**Why+Risk Brief** is that fusion. On the PR page (Overview tab) it presents a
concise **PR BRIEF** card (what the PR does + why + a colour-coded risk level),
reworks the existing INTENT-card **RISK AREAS** so every risk points to a REAL
file from the blast map (with a file:line-range link and an expandable
explanation), and adds a full-width **REVIEW FOCUS — READ THESE FIRST** ordered
list of the highest-value places to look, each a clickable `file:line` link with a
one-line reason.

It follows the established house pattern **"code collects the facts, the model
writes the narrative"**: a new `POST /pulls/:id/brief` route assembles its input
entirely from **already-computed** artifacts — intent + blast summary + smart-diff
per-group statistics + the linked issue + the specs attached to the workspace's
enabled reviewer agents/skills — makes **exactly one** structured LLM call that
returns a `Brief { what, why, risk_level, risks[], review_focus[] }`, and persists
it per PR. Crucially the input carries **no diff bodies / hunks / file contents**:
only the pre-digested summaries and statistics, so the brief is cheap and never
re-sends the patch. Re-opening the PR serves the cached brief with **zero** LLM
calls; a **Regenerate** button recomputes it; an **Outdated** badge appears when
the PR's output-determining inputs have drifted since the brief was generated.

The PR BRIEF card's header (verdict badge, "N findings · M blockers" pill, the
"PR SCORE" gauge, and the cost line) is **not** produced by the brief — it is
**composed** from the latest *review* artifact (`ReviewRecord.verdict` /
`.score` / findings + per-run `cost_usd`), so surfacing it costs zero extra LLM
calls. The brief supplies only the card *body* (the what/why prose + the
`risk_level` badge). The two artifacts are decoupled: a brief with no review shows
"—" in the header; a review with no brief shows a "Generate brief" body.

Substantial scaffolding this feature builds on already exists:
- `POST /pulls/:id/review` produces `Review { verdict, summary, score, findings[] }`
  and per-run `cost_usd` (see the run-cost feature) — the source of the card
  header.
- The `Intent` (`pr_intent`), `BlastRadius` + provenance, and `SmartDiff` group
  contracts and their services (`modules/reviews`, `modules/blast`,
  `modules/smart-diff`) already compute the brief's inputs.
- The linked issue is resolvable server-side from `pull.body`
  (`closes|fixes|resolves #N` → `container.github().getIssue(...)`), already done
  in `intent-service.ts`.
- Project-Context-Folder resolves specs attached to agents/skills (ordered path
  lists) and reads them from the read-only clone, best-effort.
- The `Risk` shape (`{ kind, title, explanation, severity, file_refs }`) already
  exists and is reused for `Brief.risks[]`.
- The `onboarding-generator` service is the reference for the single-flight
  per-repo/per-PR generation behind a workspace guard and the freshness/staleness
  meta pattern.
- The "Onboarding Tour" sidebar item and its `g o` shortcut already ship
  (`client/src/vendor/ui/nav.ts`) — recorded here as a verify-only requirement.

Intended outcome: for any PR, a reviewer opens Overview and immediately sees a
grounded brief (what/why/risk), risks that link to real files, and an ordered
"read these first" list — generated on demand from one structured LLM call over
already-computed facts, cached per PR, and honestly flagged when stale.

## Goals / Non-goals

### Goals
- A new **`POST /pulls/:id/brief`** route (regenerate) plus a **`GET /pulls/:id/brief`**
  read route (cached, zero LLM), workspace-scoped like every PR resource.
- **Deterministic input assembly** from ALREADY-computed artifacts, with **zero**
  new diff parsing and **no** change bodies (no hunks, no file contents): the
  stored `Intent`, the blast-radius `summary` + the real changed-file/caller/
  endpoint list from the impact map, the smart-diff **per-group statistics**
  (`role` + per-file `additions`/`deletions`/`finding_lines` counts), the linked
  issue (title/body, best-effort), and the union of specs attached to the
  workspace's **enabled** reviewer agents/skills (best-effort).
- **Exactly one** structured LLM call (`completeStructured`, JSON-schema + Zod
  validated, reprompt-on-error) returning a `Brief { what, why, risk_level,
  risks[], review_focus[] }` per generation.
- **Real-path grounding:** every `risks[].file_refs` and `review_focus[].path`
  must reference a REAL file (present in the blast-map / changed-file input);
  server-side grounding drops or repairs invented paths before persisting.
- **A new PR BRIEF card** at the top of Overview whose **body** renders the
  brief's `what`/`why` prose and a colour-coded `risk_level` badge, and whose
  **header is composed from the latest review** (verdict badge, "N findings ·
  M blockers" pill, PR SCORE gauge, cost line) — zero extra LLM calls; a
  **Regenerate** icon button; an **info** affordance; the **Outdated** badge when
  stale.
- **A full-width REVIEW FOCUS — READ THESE FIRST section** below the two-column
  cards: an ordered list with a count badge; each item is a clickable `file:line`
  link + a one-line reason.
- **Reworked RISK AREAS inside the INTENT card:** the INTENT card's RISK AREAS now
  renders the brief's `risks[]` (real-path file:line-range link + severity + kind
  icon + an expander chevron revealing the explanation) instead of the standalone
  `Risks` artifact.
- **Per-PR cache** in a NEW table keyed by `pr_id` (carrying `workspace_id`),
  storing the `Brief` JSON, a `generated_at` timestamp, and a `freshness_key`.
  Re-opening the PR serves the cached brief with **zero** LLM calls.
- **Freshness / Outdated badge:** a `sha256` freshness key over
  `[headSha, base, title, body, brief-model provider+model, BRIEF_PROMPT_VERSION,
  storedIntent.freshnessKey]`, computed on read with **no** network; `is_stale`
  when the stored key differs from the current key.
- **Single-flight per PR behind the workspace guard:** concurrent/duplicate
  `POST /pulls/:id/brief` (double-click Regenerate) coalesce to one in-flight
  generation; the cache write is an idempotent upsert.
- **A new `FeatureModelId` registry slot** for the brief's single structured call,
  with a built-in default and a per-workspace override in Settings.
- **i18n (en + uk)** for every new user-facing string via next-intl.
- **Verify-only:** the "Onboarding Tour" WORKSPACE nav item + `g o` shortcut are
  already shipped and must remain present (no new work).

### Non-goals (explicitly out of scope)
- **A verdict / score / blockers / cost from the brief itself.** Those are
  review-derived and composed into the card header. The brief LLM output carries
  no verdict/score/cost; introducing a second, possibly-conflicting verdict is out
  of scope.
- **Triggering a review from the brief.** The Regenerate button recomputes ONLY
  the brief; it never runs `POST /pulls/:id/review`. The two artifacts are
  independent.
- **Sending diff bodies / hunks / file contents to the model.** The brief input is
  digests and statistics only; the patch is never re-sent (that is what makes the
  brief cheap).
- **Flagging Outdated on linked-issue or attached-spec edits.** The freshness key
  deliberately EXCLUDES the linked issue and the Context-Folder spec contents
  (including either would force a GitHub call / clone read on every `GET`, and the
  write/read keys must use identical inputs). Editing the issue or the attached
  specs does NOT auto-flag the brief; a manual **Regenerate** refreshes it. This
  limitation is surfaced in the UI copy.
- **Per-PR spec relevance / a "flash selector".** Spec selection is the union of
  specs attached to the workspace's enabled reviewer agents/skills — there is no
  per-PR relevance ranking (auto-selection per PR is an explicit future non-goal
  of the project-context feature).
- **Migrating the existing `pr_brief` (`Risks`) table.** The new brief lives in a
  NEW table; the existing `pr_brief`/`Risks` rows and their storage are untouched.
  See the migration note under "Contracts / migration note" for the standalone
  `Risks` Recompute's fate.
- **Base-branch advancing / new-symbol staleness beyond the freshness key.** The
  key uses the persisted `pull` row; freshness is only as fresh as the last PR
  sync (same accepted caveat as review-freshness).
- **New embedding / RAG work.** Zero embedding calls.

## User stories

- **US-1** — As a reviewer, when I open a PR's Overview I see a PR BRIEF card that
  tells me what the PR does, why, and how risky it is, plus (composed from the
  latest review) its verdict, finding/blocker counts, score, and cost.
- **US-2** — As a reviewer, I can read a REVIEW FOCUS — READ THESE FIRST list that
  points me, in order, at the exact `file:line` places to look and why.
- **US-3** — As a reviewer, the RISK AREAS in the INTENT card link to REAL files
  (file:line range) and expand to show each risk's explanation.
- **US-4** — As a user, I can **Regenerate** the brief on demand; re-opening the PR
  serves the cached brief without a new LLM call; I can see when it's **Outdated**.
- **US-5** — As a user, when no brief has been generated yet I see a friendly
  "Generate brief" state; when no review has run the card header shows "—" instead
  of a fake verdict/score.
- **US-6** — As a maintainer, I can pick the model used for the brief's single
  structured call in Settings.

## Design analysis

**Sources.** Two mockup screenshots described textually by the requester (the
agent did not view the images); the transcription in the task is the design of
record. No exported assets exist under
`docs/specs/assets/SPEC-2026-07-05-why-risk-brief/` at spec time — when they are
added, the Traceability "Design ref" column should point to the concrete files.
The design was cross-checked against the codebase so terminology matches reality
(the review verdict/score, the Intent/RISK AREAS card, the Blast Radius card, the
smart-diff groups, the run-cost badge, and the sidebar nav all exist).

### Screen & state inventory
1. **Sidebar (verify-only).** WORKSPACE group already contains "Onboarding Tour"
   (icon `Workflow`, `g o` shortcut) between "Pull Requests" and "Project
   Context"; this must remain. No new nav work → AC-20.
2. **PR header / tabs (context, unchanged).** Breadcrumb, PR title, author,
   branch, `+247 −38`, "opened 3h ago", status badge, "View on GitHub" / "Run
   Review ▾" / "Compose review"; Overview / Agent runs / Files changed tabs. Not
   part of this feature except that the PR BRIEF card is the first block of
   Overview.
3. **PR BRIEF card (new, top of Overview).**
   - **Left/body (brief-sourced):** the what/why summary prose paragraph; a
     colour-coded `risk_level` badge; an **info** affordance explaining the brief.
   - **Header (review-composed):** a verdict icon + label (e.g. red circle-X
     "Request changes"); a pill "N findings · M blockers"; a circular **PR SCORE**
     gauge (e.g. "61 / PR SCORE" with a coloured arc); a **cost line** (e.g.
     "$0.014 · 8.2K→1.3K" — cost + input→output tokens).
   - **Actions:** a **Regenerate** (circular-arrow) icon button; the **Outdated**
     badge when stale.
   - Covered by AC-6 (body), AC-7 (composed header), AC-8 (empty/partial states),
     AC-9 (regenerate), AC-14 (outdated).
4. **INTENT card RISK AREAS (reworked).** Each risk row: severity/type icon +
   title + a REAL file link with a line range (e.g.
   `src/middleware/ratelimit.ts:12-18`) + an expander chevron revealing the
   explanation. Fed by the brief's `risks[]` (not the standalone `Risks`
   artifact) → AC-3, AC-5. In-scope/out-of-scope lists stay as today.
5. **BLAST RADIUS card (context, unchanged).** Stats row, Tree/Graph toggle,
   per-symbol callers, endpoint/cron chips, prior-PRs collapsed section. Not part
   of this feature except as the SOURCE of the real files that ground `risks[]`
   and `review_focus[]`.
6. **REVIEW FOCUS — READ THESE FIRST section (new, full-width, count badge).** An
   ordered list; each item = a clickable `file:line` link + a one-line reason
   (e.g. "src/config.ts:12 — live Stripe key committed in plaintext"). Fed by the
   brief's `review_focus[]` → AC-2, AC-4.
7. **Files changed tab (context, out of scope).** The existing smart-diff feature;
   relevant only as the SOURCE of the per-group diff statistics fed to the brief.

### Gap sweep (each gap → an AC or an explicit decision)
- **No brief generated yet** — friendly "Generate brief" body; header still shows
  review data (or "—") → AC-8.
- **No review run yet** — header fields show "—" while the brief body renders →
  AC-7, AC-8.
- **Loading state** — Overview loading the cached brief → AC-15.
- **Generation in progress** — progress affordance; Regenerate disabled → AC-10.
- **Double-click Regenerate / concurrent POSTs** — single-flight per PR; coalesce
  → AC-11.
- **Regenerate racing a PR head-sync / cache read racing a write** — upsert cache
  write; the read serves whatever is committed; the freshness key catches a head
  move on the next read → AC-11, AC-14, AC-19.
- **LLM fails / invalid schema after retries** — no partial persist; error state;
  prior brief intact → AC-13.
- **Model invents a file path** — real-path grounding drops/repairs it → AC-5.
- **Empty inputs** (no intent, degraded blast, no smart-diff, no issue, no specs)
  — best-effort: drop the missing section from the input, never throw; the brief
  still generates from whatever facts exist → AC-12.
- **Long text / second locale (en + uk)** — all new UI strings via next-intl;
  layout tolerates uk expansion → AC-17.
- **Accessibility** — expander chevrons keyboard-operable; ordered list + links
  focus order; Regenerate/Outdated announced (aria-live); gauge has a text
  equivalent → AC-18.
- **Responsive** — card, focus list, and risk rows usable at narrow widths →
  AC-18.
- **Permission / authz** — brief read + generation workspace-scoped like every
  resource → AC-16.
- **Injection safety** — all assembled inputs are untrusted repo/author data; the
  model output is untrusted content rendered as data; file links to out-of-diff
  files must not enable protocol/script injection → AC-12, AC-5, AC-18.

## Acceptance criteria (EARS)

Numbering is append-only and permanent.

- **AC-1** [Event-driven] WHEN the user activates **Generate** / **Regenerate**
  for a PR, the system shall (a) assemble the brief input from ALREADY-computed
  artifacts — the stored `Intent`, the blast-radius `summary` + real
  changed-file/caller/endpoint list, the smart-diff per-group statistics, the
  linked issue (best-effort), and the union of specs attached to the workspace's
  **enabled** reviewer agents/skills (best-effort) — **without** including any
  diff hunks, file contents, or raw patch, (b) make exactly one structured LLM
  call returning a `Brief` validated against its Zod schema, and (c) persist the
  result (`Brief` JSON + `generated_at` + `freshness_key`) keyed by `pr_id`,
  overwriting any prior brief for that PR.
- **AC-2** [Event-driven] WHEN a stored brief is rendered, the system shall show a
  full-width **REVIEW FOCUS — READ THESE FIRST** section: an ordered list of
  `review_focus[]` items, each a clickable `file:line` link plus a one-line
  reason, with a count badge equal to the number of items.
- **AC-3** [Event-driven] WHEN a stored brief is rendered, the system shall render
  its `risks[]` inside the INTENT card's **RISK AREAS** subsection — each risk as
  a row with a severity/kind icon, a title, a REAL file link with a line range,
  and an expander chevron that reveals the risk's explanation — instead of the
  standalone `Risks` artifact.
- **AC-4** [State-driven] WHILE assembling `review_focus[]` and `risks[]`, the
  system shall constrain every `review_focus[].path` and `risks[].file_refs` entry
  to a REAL file present in the assembled input (blast-map / changed files); the
  server shall drop or repair any path the model invents before persisting, so no
  fabricated path is stored or rendered.
- **AC-5** [Unwanted behavior] IF the model returns a `risks[]` or `review_focus[]`
  entry whose path is not a real file from the input, THEN the system shall not
  persist that fabricated path (drop the entry or repair it to a real path) and
  shall still persist the rest of the brief.
- **AC-6** [Event-driven] WHEN a stored brief is rendered, the system shall show a
  **PR BRIEF** card whose body renders the brief's `what` and `why` prose and a
  colour-coded badge for `risk_level`, plus an info affordance describing the
  brief.
- **AC-7** [State-driven] WHILE a PR BRIEF card is shown, the system shall COMPOSE
  its header from the latest **review** artifact — a verdict badge (from
  `ReviewRecord.verdict`), a "N findings · M blockers" pill (finding count and
  CRITICAL-severity count from the review's findings), a PR SCORE gauge (from
  `ReviewRecord.score`), and a cost line (cost + input→output tokens from the
  review run) — making **zero** additional LLM calls; WHEN no review exists for the
  PR, the header fields shall render as "—".
- **AC-8** [State-driven] WHILE no brief is stored for a PR, the system shall show
  a friendly "Generate brief" empty state in the card body (with a Generate
  action) and shall make no LLM call until the user invokes it (no
  auto-generation on page open); the composed header shall still render review data
  (or "—") independently.
- **AC-9** [Event-driven] WHEN the user clicks the Regenerate icon button, the
  system shall recompute ONLY the brief (it shall NOT trigger a review run) and, on
  success, replace the stored brief and refresh the rendered card body, RISK
  AREAS, and REVIEW FOCUS.
- **AC-10** [Event-driven] WHEN a brief generation is in progress, the system
  shall show a progress affordance and disable the Generate/Regenerate control
  until it settles.
- **AC-11** [Unwanted behavior] IF the user activates Regenerate while a generation
  for the SAME PR is already in progress (double-click) or a concurrent
  `POST /pulls/:id/brief` arrives, THEN the system shall not start a second
  concurrent generation (single-flight per PR, behind the workspace guard) and
  shall coalesce to the in-flight generation; the cache write shall be an
  idempotent upsert so two writes cannot violate the `pr_id` primary key.
- **AC-12** [Unwanted behavior] IF any brief input artifact is missing, degraded,
  or errors during assembly (no intent, a degraded/empty blast map, no smart-diff,
  no resolvable issue, unreadable/absent specs), THEN the system shall drop that
  section from the input best-effort and continue the single generation over
  whatever facts remain, without throwing.
- **AC-13** [Unwanted behavior] IF the single structured LLM call fails or its
  output fails schema validation after the configured reprompts/retries, THEN the
  system shall not persist a partial brief, shall surface a non-blocking error
  state, and shall leave any previously stored brief intact.
- **AC-14** [State-driven] WHILE a stored brief's `freshness_key` differs from the
  freshly-computed current key — `sha256` over `[headSha, base, title, body,
  brief-model provider+model, BRIEF_PROMPT_VERSION, storedIntent.freshnessKey]`,
  computed on read with NO network — the system shall show an **Outdated** badge
  (icon + text, never colour alone) whose tooltip notes that editing the linked
  issue or attached specs does NOT flag Outdated (Regenerate refreshes); a NULL
  stored key (legacy) shall be treated as NOT stale.
- **AC-15** [Event-driven] WHEN the Overview is loading the cached brief, the
  system shall show a loading state (not an error and not a blank card).
- **AC-16** [Unwanted behavior] IF a request targets a brief read or generation
  for a PR outside the caller's workspace, THEN the system shall deny access
  (workspace scoping), consistent with every other resource.
- **AC-17** [State-driven] WHILE any user-facing string introduced by this feature
  is rendered, the system shall source it from next-intl in both `en` and `uk`
  (no hardcoded text); model-authored brief text is content (not a UI string) and
  is generated in the configured language.
- **AC-18** [State-driven] WHILE the PR BRIEF card, RISK AREAS, and REVIEW FOCUS
  are in use, the system shall provide keyboard-operable risk expanders and focus
  links, correct focus order, an accessible text equivalent for the PR SCORE
  gauge, aria-live announcement of the Regenerate/Outdated state, and usable layout
  at narrow widths.
- **AC-19** [State-driven] WHILE a stored brief is read, the system shall make
  **zero** LLM calls and **zero** embedding calls (open = cache read only);
  generation shall make **exactly one** LLM call and **zero** embedding calls.
- **AC-20** [Event-driven] WHEN the client shell renders the sidebar, the system
  shall continue to show the already-shipped "Onboarding Tour" item (icon
  `Workflow`, WORKSPACE group, between "Pull Requests" and "Project Context") with
  its `g o` shortcut — a verify-only requirement, no new work.
- **AC-21** [State-driven] WHILE the brief input includes repo/author-derived or
  model-authored text (intent, blast summary, smart-diff summaries, issue text,
  attached spec contents, and the model's own `what`/`why`/`risks`/`review_focus`),
  the system shall treat all of it as UNTRUSTED data — assembled inputs wrapped as
  untrusted (never as generation instructions), model output rendered as data
  (no HTML/script execution), and file-link hrefs restricted to safe file/URL
  targets (no `javascript:` or other executable protocols).

## Edge cases

| Edge case | Handling | AC |
|---|---|---|
| No brief stored | "Generate brief" body; header shows review/"—"; no auto-LLM | AC-8, AC-19 |
| No review run yet | Header fields render "—"; brief body still renders | AC-7 |
| Brief loading | Loading state, not blank/error | AC-15 |
| Generation in progress | Progress affordance; control disabled | AC-10 |
| Double-click Regenerate / concurrent POSTs | Single-flight per PR (behind workspace guard); coalesce; upsert write | AC-11 |
| Regenerate racing a PR head-sync | Generation uses the pull row at start; the freshness key catches the head move on the next read → Outdated | AC-11, AC-14 |
| Cache read racing a write | Read serves the committed row; upsert prevents PK conflict on concurrent writes | AC-11 |
| Missing/degraded input (intent/blast/smart-diff/issue/specs) | Drop that section best-effort; generate over the rest; never throw | AC-12 |
| LLM fails / invalid schema after retries | No partial persist; error state; prior brief intact | AC-13 |
| Model invents a file path | Path grounded to real files; fabricated path dropped/repaired | AC-4, AC-5 |
| Stored brief older than the current inputs (head/title/body/model/prompt/intent) | Outdated badge; no auto-regenerate | AC-14 |
| Linked issue OR attached spec edited (no head move) | NOT flagged Outdated (excluded from key); Regenerate refreshes; caveat in tooltip | AC-14 (decision) |
| Cross-workspace access to a brief / generation | Denied (workspace scoping) | AC-16 |
| Out-of-diff file link (blast caller with no diff row) | Deep-link to the repo host (e.g. GitHub blob) via the existing out-of-diff link pattern; safe protocol only | AC-18, AC-21 |
| Standalone `Risks` Recompute superseded by brief | RISK AREAS now reads the brief; old `Risks`/Recompute path's fate is a migration note (Contracts) | — (migration note) |
| "Onboarding Tour" nav item / `g o` | Already shipped; verify present, add nothing | AC-20 |

## Workflows & service communication

### 1. Open a PR (serve the cached brief, compose the review header) — zero LLM

Opening Overview reads the persisted `Brief` (or none) and computes `is_stale` on
read (no network); the card header is composed from the latest review artifact.
No LLM or embedding call occurs.

```mermaid
sequenceDiagram
  participant U as User
  participant Web as Client (Overview)
  participant API as Server (brief module)
  participant DB as pr_why_risk_brief table
  participant Rev as reviews facade (latest review)
  U->>Web: Open PR Overview (prId)
  Web->>API: GET brief (prId)
  API->>DB: read brief row (by prId, workspace-scoped)
  DB-->>API: Brief JSON + generatedAt + freshnessKey (or none)
  API->>API: recompute current freshness key (no network) → is_stale
  API-->>Web: brief + is_stale (or null)
  Web->>Rev: latest review (verdict, score, findings, cost)
  Rev-->>Web: review header data (or none → "—")
  Web-->>U: PR BRIEF card (body from brief, header from review) + RISK AREAS + REVIEW FOCUS
```

The client fetches the review header from the existing reviews query it already
holds on the PR page; the brief endpoint itself never calls the LLM on read.

### 2. Generate / Regenerate — facts collected by code, narrative by the model

A generation runs under a per-PR single-flight behind the workspace guard,
assembles the input from already-computed artifacts (no diff bodies), makes
exactly one structured LLM call, grounds paths to real files, and upserts.

```mermaid
sequenceDiagram
  participant U as User
  participant API as brief service (single-flight per PR)
  participant Intent as intent (pr_intent)
  participant Blast as blast facade (impact map + summary)
  participant SD as smart-diff (per-group stats)
  participant GH as github (linked issue, best-effort)
  participant Specs as project-context (agent/skill specs, best-effort)
  participant LLM as LLMProvider.completeStructured
  participant DB as pr_why_risk_brief table
  U->>API: POST /pulls/:id/brief (Regenerate)
  API->>API: assertPull(workspaceId, prId) BEFORE coalescing (AC-16)
  API->>Intent: read stored intent
  API->>Blast: blast summary + real files/callers/endpoints
  API->>SD: per-group diff statistics (no hunks)
  API->>GH: resolve linked issue (best-effort; drop on error)
  API->>Specs: union of enabled agents'/skills' attached specs (best-effort)
  Note over API: input = digests + stats ONLY (NO diff bodies)
  API->>LLM: one structured call (inputs as untrusted data → Brief schema)
  LLM-->>API: Brief { what, why, risk_level, risks[], review_focus[] }
  API->>API: ground risks[].file_refs & review_focus[].path to REAL files (AC-4/5)
  alt valid
    API->>DB: upsert brief (json, generatedAt=now, freshnessKey) by prId
    API-->>U: brief
  else invalid after retries / call failed
    API-->>U: error state (prior brief left intact)
  end
```

### 3. Inputs → the one call → the three UI surfaces

The assembler maps already-computed artifacts to one input bundle; one validated
`Brief` fans out to the card body, the reworked RISK AREAS, and REVIEW FOCUS.

```mermaid
flowchart TD
  Intent["Intent (pr_intent)"] --> IN["Brief input bundle\n(digests + stats, NO diff bodies)"]
  Blast["Blast summary + REAL files/callers/endpoints"] --> IN
  SD["Smart-diff per-group stats\n(role, +/-, finding_lines counts)"] --> IN
  Issue["Linked issue (best-effort)"] --> IN
  Specs["Enabled agents'/skills' specs (best-effort)"] --> IN
  IN --> Model["ONE structured LLM call\n(inputs = untrusted data)"]
  Model --> Brief["Brief { what, why, risk_level, risks[], review_focus[] }\n(paths grounded to REAL files)"]
  Brief --> Card["PR BRIEF card body\n(what/why + risk_level)"]
  Brief --> Risks["INTENT card RISK AREAS\n(file:line links + explanation)"]
  Brief --> Focus["REVIEW FOCUS — READ THESE FIRST\n(ordered file:line + reason)"]
  Review["Latest review (verdict/score/findings/cost)"] --> Header["PR BRIEF card HEADER (composed, 0 LLM)"]
```

The single generation is the sole authority for the brief body/risks/focus; the
card header is composed separately from the latest review.

## Contracts (shape-level)

All shapes are shape-level only (field + type + semantics). NEW contracts ship as
a NEW file under `@devdigest/shared` (existing barrels are extended, never edited
in place — server INSIGHTS: the server copy is the source of truth; run the shared
sync so the client copy mirrors it). `Brief.risks[]` reuses the EXISTING `Risk`
shape (`brief.ts`).

### `Brief` document (NEW file — stored in the new table)
| Field | Type | Semantics |
|---|---|---|
| `what` | string | What the PR does — concise prose (model-authored). Rendered as data. |
| `why` | string | Why the PR exists / its intended outcome (model-authored). Rendered as data. |
| `risk_level` | enum `high` \| `medium` \| `low` | Overall merge-risk level → the colour-coded badge in the card body. Exactly these three values, aligned with the existing `RiskSeverity` enum; there is NO `critical` level (resolved decision). |
| `risks` | `Risk[]` (EXISTS) | Reworked risk areas. Each `Risk { kind, title, explanation, severity, file_refs }`; `file_refs` grounded to REAL files with line ranges (AC-4). Drives the INTENT-card RISK AREAS rows (AC-3). |
| `review_focus` | `ReviewFocusItem[]` | Ordered "read these first" items (AC-2). |

`ReviewFocusItem` (NEW):
| Field | Type | Semantics |
|---|---|---|
| `path` | string | Repo-relative REAL file path (grounded — AC-4), e.g. `src/config.ts`. |
| `line` | integer (nullish) | Line number for the `file:line` link; nullish when file-level. |
| `reason` | string | One-line reason to look here (model-authored). Rendered as data. |

**Invariants:** every `risks[].file_refs` entry and every `review_focus[].path`
is a real path from the assembled input (never invented — AC-4/5);
`review_focus[]` order is the rendered order; the document validates against its
Zod schema before persistence (AC-13).

### Brief input bundle (NEW file under `@devdigest/shared` — shape only)
The deterministic bundle assembled from already-computed artifacts and passed (as
untrusted data) into the single LLM call. Contains NO diff bodies/hunks/file
contents.
| Field | Type | Semantics |
|---|---|---|
| `intent` | `Intent` (EXISTS, nullish) | Stored intent (`intent` + in/out scope). Dropped when absent (AC-12). |
| `blast_summary` | string (nullish) | The blast-radius one-paragraph summary. |
| `blast_files` | `{ path, callers?, endpoints? }[]` | REAL changed files + impacted callers/endpoints from the impact map — the grounding source for real paths (AC-4). |
| `smart_diff_groups` | `{ role, files: { path, additions, deletions, finding_count }[] }[]` | Per-group statistics only (no `patch`, no hunks). |
| `linked_issue` | `{ number, title, body }` (nullish) | Best-effort; dropped on error/absence (AC-12). |
| `specs` | `{ path, content }[]` | Union of specs attached to the workspace's ENABLED reviewer agents/skills, read from the read-only clone best-effort (dropped on error — AC-12). |

**Invariants:** assembled with zero new diff parsing and no raw patch (AC-1);
degraded/missing artifacts are dropped rather than aborting (AC-12); everything is
treated as untrusted data at prompt assembly (AC-21).

### Persistence (NEW table — shape only; exact name finalized in the plan)
| Field | Type | Semantics |
|---|---|---|
| `pr_id` | uuid (PK → `pull_requests.id`, cascade) | One brief per PR. |
| `workspace_id` | uuid | Multi-tenancy column (every domain table carries it); the brief is workspace-scoped (AC-16). |
| `json` | jsonb | The `Brief` document. |
| `generated_at` | timestamptz (default now) | Set on each generation; drives "generated X ago". |
| `freshness_key` | text (nullable) | `sha256` over the output-determining inputs; drives `is_stale` (AC-14). NULL (legacy) ⇒ not stale. |

### API surface (shape-level — endpoints finalized in the plan)
| Operation | Direction | Semantics |
|---|---|---|
| Get brief | client → server | `GET /pulls/:id/brief` → the stored `Brief` + `is_stale` (computed on read, no network), or "none" (empty state). Zero LLM. Workspace-scoped. |
| Generate / Regenerate | client → server | `POST /pulls/:id/brief` → assemble input + one structured LLM call + ground paths + upsert; single-flight per PR behind the workspace guard (AC-11); rate-limited (each call is an LLM run); returns the generated brief or an error (AC-13). |

The card HEADER data (verdict/score/findings/cost) is NOT a new endpoint — the
client composes it from the existing reviews query on the PR page (AC-7).

### Configuration (new registry slot + shape-only)
| Key | Type | Semantics |
|---|---|---|
| brief feature model | `FeatureModelId` (NEW slot) | Provider/model for the single structured call, from Settings, with a registry default (mirrors `onboarding` / `risk_brief`). Exact id + default finalized at plan time. |
| `BRIEF_PROMPT_VERSION` | integer constant | Bumped by hand on any brief-prompt change; folded into the freshness key (mirrors `INTENT_PROMPT_VERSION` / `RISKS_PROMPT_VERSION`). |

### Migration note (existing `Risks` pipeline)
The standalone `Risks` artifact (`pr_brief` table, `GET/POST /pulls/:id/risks`,
`analyzeRisks`) is **superseded** for display: the INTENT-card RISK AREAS now
renders the brief's `risks[]` (AC-3). The existing `pr_brief`/`Risks` rows and
storage are **untouched** (decision 3). **Resolved decision:** the standalone
`GET/POST /pulls/:id/risks` endpoints and `analyzeRisks` are kept **dead-but-present
for one release** — the UI stops calling them (the `IntentCard` `handleRecompute`
intent→risks sequence is rewired to the brief Regenerate), the endpoints remain
in place unused, and their removal is a **separate follow-up**, not part of this
feature. The plan should record the UI rewire and the "leave endpoints in place"
posture; it must NOT delete the risks endpoints.

## Non-functional

- **Performance** — Opening a brief is a single DB read plus an on-read key
  recompute (no network). Generation is one structured LLM call over already-
  computed digests/statistics — no diff re-parse, no raw patch sent, so token cost
  is bounded and far below a full review. Single-flight per PR (AC-11) bounds
  concurrent cost. **Requirement:** zero embedding calls; exactly one LLM call per
  generation; zero LLM calls to open a stored brief (AC-19); degrade by dropping
  missing input sections rather than failing (AC-12).
- **Security** —
  - All assembled inputs (intent, blast summary, smart-diff summaries, issue
    title/body, attached spec contents) are UNTRUSTED repo/author data: wrapped as
    untrusted at prompt assembly with grounding rules so embedded "instructions"
    carry no authority (AC-21, OWASP A05 / Agentic ASI01); the model output is
    rendered as markdown/text **data**, never executable HTML/script (AC-21, OWASP
    A05 XSS) — reuse the app's safe renderer.
  - **Real-path grounding** (AC-4/5) is a correctness AND safety control: the
    model cannot smuggle an arbitrary path into a rendered link; every path is
    validated against the real input file set before persist (Agentic ASI09 —
    validate generated content before storing).
  - **Link safety:** `file:line` links use safe targets only (in-app diff viewer
    for in-diff files; the existing out-of-diff repo-host deep-link for blast
    callers) — no `javascript:`/executable protocols in any href (AC-21, OWASP
    A05).
  - **Access control:** the brief and its generation are workspace-scoped; the
    workspace guard runs BEFORE single-flight coalescing so a foreign-workspace
    caller cannot coalesce onto another tenant's in-flight generation (AC-16,
    OWASP A01; server INSIGHTS: single-flight-behind-workspace-guard).
  - **No secrets:** the feature reads only already-computed artifacts and the LLM
    provider/key comes from the existing secrets/settings path; only token counts
    are logged, never the prompt payload.
- **Accessibility** — Risk expanders and focus links keyboard-operable; correct
  focus order; the PR SCORE gauge has a text equivalent (score value + label, not
  colour alone); Regenerate/Outdated announced via aria-live; usable at narrow
  widths (AC-18).
- **i18n (en + uk)** — Every new UI string via next-intl in both locales; layout
  tolerates uk expansion. Model-authored brief text is content generated in the
  configured language, not a UI string (AC-17).
- **Local-first** — Consistent with DevDigest's local-first model: inputs come
  from the local DB / index / read-only clone; the only external contact is the
  single LLM call the user explicitly triggers (plus the best-effort linked-issue
  fetch, which degrades to "dropped" on failure); the stored brief lives in the
  local Postgres.

## Inputs (provenance)

- `[reused: existing scaffolding]` — the `Review`/`ReviewRecord` verdict/score/
  findings + per-run `cost_usd` (card header — `modules/reviews`, run-cost
  feature); `Intent` (`pr_intent`) + `formatIntentForPrompt`; `BlastRadius` +
  provenance + real files/callers/endpoints (`modules/blast`, `modules/repo-intel`
  facade); `SmartDiff` per-group stats (`modules/smart-diff`); linked-issue
  resolution (`closes|fixes|resolves #N` → `container.github().getIssue`,
  `intent-service.ts`); project-context spec resolution (agent/skill attached
  paths → read from clone, best-effort); `LLMProvider.completeStructured`
  (`response_format: json_schema` + Zod `parseWithRepair` + reprompt; undici-fetch
  fix in the adapters); the freshness-key discipline + `is_stale` contract shape
  (`reviews/freshness.ts`, review-freshness plan); the single-flight-behind-
  workspace-guard + upsert-cache pattern (`onboarding-generator/service.ts`,
  server INSIGHTS 2026-07-05); `formatCost` / `RunCostBadge` (run-cost feature);
  the out-of-diff `githubBlobUrl` / `MonoLink` link pattern (client INSIGHTS
  2026-06-30); the `Risk` shape (`brief.ts`); the existing `IntentCard` RISK AREAS
  render; the "Onboarding Tour" nav item + `g o` shortcut (`nav.ts`).
- `[deterministic: repo-intel]` — the real changed-file/caller/endpoint list that
  grounds `risks[]`/`review_focus[]` comes from the blast impact map via the
  `container.repoIntel` facade. `devdigest_get_blast_radius` /
  `devdigest_get_conventions` were NOT applicable — the DevDigest self-repo is not
  imported into repo-intel (the MCP indexes target review repos, not this
  codebase), consistent with both prior specs; impact was traced by directly
  reading the affected files.
- `[new: exactly 1 LLM call per generation]` — the single structured
  `completeStructured` call for the `Brief`; zero embedding calls; zero LLM calls
  to open a stored brief or to compose the review header.

## Untrusted inputs

- **Assembled brief inputs** (intent text, blast summary, smart-diff file
  summaries, linked-issue title/body, attached spec contents) — repo/author/
  contributor-controlled. Wrapped as untrusted at prompt assembly with grounding
  rules; never interpreted as generation instructions (AC-21).
- **Model-authored brief content** (`what`, `why`, `risks[]`, `review_focus[]`) —
  untrusted generated content: rendered as data (safe markdown/text, no
  HTML/script), paths constrained to real input files (AC-4/5), validated against
  the `Brief` Zod schema before persistence (AC-13). File-link hrefs restricted to
  safe targets (AC-21).
- **`prId` / `workspaceId` in requests** — used to scope the brief to its PR /
  workspace; access denied cross-workspace (AC-16); the workspace guard runs
  before single-flight coalescing (AC-11).

## Dependencies & impacts

- **Affected packages:**
  - `server/` — a new `brief` feature module (routes + service + repository)
    registered in `modules/index.ts`; a deterministic input assembler reading the
    existing intent/blast/smart-diff/issue/project-context facades; the
    single-flight generation orchestrator calling `container.llm.completeStructured`;
    real-path grounding of `risks[]`/`review_focus[]`; a NEW `pr_why_risk_brief`
    table (own migration, `pnpm db:generate`; MANUAL `pnpm db:migrate`); a new
    brief prompt (with untrusted-data + grounding rules) + `BRIEF_PROMPT_VERSION`;
    a new `FeatureModelId` slot + `FEATURE_MODELS` default; a `briefFreshnessKey`
    pure helper (mirrors `reviews/freshness.ts`).
  - `client/` — a new `PrBriefCard` at the top of the Overview tab (body from the
    brief, header composed from the latest review via the existing reviews query),
    a Regenerate icon button, an info affordance, an Outdated badge, and a PR SCORE
    gauge with a text equivalent; a new full-width REVIEW FOCUS section; the
    reworked INTENT-card RISK AREAS (file:line links + expander chevrons) now fed
    by the brief; a `useBrief` / `useRegenerateBrief` hook pair; reuse of
    `formatCost` / `RunCostBadge` and the out-of-diff link pattern; extended
    `messages/en` + `messages/uk` (likely the existing `brief` namespace).
  - `server/src/vendor/shared` — NEW contract file(s): `Brief`, `ReviewFocusItem`,
    the brief input bundle, and the brief read record (`pr_id` + `is_stale`).
    Extend via new files; never edit the existing barrel; sync to the client copy.
  - `reviewer-core/` — likely a new pure brief-prompt builder + `BRIEF_PROMPT_VERSION`
    constant (mirrors intent/risks prompt builders), if the brief prompt is built
    the same way; the hash stays in the server layer (reviewer-core stays pure).
- **Contracts touched:** none broken — `Risk`/`Intent`/`BlastRadius`/`SmartDiff`/
  `Review`/`ReviewRecord` reused unchanged; `FeatureModelId` gains one enum value
  (additive).
- **Blast radius** `[deterministic: repo-intel]` — Not computed: the DevDigest
  self-repo is not imported into repo-intel, so `devdigest_get_blast_radius` /
  `devdigest_get_conventions` return "repository not found". Impact was traced by
  directly reading the affected files above. The most sensitive touch-points are
  the shared reviews facade (read-only consumption of intent/blast/smart-diff/
  review), the project-context spec resolver, and the `IntentCard` (its RISK AREAS
  ownership changes from the standalone `Risks` to the brief).

## Traceability

| AC | Story | Design ref | Verification | Plan phase |
|---|---|---|---|---|
| AC-1 | US-1, US-4 | screenshot 1: PR BRIEF card + Regenerate | integration: Regenerate → input assembled (no diff bodies) + exactly 1 structured call + upsert | — |
| AC-2 | US-2 | screenshot 1: REVIEW FOCUS section | e2e (deterministic): stored brief → ordered focus list with count badge + file:line links | — |
| AC-3 | US-3 | screenshot 1: RISK AREAS rows | e2e (deterministic): RISK AREAS renders brief risks with file:line link + expander | — |
| AC-4 | US-2, US-3 | screenshot 1: real file links | unit (server pnpm test): risks/focus paths grounded to real input files; invented dropped/repaired | — |
| AC-5 | US-2, US-3 | — | unit (server pnpm test): fabricated path not persisted; rest of brief persisted | — |
| AC-6 | US-1 | screenshot 1: card body + risk level | e2e (deterministic): card body shows what/why + risk_level badge + info affordance | — |
| AC-7 | US-1 | screenshot 1: verdict/pill/gauge/cost | unit (client): header composed from latest review (verdict/findings/blockers/score/cost); no review → "—"; 0 LLM | — |
| AC-8 | US-5 | screenshot 1: card states | e2e (deterministic): no brief → Generate body, no LLM on open; header independent | — |
| AC-9 | US-4 | screenshot 1: Regenerate icon | e2e (deterministic): Regenerate recomputes only the brief (no review triggered), refreshes card/risks/focus | — |
| AC-10 | US-4 | screenshot 1: Regenerate | e2e (deterministic): generating → progress shown, control disabled | — |
| AC-11 | US-4 | — | unit (server pnpm test): single-flight per PR behind workspace guard; concurrent Regenerate coalesces; upsert write | — |
| AC-12 | US-1 | — | integration: missing intent/blast/smart-diff/issue/specs dropped best-effort; generation continues | — |
| AC-13 | US-4 | — | unit (server pnpm test): LLM fail / invalid schema → no partial persist, prior brief intact | — |
| AC-14 | US-4 | screenshot 1: Outdated badge | integration: stored key vs current key → Outdated; issue/spec edit not flagged; legacy NULL not stale | — |
| AC-15 | US-1 | — | e2e (deterministic): brief loading state, not blank/error | — |
| AC-16 | all | — | integration: cross-workspace brief read/generation denied; guard before coalescing | — |
| AC-17 | all | screenshot 1 | manual: en + uk strings present, no hardcoded UI text | — |
| AC-18 | US-2, US-3 | screenshot 1: gauge, links, expanders | manual: keyboard expanders/links, focus order, gauge text equivalent, aria-live, narrow-width | — |
| AC-19 | US-1, US-4 | — | integration: open = 0 LLM; generation = exactly 1 LLM, 0 embeddings | — |
| AC-20 | — | screenshot 1: sidebar | e2e (deterministic): "Onboarding Tour" item present (WORKSPACE, between Pull Requests & Project Context) + g o shortcut | — |
| AC-21 | all | screenshot 1: real file links | unit (reviewer-core/server pnpm test): inputs wrapped untrusted; output rendered as data; hrefs safe-protocol only | — |

## [NEEDS CLARIFICATION]

None — all open points are resolved. Approved by the user on 2026-07-05.

Resolved decisions folded into the spec:
- **Standalone `Risks` endpoints' lifecycle** → kept dead-but-present for one
  release (UI stops calling them; removal is a separate follow-up). See the
  "Migration note (existing `Risks` pipeline)" under Contracts.
- **`Brief.risk_level` enum** → exactly `high | medium | low`, aligned with the
  existing `RiskSeverity`; no `critical` level. See the `Brief` document contract.
