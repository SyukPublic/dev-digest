# Development Plan: English-only localization

- **Spec:** none (ACs derived below)
- **Execution mode:** single-agent

## Context

DevDigest already runs as a single-locale `en` product: `client/src/i18n/request.ts`
hardcodes `export const LOCALE = "en"`, there is no locale routing, and no language
switcher exists. Despite that, the repo still carries speculative Ukrainian ("uk")
localization artifacts — a `client/messages/uk/` mirror never loaded at runtime, three
en↔uk parity tests whose sole job is to police that mirror, and doc/rule text that
frames a second locale (or a Settings-driven content-language override) as a
"forward-looking follow-up". This drift invites future work that contradicts the shipped
architecture.

This change makes the English-only decision explicit and removes the speculative
artifacts, in three approved blocks:
- **Block A** — delete the non-English localization artifacts (uk messages, parity
  tests) and fix the docs/rules/comments that referenced them.
- **Block B** — record the English-only localization rule in the project docs.
- **Block C** — add a translation-for-approval workflow rule: replies follow the prompt
  language, but all persisted artifacts are English-only, and a non-English source
  description must first be rendered to English for approval before authoring.

The i18n infrastructure STAYS: `next-intl`, `loadMessages`, `NextIntlClientProvider`,
and the whole `messages/en/**` tree are untouched. No DB/schema/server-logic changes —
server edits are comment-only. `DEFAULT_CONTENT_LANGUAGE = 'English'` is KEPT in both
server modules (it feeds a live prompt-template placeholder); only its doc comments
change.

## Acceptance criteria

- **AC-1** — `client/messages/uk/` no longer exists (its 3 files — `brief.json`,
  `context.json`, `onboarding.json` — are deleted).
- **AC-2** — The three en↔uk parity tests are deleted:
  `client/src/test/brief-i18n.test.ts`, `client/src/test/onboarding-i18n.test.ts`,
  `client/src/test/project-context-i18n.test.ts`.
- **AC-3** — After AC-1 + AC-2, `client` `pnpm test` and `pnpm typecheck` are green
  (no test imports a deleted `messages/uk/*.json`, no dangling reference remains).
- **AC-4** — `.claude/agents/spec-creator.md` design-analysis gap-sweep no longer names a
  "second locale" / "en + uk"; a long-text / text-expansion check is retained.
- **AC-5** — `server/src/modules/brief/constants.ts` and
  `server/src/modules/onboarding-generator/constants.ts` still export
  `DEFAULT_CONTENT_LANGUAGE = 'English'` unchanged; only their doc comments change —
  the "forward-looking follow-up" framing is replaced with an English-only-by-decision
  statement pointing to `AGENTS.md`. No non-comment lines change; both services still
  compile and their tests stay green.
- **AC-6** — `client/README.md` describes messages as living in `messages/en/*.json`
  (no `messages/<locale>/*.json` placeholder implying multiple locales).
- **AC-7** — Root `AGENTS.md` "Conventions (non-default)" section states the English-only
  localization rule (single locale `en`; never add other `messages/<locale>/` dirs;
  LLM-generated content language is English), and the file stays ≤100 lines.
- **AC-8** — `client/AGENTS.md` "Gotchas / rules" UI-strings rule states English is the
  ONLY locale — never add another `messages/<locale>/`.
- **AC-9** — Root `AGENTS.md` working rule about reply language is extended: replies
  follow the prompt language, but ALL persisted artifacts (specs, plans, docs, code,
  commit messages, UI strings) are English-only; a non-English task/spec/design
  description must FIRST be rendered to English for APPROVAL before authoring. File
  stays ≤100 lines.
- **AC-10** — `.claude/agents/spec-creator.md` interview-first stage carries a blocking
  gate: a non-English source description → present the English rendering of the
  requirements as a blocking question, get approval, only then draft the spec.
- **AC-11** — `.claude/agents/implementation-planner.md` and
  `.claude/agents/simple-implementation-planner.md` carry the same gate for the case
  where the planner derives requirements/ACs from a non-English request — applied ON TOP
  OF the current uncommitted working-tree content (existing local modifications are
  preserved, never reverted).
- **AC-12** — Repo-wide, no references to `messages/uk` remain outside `docs/specs/`,
  `docs/plans/`, and `docs/retros/` (the immutable historical records).

## Affected packages & files

- `client/messages/uk/` — DELETE the whole directory (3 files: `brief.json`,
  `context.json`, `onboarding.json`). Never loaded at runtime.
- `client/src/test/brief-i18n.test.ts`,
  `client/src/test/onboarding-i18n.test.ts`,
  `client/src/test/project-context-i18n.test.ts` — DELETE. Each imports a
  `../../messages/uk/*.json` file and exists solely for en↔uk parity (confirmed: no other
  file references these tests).
- `client/README.md` (line 9-10) — edit the `next-intl` bullet: `messages/<locale>/*.json`
  → `messages/en/*.json`.
- `client/AGENTS.md` (Gotchas / rules, line 17) — extend the UI-strings rule with the
  English-only clause.
- `server/src/modules/brief/constants.ts` (doc comment, lines 1-8) — rewrite the comment;
  KEEP `export const DEFAULT_CONTENT_LANGUAGE = 'English'` (line 9) verbatim.
- `server/src/modules/onboarding-generator/constants.ts` (doc comment, lines 39-42) —
  rewrite the comment; KEEP `export const DEFAULT_CONTENT_LANGUAGE = 'English'` (line 43)
  verbatim.
- `AGENTS.md` (root) — Conventions (non-default) section (lines 68-70) + Working rule
  reply-language bullet (line 27). Budget: ≤100 lines (currently 78) — keep wording tight;
  merging into an existing bullet is acceptable.
- `.claude/agents/spec-creator.md` — design-analysis gap sweep (line 150) + interview
  model / interview call (lines 107-137).
- `.claude/agents/implementation-planner.md` — stop-and-ask / requirements-review /
  Reply-language sections (WARNING: uncommitted local mods — edit on top of current
  working-tree content).
- `.claude/agents/simple-implementation-planner.md` — clarify-the-requirement /
  Reply-language sections (WARNING: uncommitted local mods — edit on top of current
  working-tree content).

Reuse / do-not-touch notes:
- `DEFAULT_CONTENT_LANGUAGE` is imported and used live by `server/src/modules/brief/service.ts:12,100`
  and `server/src/modules/onboarding-generator/service.ts:15,120` (`language: DEFAULT_CONTENT_LANGUAGE`).
  Do NOT rename, retype, or remove it — comment-only edits.
- `client/src/i18n/request.ts` (`LOCALE = "en"`, `loadMessages`) — STAYS unchanged; it is
  the single-locale infrastructure that this decision codifies, not removes.
- OUT OF SCOPE (immutable historical records — must NOT be touched): the 9 files under
  `docs/specs/` and `docs/plans/` that mention uk parity, and anything under `docs/retros/`.

## Ground-truth excerpts (verbatim, for the implementer)

**`server/src/modules/brief/constants.ts` (current, lines 1-9) — comment to rewrite, const to KEEP:**
```ts
/**
 * brief module constants — the fixed knobs for the Why+Risk Brief producer.
 *
 * The content language handed to the system prompt (rendered via
 * `renderPrompt('why-risk-brief.system.md', { language })`). Single-locale
 * runtime today (`English`); a Settings-driven override is a forward-looking
 * follow-up (mirrors onboarding-generator's `DEFAULT_CONTENT_LANGUAGE`).
 */
export const DEFAULT_CONTENT_LANGUAGE = 'English';
```

**`server/src/modules/onboarding-generator/constants.ts` (current, lines 39-43) — comment to rewrite, const to KEEP:**
```ts
/**
 * The content language for generated titles/body (AC-18). Single-locale runtime
 * today (`en`); a Settings-driven override is a forward-looking follow-up.
 */
export const DEFAULT_CONTENT_LANGUAGE = 'English';
```

**`client/README.md` (current, lines 9-10) — the `<locale>` to fix:**
```
- **Stack:** Next.js 15 (App Router), React 19, TanStack Query, `next-intl`
  (messages in `messages/<locale>/*.json`), `recharts`, `mermaid`,
```

**`client/AGENTS.md` (current, line 17) — the UI-strings rule to extend:**
```
- UI strings go through next-intl (`messages/en/*.json`), not hardcoded text.
```

**Root `AGENTS.md` (current, line 27) — the working rule to extend:**
```
- Reply in the language the question/task was asked in; keep code, identifiers, and paths verbatim.
```

**Root `AGENTS.md` (current, lines 68-70) — the Conventions section to extend:**
```
## Conventions (non-default)
- Secrets never in git/DB → `~/.devdigest/secrets.json` (0600) via `LocalSecretsProvider`.
- Extend `@devdigest/shared` with NEW files; never edit the existing barrel.
```

**`.claude/agents/spec-creator.md` (current, lines 148-154) — the gap-sweep bullet to fix:**
```
2. **Gap sweep** — for each screen, check what the design does NOT show:
   - loading / empty / error / partial-data states
   - long text and the second locale (next-intl: en + uk — text expansion)
   - accessibility (focus order, aria-live for async updates, contrast)
   - responsive behavior
   - permission / authz states
   - concurrent updates / staleness
```

**`.claude/agents/spec-creator.md` (current, lines 112-119) — the interview model where the C-block gate attaches:**
```
1. **Interview call.** Read the sources (Read-when table below). If BLOCKING
   questions remain — scope-defining decisions you cannot responsibly default —
   return ONLY the "Clarification needed" block and STOP. Write no file. If
   nothing blocks, proceed straight to drafting in the same call.
```
(spec-creator already requires the spec itself to be English — Hard constraint at line 48.)

**Planner Reply-language sections where the C-block gate attaches (both files, current
working tree):** `.claude/agents/implementation-planner.md` "Reply language" (lines 332-339)
and `.claude/agents/simple-implementation-planner.md` "Reply language" (lines 216-222) — both
currently read:
```
Follow the project rule ([AGENTS.md](../../AGENTS.md)): detect the natural
language of the request and reply in that same language. Keep code, identifiers,
file paths, CLI commands, and quoted strings verbatim. ...
```
The AC-derivation entry points to also cover: implementation-planner does not itself derive
ACs (spec-gated), but its stop-and-ask (lines 95-115) is the natural gate host;
simple-implementation-planner derives ACs from the request in its "Clarify the requirement"
step (lines 102-110). The gate must fire wherever a non-English request is turned into
English ACs/plan prose.

## Tasks

### Phase 1 — Block A: remove uk artifacts (client)
- **Surface:** client
- **Skills to apply:** react-frontend-architecture, react-testing-library (deletion of test
  files — confirm suite still green), next-best-practices (i18n infra stays intact)
- **What changes & why:** Delete the never-loaded `client/messages/uk/` mirror and the three
  en↔uk parity tests that import it (their only purpose). Removes the speculative second-locale
  footprint. The `messages/en/**` tree, `request.ts`, and `next-intl` wiring are untouched.
- **How to test:** From WSL —
  `wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc 'cd /mnt/e/Sources/NeoVersity/Projects/AIAgenticEngineering/dev-digest/client && pnpm test'`
  then the same with `pnpm typecheck`. Both must be green; the deleted parity specs must no
  longer appear in the vitest run, and no test may fail on a missing `messages/uk/*.json` import.
- [x] T1  `client/messages/uk/{brief.json,context.json,onboarding.json}` and the directory are deleted  → AC-1  → test_client_suite_green
- [x] T2  `client/src/test/{brief-i18n,onboarding-i18n,project-context-i18n}.test.ts` are deleted  → AC-2  → test_client_suite_green
- [x] T3  `client` `pnpm test` and `pnpm typecheck` pass with the deletions in place (no dangling uk import)  → AC-3  → test_client_suite_green

### Phase 2 — Block A: comment & doc fixes (server + client docs)
- **Surface:** server (comment-only) + client docs
- **Skills to apply:** onion-architecture (confirm comment-only, no layering/logic change),
  typescript-expert (server constants stay type-identical)
- **What changes & why:** Rewrite the two server `constants.ts` doc comments so they state
  the project is English-only by decision (pointing to `AGENTS.md`) instead of framing a
  Settings-driven language override as a "forward-looking follow-up". `DEFAULT_CONTENT_LANGUAGE = 'English'`
  is KEPT verbatim in both (it feeds a live prompt placeholder). Fix `client/README.md` so the
  `next-intl` bullet says `messages/en/*.json`, not `messages/<locale>/*.json`.
- **How to test:** From WSL —
  `wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc 'cd /mnt/e/Sources/NeoVersity/Projects/AIAgenticEngineering/dev-digest/server && pnpm typecheck && pnpm test'`
  (comment-only edits — server tests must stay green). `client/README.md` change is prose; verify
  by grep that no `messages/<locale>` placeholder remains in it.
- [x] T4  `server/src/modules/brief/constants.ts` doc comment states English-only-by-decision (see AGENTS.md); `DEFAULT_CONTENT_LANGUAGE = 'English'` unchanged  → AC-5  → test_server_suite_green
- [x] T5  `server/src/modules/onboarding-generator/constants.ts` doc comment states English-only-by-decision (see AGENTS.md); `DEFAULT_CONTENT_LANGUAGE = 'English'` unchanged  → AC-5  → test_server_suite_green
- [x] T6  `client/README.md` `next-intl` bullet reads `messages/en/*.json` (no `<locale>` placeholder)  → AC-6  → test_grep_no_locale_placeholder

### Phase 3 — Block A: spec-creator gap-sweep fix (agent meta)
- **Surface:** cross-cutting (agent prompt)
- **Skills to apply:** none code-specific (prompt-doc edit)
- **What changes & why:** In `.claude/agents/spec-creator.md` gap-sweep (line 150), drop the
  "and the second locale (next-intl: en + uk — text expansion)" clause; KEEP a long-text /
  text-expansion check (e.g. "long text / text expansion (localization is English-only, so
  budget for long English strings)"). No other gap-sweep item changes.
- **How to test:** Grep the file: the phrase `en + uk` / `second locale` is gone; a long-text /
  text-expansion bullet remains under the gap sweep.
- [x] T7  spec-creator gap-sweep drops the second-locale clause, retains a long-text/text-expansion check  → AC-4  → test_grep_speccreator_gapsweep

### Phase 4 — Block B: record the English-only rule (project docs)
- **Surface:** cross-cutting (project docs)
- **Skills to apply:** none code-specific (docs edit)
- **What changes & why:** Add the English-only localization rule to root `AGENTS.md`
  "Conventions (non-default)" (single locale `en`; never add other `messages/<locale>/` dirs;
  LLM-generated content language is English) — tight wording, merging into an existing bullet is
  acceptable, keep the file ≤100 lines. Extend `client/AGENTS.md` UI-strings rule (line 17) with:
  English is the ONLY locale — never add another `messages/<locale>/`.
- **How to test:** Read both files; confirm the rules are present and root `AGENTS.md`
  is ≤100 lines: `wsl.exe -d ... -- bash -lc 'wc -l .../AGENTS.md'` (must report ≤100).
- [x] T8  Root `AGENTS.md` Conventions section states the English-only localization rule; file ≤100 lines  → AC-7  → test_grep_root_agents_english_only
- [x] T9  `client/AGENTS.md` UI-strings rule states English is the only locale (never add another `messages/<locale>/`)  → AC-8  → test_grep_client_agents_english_only

### Phase 5 — Block C: translation-for-approval workflow rule (root AGENTS.md + 3 agents)
- **Surface:** cross-cutting (project docs + agent meta)
- **Skills to apply:** none code-specific (docs / prompt edits)
- **What changes & why:** Extend the root `AGENTS.md` reply-language working rule (line 27):
  replies follow the prompt language, but ALL persisted artifacts (specs, plans, docs, code,
  commit messages, UI strings) are English-only; a non-English task/spec/design description must
  FIRST be rendered to English for APPROVAL, then authored — tight wording, keep ≤100 lines. Add
  the same blocking gate to `.claude/agents/spec-creator.md` interview-first stage (non-English
  source → present English rendering as a blocking question, approve, then draft; the spec is
  already required to be English there). Add the equivalent gate to
  `.claude/agents/implementation-planner.md` and `.claude/agents/simple-implementation-planner.md`
  for the case where the planner derives requirements/ACs from a non-English request — editing ON
  TOP OF the current uncommitted working-tree content (do NOT revert local mods).
- **How to test:** Read each file; grep for the translation-for-approval gate wording in all four;
  re-confirm root `AGENTS.md` ≤100 lines after this phase's edit
  (`wsl.exe -d ... -- bash -lc 'wc -l .../AGENTS.md'`). `git status` / `git diff` on the two
  planner files must show ONLY additive gate edits layered over the pre-existing uncommitted mods
  (no reverted hunks).
- [x] T10  Root `AGENTS.md` reply-language rule extended: prompt-language replies but English-only persisted artifacts + translate-for-approval-first; file ≤100 lines  → AC-9  → test_grep_root_agents_translation_gate
- [x] T11  `.claude/agents/spec-creator.md` interview-first stage carries the non-English → English-rendering-for-approval blocking gate  → AC-10  → test_grep_speccreator_translation_gate
- [x] T12  `.claude/agents/implementation-planner.md` and `.claude/agents/simple-implementation-planner.md` carry the same gate, layered on their current uncommitted content (no reverted mods)  → AC-11  → test_grep_planners_translation_gate

### Phase 6 — Final gate: repo-wide uk-reference sweep
- **Surface:** cross-cutting (verification)
- **Skills to apply:** none (grep gate)
- **What changes & why:** No edits — a verification-only sweep confirming no `messages/uk`
  reference survives outside the immutable history dirs. This is the acceptance gate for the
  whole plan and MUST run after Phases 1-5.
- **How to test:** From WSL, run a repo-wide ripgrep for `messages/uk` (and `messages\uk`)
  excluding `docs/specs`, `docs/plans`, `docs/retros`:
  `wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc 'cd /mnt/e/Sources/NeoVersity/Projects/AIAgenticEngineering/dev-digest && rg -n "messages/uk|messages\\\\uk" --glob "!docs/specs/**" --glob "!docs/plans/**" --glob "!docs/retros/**"'`
  — expected result: NO matches (exit 1 / empty output). Also confirm `client` `pnpm test` +
  `pnpm typecheck` and `server` `pnpm test` + `pnpm typecheck` are all green.
- [x] T13  Repo-wide grep finds zero `messages/uk` references outside docs/specs, docs/plans, docs/retros; client+server suites green  → AC-12, AC-3, AC-5  → test_grep_no_uk_reference

## Traceability matrix
| AC    | Task | Test                                  | Commit |
|-------|------|---------------------------------------|--------|
| AC-1  | T1   | test_client_suite_green               | —      |
| AC-2  | T2   | test_client_suite_green               | —      |
| AC-3  | T3   | test_client_suite_green               | —      |
| AC-4  | T7   | test_grep_speccreator_gapsweep        | —      |
| AC-5  | T4   | test_server_suite_green               | —      |
| AC-5  | T5   | test_server_suite_green               | —      |
| AC-6  | T6   | test_grep_no_locale_placeholder       | —      |
| AC-7  | T8   | test_grep_root_agents_english_only    | —      |
| AC-8  | T9   | test_grep_client_agents_english_only  | —      |
| AC-9  | T10  | test_grep_root_agents_translation_gate| —      |
| AC-10 | T11  | test_grep_speccreator_translation_gate| —      |
| AC-11 | T12  | test_grep_planners_translation_gate   | —      |
| AC-12 | T13  | test_grep_no_uk_reference             | —      |
<Commit is "—" at planning time; the implementer fills it as tasks land.>

## Risks & mitigations

- **Reverting uncommitted planner mods (HIGH).** `implementation-planner.md` and
  `simple-implementation-planner.md` carry uncommitted working-tree changes. A wholesale
  rewrite would silently drop them. Mitigation: Phase 5 mandates reading the CURRENT
  working-tree content first and applying additive `Edit`s only; T12's test checks the
  `git diff` shows only additive gate hunks, no reverted lines.
- **`DEFAULT_CONTENT_LANGUAGE` accidentally changed (HIGH).** It is a live prompt input
  (`service.ts` line 100 / 120), not dead scaffolding. Mitigation: Phase 2 tasks are
  comment-only; the plan embeds the verbatim const line to keep untouched; server `pnpm test`
  is the guard.
- **Root `AGENTS.md` ≤100-line budget breach (MEDIUM).** Two separate additions (Block B rule +
  Block C rule) both land in a file with a hard 100-line cap (currently 78). Mitigation: T8 and
  T10 each re-check `wc -l ≤ 100`; wording is tight and may merge into existing bullets.
- **Touching immutable history dirs (MEDIUM).** `docs/specs/`, `docs/plans/`, `docs/retros/`
  contain uk-parity mentions that must NOT change. Mitigation: those paths are explicitly
  out-of-scope in "Affected packages & files"; the Phase 6 grep gate excludes them precisely so
  it does not flag them.
- **A hidden consumer of the deleted parity tests / uk files (LOW).** Mitigation: grep confirmed
  the three test files are self-contained and nothing else imports `messages/uk`; T3 + T13 catch
  any surprise via the green-suite and repo-wide grep gates.

## Critical files for implementation

- `client/messages/uk/` (delete) + `client/src/test/{brief-i18n,onboarding-i18n,project-context-i18n}.test.ts` (delete)
- `server/src/modules/brief/constants.ts` and `server/src/modules/onboarding-generator/constants.ts` (comment-only)
- `AGENTS.md` (root — Conventions + reply-language rule; ≤100-line budget)
- `.claude/agents/spec-creator.md` (gap-sweep + interview gate)
- `.claude/agents/implementation-planner.md` + `.claude/agents/simple-implementation-planner.md`
  (translation gate on top of uncommitted mods)

## Open questions / assumptions

- **Assumption:** the "English-only by decision" pointer in the server constants comments points
  to root `AGENTS.md` (where Block B records the rule) — consistent with the task's "point to
  AGENTS.md".
- **Assumption:** `docs/retros/` counts among the immutable history dirs for the Phase 6 grep
  exclusion (the task named docs/specs, docs/plans, docs/retros history as allowed to retain uk
  references). No `messages/uk` match was actually found under `docs/retros/` at plan time, but the
  exclusion is kept for safety.
- **Assumption:** the two planner agents' uncommitted mods are intended to stay; this plan only
  adds the translation gate and never reverts them (per the task warning).
- **Out of scope (confirmed):** next-intl removal, `loadMessages`/`request.ts`/`NextIntlClientProvider`
  changes, any DB/schema/server-logic change, and user-memory writes (already done by the caller).
