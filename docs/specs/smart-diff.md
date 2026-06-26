# Development Plan: Smart Diff

## Context

Smart Diff is an L03 course lab (`labs/l03`). Goal: render a PR's "Files changed"
diff in a **deterministic, risk-ordered** layout so a reviewer's eye lands on
business logic first. Each changed file is classified into one of three roles —
**core** (business logic), **wiring** (configs/entry/barrel files), **boilerplate**
(lock files, dist, snapshots, generated) — and shown grouped, with boilerplate
collapsed by default. On top of that layout an **overlay** from the latest AI
review adds: an "N findings" badge on files with findings, line highlighting, and
click-to-jump to a finding's line.

**THE KEY PRINCIPLE (non-negotiable, repeated in the task three times):** at the
Smart Diff step there is **NO new LLM/model call**. The expensive call already
happened in the Structured Reviewer. Smart Diff ONLY deterministically composes
**already-stored** PR files + **already-stored** findings. Any phase here that calls
an LLM is wrong. (`pseudocode_summary` is therefore `null` for now — see Phase A.)

Everything needed already exists and is verified:
- The contract `SmartDiff` / `SmartDiffResponse` is already defined and exported
  (`server/src/vendor/shared/contracts/brief.ts:80-113`,
  `review-api.ts:67-69`, barrel `vendor/shared/index.ts:19`). **Do not recreate or
  edit it.**
- PR files come from `container.reviewRepo.getPrFiles(prId)` — already on the repo
  facade (`server/src/modules/reviews/repository.ts:39-41`), reading `pr_files`
  (`server/src/db/schema/pulls.ts:36-45`).
- Findings come from `container.reviewRepo.reviewsForPull(prId)` — already on the
  repo facade (`repository.ts:63-66`), implemented at
  `repository/review.repo.ts:58-73`, newest-first.

No new DB table, no migration, no contract change, no new repository method.

## Affected packages & files

**server/** (Phases A, B)
- CREATE `server/src/modules/smart-diff/constants.ts` — pattern lists + thresholds (Phase A).
- CREATE `server/src/modules/smart-diff/classify.ts` — pure classification helper (Phase A).
- CREATE `server/src/modules/smart-diff/compose.ts` — pure composition into the `SmartDiff` shape (Phase A).
- CREATE `server/src/modules/smart-diff/service.ts` — orchestration: load files + latest-review findings, call compose (Phase B).
- CREATE `server/src/modules/smart-diff/routes.ts` — `GET /pulls/:id/smart-diff` transport (Phase B).
- EDIT `server/src/modules/index.ts` — register the new module (one import + one entry; Phase B).
- CREATE `server/test/smart-diff-classify.test.ts` — unit tests for classify + compose (Phase A).
- CREATE `server/test/smart-diff.it.test.ts` — DB-backed route test, with/without review (Phase B).
- REUSE (do NOT modify): `ReviewRepository.getPull / getPrFiles / reviewsForPull`
  (`repository.ts:31-66`), `getContext` (`modules/_shared/context.ts`), `IdParams`
  (`modules/_shared/schemas.ts`), `NotFoundError` (`platform/errors.ts`),
  `SmartDiffResponse` from `@devdigest/shared`.

**client/** (Phases C, D)
- EDIT `client/src/lib/hooks/reviews.ts` — add `usePrSmartDiff(prId)` hook (Phase C).
- EDIT `client/messages/en/shell.json` — extend the `diffViewer` block with Smart Diff strings (Phase C).
- CREATE `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx` — the grouped viewer (Phase D).
- CREATE `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/index.ts` — narrow entry point (Phase D).
- CREATE `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/helpers.ts` — pure join/merge helpers (Phase D).
- CREATE `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.test.tsx` — RTL tests (Phase D).
- EDIT `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx` — add the Smart/Original toggle (Phase D).
- REUSE (do NOT modify): `parsePatch` + `Line` (`client/src/components/diff-viewer/helpers.ts`),
  `CodeLine` (`client/src/components/diff-viewer/CodeLine/CodeLine.tsx`),
  `DiffViewer` (`client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx`),
  `Card`/`SectionLabel`/`Toggle`/`Badge`/`Icon` from `@devdigest/ui`,
  `SEV` tokens (`client/src/vendor/ui/primitives/tokens.ts:6-14`),
  `usePullDetail` (`client/src/lib/hooks/core.ts:114`),
  `usePrReviews` (`client/src/lib/hooks/reviews.ts:51-57`).

## Shared scaffold (context pack)

Lift these VERBATIM so parallel implementers do not re-open the source files.

### S1 — The contract (already defined; import, never redeclare)

From `server/src/vendor/shared/contracts/brief.ts:80-113`:
```ts
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export const SmartDiffGroup = z.object({ role: SmartDiffRole, files: z.array(SmartDiffFile) });
export const ProposedSplit = z.object({ name: z.string(), files: z.array(z.string()) });
export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
```
And `review-api.ts:67-69`: `export const SmartDiffResponse = SmartDiff;`
Both `SmartDiff` and `SmartDiffResponse` are re-exported by the barrel — import via
`import { SmartDiffResponse } from '@devdigest/shared'`.

### S2 — Backend data sources (verified shapes)

- `pr_files` row (`server/src/db/schema/pulls.ts:36-45`): `{ id, prId, path, additions, deletions, patch /* text | null */ }`.
  Repo: `container.reviewRepo.getPrFiles(prId): Promise<(typeof t.prFiles.$inferSelect)[]>`
  (`repository.ts:39-41`).
- `findings` row (`server/src/db/schema/reviews.ts:28-46`): `{ reviewId, file, startLine, endLine, severity, category, title, dismissedAt /* nullable */, ... }`.
  Repo: `container.reviewRepo.reviewsForPull(prId): Promise<{ review: ReviewRow; findings: FindingRow[] }[]>`,
  **newest-first** (`repository/review.repo.ts:58-73`).
- "Latest review" = the FIRST element of `reviewsForPull(...)` where `review.kind === 'review'`
  (`reviews.kind` enum is `['summary','review']`, `schema/reviews.ts:20`). Exclude
  findings with `dismissedAt !== null`.
- Path matching: `findings.file` and `pr_files.path` are the SAME repo-relative
  path string (e.g. `src/config.ts`). Verified in `server/test/reviews.it.test.ts:89-96`
  where the same `src/config.ts` is both the `pr_files.path` and the finding `file`.
  Match by exact `===`.

### S3 — The reviews-module route template (intent/risks GET routes live INSIDE reviews)

From `server/src/modules/reviews/routes.ts:113-121` (the structural template to copy):
```ts
app.get(
  '/pulls/:id/intent',
  { schema: { params: IdParams, response: { 200: PrIntentRecord.nullable() } } },
  async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getIntent(workspaceId, req.params.id);
  },
);
```
Plugin skeleton (`routes.ts:19-23`): `export default async function <name>Routes(appBase) { const app = appBase.withTypeProvider<ZodTypeProvider>(); const { container } = app; const service = new <Name>Service(container); ... }`.
Imports the route needs: `getContext` from `../_shared/context.js`, `IdParams` from
`../_shared/schemas.js`, `NotFoundError` from `../../platform/errors.js`.

### S4 — Service workspace-scope guard pattern (copy verbatim, drop the LLM bits)

From `server/src/modules/reviews/service.ts:196-209` (`getIntent`): the read path
does ONLY `const pull = await this.repo.getPull(workspaceId, prId); if (!pull) throw new NotFoundError('Pull request not found');`
then reads via repo methods and shapes the response. Smart Diff's service mirrors
this guard, then calls `getPrFiles` + `reviewsForPull` + the pure `compose`. No
`loadDiff`, no `classifyIntent`/`analyzeRisks` (those are the LLM calls — omit them).

### S5 — Module registration (one import + one entry)

`server/src/modules/index.ts:1-37` — add `import smartDiff from './smart-diff/routes.js';`
beside the others and `smartDiff,` in the `modules` record. Nothing else changes.

### S6 — Client hook template

From `client/src/lib/hooks/reviews.ts:171-177` (`usePrIntent`):
```ts
export function usePrSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiffResponse>(`/pulls/${prId}/smart-diff`),
    enabled: prId != null,
  });
}
```
Import `SmartDiffResponse` from `@devdigest/shared` in the existing type-import block
(`reviews.ts:7-15`).

### S7 — Collapsible FileCard pattern (no Accordion primitive exists — copy this)

From `client/src/components/diff-viewer/FileCard/FileCard.tsx:35-39, 55-75`:
```tsx
const [open, setOpen] = React.useState(/* default-open rule */);
const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);
// header: <div onClick={() => setOpen(o => !o)} style={s.fileHeader}>
//   <Icon.ChevronRight size={13} style={chevronFor(open)} /> ... </div>
// body:   {open && <div>{lines.map((ln, i) => <CodeLine key={i} ln={ln} path={file.path} threads={[]} />)}</div>}
```
`parsePatch(patch: string | null | undefined): Line[]` returns `[]` for null/binary
patches (`diff-viewer/helpers.ts:11-13`). `CodeLine` accepts `threads={[]}` and no
`commenting` for a read-only render (`CodeLine/CodeLine.tsx:12-22`). `Line` carries
`newNo`/`oldNo` per line — used for the click-to-jump scroll target.

### S8 — Severity tokens + RTL mocking convention

- `SEV` map (`client/src/vendor/ui/primitives/tokens.ts:6-14`): keyed by
  `Severity = "CRITICAL" | "WARNING" | "SUGGESTION" | "INFO"`, each `{ c, bg, icon, label }`
  using CSS vars (`var(--crit)` etc.). Screenshot labels map: **CRITICAL → "blocker"**,
  **WARNING → "warning"**, **SUGGESTION → "suggestion"**.
- RTL convention in this repo (NOT MSW): mock the hook module with `vi.mock("@/lib/hooks/reviews", ...)`
  and `vi.mock("@/lib/hooks/core", ...)`, set mutable module-level fixtures, wrap in
  `<NextIntlClientProvider locale="en" messages={{ shell: messages }}>`. Template:
  `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.test.tsx:1-102`.

## Phases

### Phase A — Backend pure classification + composition (+ unit tests)
- **Surface:** server (backend)
- **Disjoint scope (OWNS these files):**
  - `server/src/modules/smart-diff/constants.ts`
  - `server/src/modules/smart-diff/classify.ts`
  - `server/src/modules/smart-diff/compose.ts`
  - `server/test/smart-diff-classify.test.ts`
- **Depends on:** none (can start immediately, in parallel with Phase C).
- **Skills to apply:** `onion-architecture` (these are pure inner helpers — zero IO,
  zero DB, zero LLM), `typescript-expert`, `zod` (only to import the inferred types).
- **What changes & why:** The deterministic brain of Smart Diff, isolated from IO so
  it is unit-testable without a DB and reusable by the service.
  - `constants.ts` — exported, named pattern lists + thresholds, the SINGLE place
    they live:
    - `BOILERPLATE_PATTERNS`: lock files (`pnpm-lock.yaml`, `package-lock.json`,
      `yarn.lock`, `*.lock`), build output (`dist/`, `build/`, `out/`, `.next/`),
      snapshots (`*.snap`, `__snapshots__/`), generated (`*.min.js`, `*.map`,
      `*.generated.*`, `node_modules/`).
    - `WIRING_PATTERNS`: config (`*.config.*`, `tsconfig*.json`, `.eslintrc*`,
      `*.yml`/`*.yaml` CI under `.github/`), entry/barrel (`index.ts`/`index.tsx`,
      `server.ts`, `app.ts`, `main.ts`), other top-level `*.json` config, dotfiles.
    - `core` is the DEFAULT (anything not matched — real `src/**` logic).
    - Thresholds: `SPLIT_TOO_BIG_LINES = 500` (tune-comment it), `LARGE_FILE_LINES = 300`
      (the "size signal" that can nudge an ambiguous file). Keep each value documented
      with a one-line rationale.
  - `classify.ts` — `export function classifyFile(path: string, additions: number, deletions: number): SmartDiffRole`.
    Pure, deterministic, case-insensitive on the path; boilerplate wins over wiring
    wins over core (most-specific first). The size signal only affects the
    boilerplate/wiring tie-break, never overrides an explicit pattern. Import
    `SmartDiffRole` type from `@devdigest/shared`.
  - `compose.ts` — `export function composeSmartDiff(files, findingsByPath): SmartDiff`
    where `files: { path; additions; deletions }[]` and
    `findingsByPath: Map<string, number[]>` (the latest-review, non-dismissed finding
    line numbers per path; see Phase B for how it is built). Logic:
    - Group files by `classifyFile(...)` into the three `SmartDiffGroup`s; emit groups
      in fixed order `core, wiring, boilerplate` and OMIT a group with zero files (or
      keep empty groups — pick one and document; recommended: omit empties so the UI
      renders only present roles).
    - `finding_lines` per file = `findingsByPath.get(path) ?? []` (sorted, de-duped).
    - `pseudocode_summary` = `null` for every file (honors the KEY PRINCIPLE — no LLM
      here). Documented as a deliberate fidelity tradeoff vs. the screenshot's "What
      this does" prose; the client renders it conditionally so a future lab can fill it.
    - `split_suggestion`: `total_lines = Σ(additions + deletions)`;
      `too_big = total_lines > SPLIT_TOO_BIG_LINES`; `proposed_splits` = a non-LLM
      heuristic grouping file paths by their TOP-LEVEL directory segment (e.g. `server/`,
      `client/`), each split `{ name: dir, files: string[] }`, emitted only when
      `too_big` is true and there are ≥2 distinct top-level dirs (else `[]`).
    Returns a value that satisfies `SmartDiff` exactly (no extra keys). Import the
    `SmartDiff` type from `@devdigest/shared`.
- **`finding_lines` decision (justify):** map EACH finding to the inclusive range
  `[startLine..endLine]` (the contract carries a flat `number[]`, and the UI highlights
  every covered line + jumps to the first). Clamp to `startLine <= endLine`; if
  `endLine < startLine` fall back to `[startLine]`. De-dupe and sort ascending.
- **Acceptance criteria:**
  - `classifyFile` returns `boilerplate` for `pnpm-lock.yaml`, `dist/x.js`,
    `__snapshots__/a.snap`; `wiring` for `next.config.ts`, `server/src/index.ts`,
    `tsconfig.json`; `core` for `server/src/modules/reviews/service.ts`.
  - `composeSmartDiff` groups in `core, wiring, boilerplate` order, attaches the right
    `finding_lines` per path, sets every `pseudocode_summary` to `null`, computes
    `total_lines` as the additions+deletions sum, and toggles `too_big` at the
    threshold boundary.
  - With no findings (`findingsByPath` empty), every `finding_lines` is `[]` and the
    structure is otherwise identical.
  - The returned object `SmartDiff.parse(result)` succeeds (round-trips the contract).
- **How to test:** `server/test/smart-diff-classify.test.ts`, a pure unit test
  (NO `.it.` suffix, no Docker). Run via WSL:
  `wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc 'cd /mnt/e/Sources/NeoVersity/Projects/AIAgenticEngineering/dev-digest/server && pnpm exec vitest run smart-diff-classify'`.
  Also `pnpm typecheck` in `server/`. Assert `SmartDiff.parse(...)` to prove contract
  conformance.

### Phase B — Backend service + route + module wiring (+ integration test)
- **Surface:** server (backend)
- **Disjoint scope (OWNS these files):**
  - `server/src/modules/smart-diff/service.ts`
  - `server/src/modules/smart-diff/routes.ts`
  - `server/src/modules/index.ts` (one import + one entry — see S5)
  - `server/test/smart-diff.it.test.ts`
- **Depends on:** Phase A (imports `classifyFile`/`composeSmartDiff`/constants). The
  service can be stubbed against Phase A's signatures, but the green test needs A
  merged. Treat **A → B** as a real ordering dependency.
- **Skills to apply:** `onion-architecture` (route = thin edge: context + parse + one
  service call; service = orchestration calling existing repos; NO new repository,
  NO Drizzle here), `fastify-best-practices` (route via `withTypeProvider<ZodTypeProvider>`,
  `IdParams` params schema, `response: { 200: SmartDiffResponse }`), `drizzle-orm-patterns`
  (confirms: no new query — reuse `getPrFiles` + `reviewsForPull`), `security`
  (workspace-scope guard via `getPull` prevents cross-tenant IDOR; input is the path
  param `:id` only, parsed by `IdParams`).
- **Placement decision (justified):** Create a NEW `server/src/modules/smart-diff/`
  module rather than adding the route to `reviews`. Onion reasoning: Smart Diff is a
  distinct read-only use case with its own pure inner helpers (classify/compose) and
  zero overlap with the review-run orchestration that `reviews` owns; a new module
  keeps cohesion high and lets it be registered with one line in `modules/index.ts`
  (the documented "new feature = new module" convention, `server/AGENTS.md:44`). It
  REUSES the shared `reviews` data via the published facade `container.reviewRepo.*`
  (respecting facade boundaries, `onion-architecture` rule 7) — it does NOT deep-import
  reviews internals and adds NO repository of its own.
- **What changes & why:**
  - `service.ts` — `class SmartDiffService { constructor(private container: Container) {} }`
    with `async getSmartDiff(workspaceId: string, prId: string): Promise<SmartDiff>`:
    1. `const pull = await this.container.reviewRepo.getPull(workspaceId, prId); if (!pull) throw new NotFoundError('Pull request not found');` (S4 guard — workspace scope + 404).
    2. `const files = await this.container.reviewRepo.getPrFiles(prId);`
    3. `const reviews = await this.container.reviewRepo.reviewsForPull(prId);`
    4. Pick latest: `const latest = reviews.find(r => r.review.kind === 'review');`
       Build `findingsByPath`: for `latest?.findings ?? []`, skip `dismissedAt !== null`,
       expand `[startLine..endLine]` per finding (Phase A range rule), accumulate into a
       `Map<string, number[]>` keyed by `finding.file`. When there is no `latest`, the
       map is empty.
    5. `return composeSmartDiff(files.map(f => ({ path: f.path, additions: f.additions, deletions: f.deletions })), findingsByPath);`
    No LLM, no `loadDiff`. Keep the function pure-of-side-effects beyond the two reads.
  - `routes.ts` — copy S3 verbatim, one route:
    ```ts
    app.get(
      '/pulls/:id/smart-diff',
      { schema: { params: IdParams, response: { 200: SmartDiffResponse } } },
      async (req) => {
        const { workspaceId } = await getContext(container, req);
        return service.getSmartDiff(workspaceId, req.params.id);
      },
    );
    ```
    No rate-limit config needed (it is a cheap deterministic read, unlike the
    LLM-bearing `recompute` routes which are rate-limited).
  - `index.ts` — register per S5.
- **Acceptance criteria:**
  - `GET /pulls/:id/smart-diff` for an UNKNOWN/other-workspace PR → 404
    (`NotFoundError`), proving the scope guard.
  - For a PR with files but **no review yet**: 200, `groups` populated by
    classification, every `finding_lines` is `[]`, `split_suggestion` present.
  - For a PR with a `kind:'review'` review: 200, files whose path matches a
    non-dismissed finding carry the expanded `finding_lines`; a dismissed finding
    contributes NO lines.
  - Response validates against `SmartDiffResponse` (fastify-type-provider-zod
    serializes it; an invalid shape would 500 — so a green 200 is the contract proof).
  - A PR with **zero files** → 200 with `groups: []` (or only-empty omitted) and
    `total_lines: 0`, `too_big: false`.
- **How to test:** `server/test/smart-diff.it.test.ts` (the `.it.test.ts` suffix is
  REQUIRED for DB-backed tests, `server/AGENTS.md:16`). Follow the template
  `server/test/reviews.it.test.ts:1-13, 99-126`: gate on `dockerAvailable()`, `startPg()`,
  `seed()`, `buildApp({ config, db, overrides })`, drive via `app.inject(...)`. Seed a
  repo + PR + `pr_files` rows directly (mirror `reviews.it.test.ts:64-97`); for the
  with-findings case, either run a review with `MockLLMProvider` (as that file does) or
  insert a `reviews(kind:'review')` row + `findings` rows directly via Drizzle in the
  test. Cases: (1) no review → empty `finding_lines`; (2) with non-dismissed finding →
  populated lines + correct grouping; (3) dismissed finding excluded; (4) zero files;
  (5) unknown PR → 404. Run via WSL:
  `wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc 'cd /mnt/.../server && pnpm exec vitest run smart-diff.it'`
  plus `pnpm typecheck`.

### Phase C — Client data hook + i18n strings
- **Surface:** client (UI)
- **Disjoint scope (OWNS):**
  - `client/src/lib/hooks/reviews.ts` (ADD ONE hook only — `usePrSmartDiff`; touch no
    other export)
  - `client/messages/en/shell.json` (extend the `diffViewer` object only)
- **Depends on:** none for authoring (the contract type already exists). Phase D
  consumes both; **C → D** is a real ordering dependency for D's green test, but C is
  small and independent to write, so it can run in parallel with A/B.
- **Skills to apply:** `react-frontend-architecture` (data access lives in a hook in
  the data layer, not inline), `react-best-practices`, `next-best-practices` (i18n via
  next-intl messages, no hardcoded UI strings), `typescript-expert`.
- **What changes & why:**
  - `usePrSmartDiff(prId)` — copy S6 exactly; key `["smart-diff", prId]`,
    `GET /pulls/${prId}/smart-diff`, `enabled: prId != null`. Add `SmartDiffResponse`
    to the existing `@devdigest/shared` type-import block (`reviews.ts:7-15`). This is
    the ONLY addition to the file — do not reorder or modify existing hooks.
  - `shell.json` → extend the existing `diffViewer` block (`shell.json:33-44`) with new
    keys (do not remove existing ones):
    ```json
    "smartOrder": "Smart order",
    "originalOrder": "Original order",
    "coreGroup": "Core logic",
    "coreGroupDesc": "The substance of the change — review closely",
    "wiringGroup": "Wiring",
    "wiringGroupDesc": "Hooks the core into the app",
    "boilerplateGroup": "Boilerplate",
    "boilerplateGroupDesc": "Generated / mechanical — skim",
    "findingsBadge": "{count} findings",
    "fileCount": "{count} files",
    "splitSuggestion": "This PR is large — consider splitting it",
    "noSmartDiff": "Smart diff not available yet."
    ```
    Group header copy is taken verbatim from the screenshot brief.
- **Acceptance criteria:**
  - `usePrSmartDiff` exists, is exported, typed to `SmartDiffResponse`, disabled when
    `prId` is null, uses the `["smart-diff", prId]` key.
  - `shell.json` parses as valid JSON and contains every new `diffViewer.*` key; all
    existing keys remain unchanged.
  - `client` `pnpm typecheck` is green.
- **How to test:** `pnpm typecheck` in `client/` (the hook is exercised end-to-end by
  Phase D's RTL test, which mocks it; no standalone hook test needed per the RTL
  skill's "test through the component" guidance). Run via WSL:
  `wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc 'cd /mnt/.../client && pnpm typecheck'`.

### Phase D — SmartDiffViewer component + DiffTab toggle (+ RTL tests)
- **Surface:** client (UI)
- **Disjoint scope (OWNS):**
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx`
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/index.ts`
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/helpers.ts`
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.test.tsx`
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx` (toggle only)
- **Depends on:** Phase C (uses `usePrSmartDiff` + the new i18n keys). **C → D** real
  dependency. Independent of A/B at the file level (no shared files), but the running
  feature needs B's endpoint; the RTL test mocks the hook so D's tests are green
  without the server.
- **Skills to apply:** `react-frontend-architecture` (colocated `_components/` feature
  folder; pure join logic in `helpers.ts`, not in the component body; one component per
  file; narrow `index.ts` entry point per the slice-boundary exception),
  `react-best-practices` (derive the join with `useMemo`, don't mirror into state; keys;
  collapse state is local `useState`), `next-best-practices` (`"use client"`; strings
  via `useTranslations("shell")`), `react-testing-library` (RTL + Vitest, mock hooks,
  test user-visible flows).
- **The three-source client join (the crux — put it in `helpers.ts`, pure & memoized):**
  Smart Diff carries no patch text and no per-finding severity, so the viewer joins
  three sources matched by `path`:
  1. `SmartDiffResponse.groups` (from `usePrSmartDiff`) → ordering, role grouping,
     `finding_lines`, `pseudocode_summary`.
  2. `usePullDetail(prId).data.files` (`PrFile[]` — `{ path, additions, deletions, patch }`)
     → the `patch` text for `parsePatch` rendering.
  3. `usePrReviews(prId).data` (`ReviewRecord[]`) → the latest `kind:'review'`'s
     non-dismissed findings, for the per-line severity tag and the badge's severity
     breakdown. **Severity MUST come from here** — `finding_lines` carry no severity.
  `helpers.ts` exports e.g. `joinSmartDiff(groups, files, findings)` returning, per
  file, `{ role, path, additions, deletions, pseudocode_summary, finding_lines, patch, severityByLine: Map<number, Severity> }`,
  and a per-file severity tally (`Record<Severity, number>`) for the badge. Map
  CRITICAL→"blocker", WARNING→"warning", SUGGESTION→"suggestion" (S8). Files present in
  `groups` but absent from `files` (no patch — binary) still render the header + badge
  with an empty body (`parsePatch(undefined) === []`).
- **What changes & why:**
  - `SmartDiffViewer.tsx` (`"use client"`):
    - Props: `{ prId: string }`. Calls `usePrSmartDiff(prId)`, `usePullDetail(prId)`,
      `usePrReviews(prId)`; `useMemo`-joins via `helpers.joinSmartDiff`.
    - Renders one `Card` + `SectionLabel` per present group, in `core, wiring, boilerplate`
      order, header = localized group name + description + `fileCount` count (and the
      screenshot's group icon). Boilerplate group is COLLAPSED by default; core/wiring
      expanded (local `useState` per group, S7 chevron pattern).
    - Per file: a collapsible row (S7 pattern) showing path, `+adds −dels`, a red dot
      when `finding_lines.length > 0`, and an "N findings" badge built from
      `SeverityCountBadges`/`SeverityBadge` using the joined severity tally. Clicking the
      badge scrolls to the first finding line (jump target = a DOM node keyed by
      `path:lineNo`; use a ref map + `scrollIntoView`, no router nav).
    - File body: `parsePatch(patch).map(...) → <CodeLine ln path threads={[]} />`
      (read-only; no `commenting`). Lines whose `newNo`/`oldNo` is in `finding_lines`
      get a severity-tinted highlight (inline style reading `SEV[sev].bg`/`.c` from
      tokens); attach the jump-target ref/id on those lines.
    - Optional `split_suggestion` banner when `too_big` (localized `splitSuggestion`,
      list `proposed_splits`).
    - Loading → null/skeleton; smart-diff `null`/empty groups → localized `noSmartDiff`.
  - `index.ts` → `export { SmartDiffViewer } from "./SmartDiffViewer";` (narrow entry).
  - `DiffTab.tsx` — add a `Toggle` (or two-label switch) top-right in the existing
    `SectionLabel right={...}` slot (`DiffTab.tsx:45-61`): local `useState` `smart`
    (default Smart = true). `smart` → `<SmartDiffViewer prId={prId} />`; otherwise the
    EXISTING `<DiffViewer files={files} commenting={commenting} />` UNCHANGED. Labels
    `smartOrder`/`originalOrder` from i18n. Do not alter the comments/DiffViewer path.
- **Acceptance criteria (user-visible):**
  - Groups render in `core, wiring, boilerplate` order with their localized
    headers/descriptions and file counts.
  - Boilerplate group is collapsed by default; core/wiring expanded; clicking a header
    toggles it.
  - A file with findings shows the red dot + an "N findings" badge with the correct
    count; a file without findings shows neither.
  - Clicking the badge scrolls the first finding line into view (assert via a spy on
    `scrollIntoView` or a focus/`data-` attribute target).
  - The DiffTab toggle flips between `SmartDiffViewer` and the unchanged `DiffViewer`;
    Original order renders the same flat list as before.
  - A binary file (patch null) renders header + badge but an empty body without
    crashing.
- **How to test:** `SmartDiffViewer.test.tsx` (RTL + Vitest), following the repo's
  hook-mock convention (S8): `vi.mock("@/lib/hooks/reviews")` (for `usePrSmartDiff` +
  `usePrReviews`) and `vi.mock("@/lib/hooks/core")` (for `usePullDetail`), mutable
  fixtures, `<NextIntlClientProvider locale="en" messages={{ shell }}>`. Tests (1-3
  flow tests per the RTL skill): (a) grouping order + boilerplate-collapsed-by-default +
  expand on click; (b) badge count present on a file with findings, absent otherwise, and
  click-to-jump invokes the scroll; (c) the DiffTab toggle swaps views. Run via WSL:
  `wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc 'cd /mnt/.../client && pnpm exec vitest run SmartDiffViewer'`
  plus `pnpm typecheck`.

## Risks & mitigations

- **Path mismatch (`findings.file` vs `pr_files.path`).** Verified identical
  repo-relative strings (`reviews.it.test.ts:89-96`). Mitigation: match by exact `===`;
  the integration test (Phase B) asserts a real finding lands on the right file. If a
  future importer ever stores absolute or `a/`-prefixed paths, the integration test
  catches it (finding_lines would be empty when they should not be).
- **Null `patch` (binary / unfetched).** `parsePatch(null) === []`
  (`diff-viewer/helpers.ts:11-13`); the file still classifies and shows its badge.
  Mitigation: render the header + badge with an empty body; covered by a Phase D test.
- **File with findings but no patch row.** A file can be in `SmartDiff.groups` (from
  `pr_files`) but the joined `pr.files` patch may be null. The join keys on `path` and
  tolerates a missing patch (empty body). Mitigation: `helpers.joinSmartDiff` defaults
  `patch` to `null`.
- **PR with zero files.** Compose returns empty `groups` and `total_lines: 0`;
  `too_big: false`. UI shows `noSmartDiff`. Covered by Phase A + B tests.
- **No review yet.** `reviewsForPull` returns `[]`; `findingsByPath` empty; all
  `finding_lines: []`; overlay simply absent. The route still returns groups +
  split_suggestion. Covered by Phase B test.
- **Dismissed findings.** Excluded by `dismissedAt !== null` in the service.
  Asserted in Phase B.
- **"Latest review" selection.** `reviewsForPull` is newest-first; `summary`-kind rows
  precede or interleave `review`-kind rows. Mitigation: explicitly
  `find(r => r.review.kind === 'review')`, not `[0]`. Documented in S2.
- **Contract drift.** None expected — the contract is fixed and imported. Mitigation:
  Phase A asserts `SmartDiff.parse(result)`; Phase B's typed `response: { 200: SmartDiffResponse }`
  serializer is a second gate.
- **Parallel-edit collisions.** Only two shared files are edited and each by exactly one
  phase: `modules/index.ts` (Phase B) and `reviews.ts`/`shell.json` (Phase C). No file is
  edited by two phases. The A→B and C→D orderings are the only sequencing constraints;
  {A,C} can run fully in parallel, then {B,D}.

## Critical files for implementation

- `server/src/vendor/shared/contracts/brief.ts:80-113` — the `SmartDiff` contract (import, never edit).
- `server/src/modules/reviews/routes.ts:113-121` — the intent GET route template for Phase B's route.
- `server/src/modules/reviews/repository.ts:31-66` — the reused facade methods (`getPull`, `getPrFiles`, `reviewsForPull`).
- `client/src/components/diff-viewer/FileCard/FileCard.tsx:33-96` — collapsible + `parsePatch`/`CodeLine` reuse pattern for Phase D.
- `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx:43-64` — where the Smart/Original toggle goes.

## Open questions / assumptions

- **Assumption (thresholds):** `SPLIT_TOO_BIG_LINES = 500`, `LARGE_FILE_LINES = 300`.
  These are course-lab heuristics; tune in `constants.ts` without touching logic. Open
  question for the lab author: preferred too-big cutoff.
- **Assumption (empty groups):** the compose helper OMITS zero-file groups so the UI
  renders only present roles. If the screenshot always shows all three headers (even
  empty), flip to "keep empties" — a one-line change in `compose.ts`, and have the UI
  render an empty-state row.
- **Assumption (finding_lines):** expand to the full `[startLine..endLine]` range (not
  just `startLine`) so multi-line findings highlight fully; the badge click jumps to
  the first line. Justified above.
- **Assumption (RTL via hook mocks, not MSW):** follows the existing repo convention
  (`IntentCard.test.tsx`) rather than the RTL skill's MSW default, to stay consistent
  with the codebase.
- **Assumption (toggle default):** Smart order is the default view (the feature's
  whole point); confirm with the lab brief if Original should be default.
- **Out of scope items are enumerated below.**

## Out of scope / non-goals

- **NO LLM / model call anywhere in Smart Diff** — `pseudocode_summary` stays `null`;
  no `deepseek-v4-flash`, no OpenRouter, no `loadDiff`+`classifyIntent`/`analyzeRisks`.
- **NO new DB table and NO migration** — reuses `pr_files` + `findings` via existing
  repo methods.
- **NO contract change** — `SmartDiff`/`SmartDiffResponse` are imported as-is from
  `@devdigest/shared`; the shared barrel is not edited.
- **NO new repository method** — `getPull`/`getPrFiles`/`reviewsForPull` already exist.
- **The Original-order view (`DiffViewer`) is unchanged** — the toggle only chooses
  between it and the new viewer; existing inline-comment behavior is untouched.
- **No persistence of the smart-diff result** — it is composed on each request
  (cheap, deterministic); no caching table.
- **No changes to the review-run pipeline, SSE, or finding accept/dismiss flows.**

## Revision 1 — file-header findings badge: placement + click-to-reveal

Design-fidelity feedback after the first visual check (screenshots compared). Two
concrete changes to the file-header findings affordance; **client-only**, no backend /
contract / route change. Owns: `SmartDiffViewer/SmartDiffViewer.tsx`,
`SmartDiffViewer/helpers.ts`, `SmartDiffViewer/SmartDiffViewer.test.tsx`,
`client/messages/en/shell.json` (popover strings only).

**R1.1 — Badge placement matches the design.**
- In each file-header row the findings badge must sit IMMEDIATELY TO THE LEFT of the
  `+N −N` stat (the design puts its header pill before the stat; the current code renders
  it AFTER the stat). Target header order: `chevron · filename(flex:1) · [findings badge] · [+N −N]`.
- Move the "has findings" red dot to AFTER the filename (design shows `path ●`); it is
  currently before the filename.
- A file with no findings shows neither dot nor badge (unchanged).

**R1.2 — Clicking the badge reveals the finding content (not a bare scroll).**
- Replace the current behavior (badge click scrolls to the first finding line) with: badge
  click opens the SHARED `FindingsFilterPopover` from `@/components/findings`, anchored to
  the badge button via `getBoundingClientRect()` (the component portals to `<body>` and is
  fixed-positioned, so it escapes the card's `overflow`). It already renders severity filter
  chips + `FindingPreviewList` (severity, title, category, `file:line`, confidence,
  rationale) and handles outside-click/Escape close.
- Pass that file's NON-DISMISSED findings from the latest `kind:'review'` review as
  `findings`, and a `PrFindingCounts` for `counts` (derive from the per-file tally; check
  the exact `PrFindingCounts` shape and map accordingly).
- Preserve jump-to-line as the popover's `onPick`: picking a finding closes the popover,
  expands the file body if collapsed, and scrolls that finding's line into view (reuse the
  existing `lineRefs` + `jumpTargetId` + `scrollToLine`). Only ONE file's popover is open at
  a time (local state keyed by path, or per-`FileRow` state).
- Edge: a binary file (null patch) WITH findings still opens the popover (the body is empty
  but the findings list is not).

**R1.3 — Join surfaces the per-file findings.**
- Extend `buildSeverityOverlay` / `joinSmartDiff` / `JoinedFile` to also carry the per-file
  `FindingRecord[]` (non-dismissed, latest review) so the popover can render them — currently
  the join keeps only `severityByLine` + `severityTally`. Keep all helpers pure + memoized.
- No new network call — reuse the already-fetched `usePrReviews` data.

**R1.4 — i18n.** Add any popover strings under `diffViewer` in `messages/en/shell.json`
(e.g. `findingsTitle`, `findingsClose`, `findingsEmptyTitle`, `findingsEmptyBody`) — or reuse
the strings the timeline/PR-list popover already passes; never hardcode. Read via
`useTranslations("shell")`.

**Acceptance (update `SmartDiffViewer.test.tsx`):**
- The findings badge renders BEFORE the `+N −N` stat in the header DOM order (assert order),
  and the red dot renders AFTER the filename.
- Clicking the badge opens the popover and shows a finding's title + rationale.
- Clicking a finding in the popover invokes `scrollIntoView` (spy/stub — jsdom lacks it) and
  closes the popover.
- A file with no findings renders no badge and no dot.
- All existing Phase-D assertions (group order, boilerplate collapsed, toggle) still pass.

**Out of scope for R1:** still NO LLM, `pseudocode_summary` stays `null` (the "What this
does" line renders only if non-null); no per-line inline severity TAG labels are added here
(line tint stays as-is) unless a later revision asks; no backend/contract change.

## Revision 2 — inline per-line severity tags + group-header icon alignment

Second design-fidelity pass after a visual diff against screenshot 1. Three changes;
**client-only**, no backend/contract/route change. Owns: `SmartDiffViewer/SmartDiffViewer.tsx`,
`SmartDiffViewer/helpers.ts`, `SmartDiffViewer/SmartDiffViewer.test.tsx`,
`client/messages/en/shell.json` (severity-label strings only).

**R2.1 — Inline per-line severity tags (ADD; the header count badge is UNCHANGED).**
- On each finding's line in the expanded file body, render a small severity-colored tag
  floated to the RIGHT edge of that line (the design shows `💡 suggestion`, `⚠ warning`,
  `⊘ blocker` pinned to the line's right). Use the existing `Badge` primitive with
  `color={SEV[sev].c}`, `bg={SEV[sev].bg}`, `icon={SEV[sev].icon}`.
- Place ONE tag per finding, on the line equal to the finding's `start_line` (not on every
  covered line). The existing per-line background TINT (`severityByLine`, whole range) stays
  as-is. Add a separate start-line→worst-severity map for the tag (pure helper in
  `helpers.ts`, e.g. `tagSeverityByLine(findings): Map<number, Severity>`; memoized).
- Positioning: make the per-line wrapper `position: relative` and render the tag
  `position: absolute; right: 8px; top: 50%; transform: translateY(-50%)` so it overlays the
  line's right side without modifying `CodeLine`.
- The file-header per-severity count badge (Revision 1) is LEFT EXACTLY AS-IS — do not move,
  restyle, or remove it. Inline tags are ADDITIVE.

**R2.2 — Text labels on the inline tags (header badge still UNCHANGED).**
- The inline tag shows the severity word, mapped to the design's vocabulary:
  `CRITICAL → "blocker"`, `WARNING → "warning"`, `SUGGESTION → "suggestion"` (lowercase).
  `SEV.label` is "Critical/Warning/Suggestion", so DO NOT reuse it — add i18n keys under
  `diffViewer` in `shell.json` (e.g. `sevBlocker`, `sevWarning`, `sevSuggestion`) read via
  `useTranslations("shell")`. The header count badge keeps its current icon+count form.

**R2.3 — Group-header icon vertical alignment.**
- Keep the current group header (icon `⊞`/Cpu/Boxes + UPPERCASE name + inline
  `desc · N files` + group-collapse chevron on the right). FIX ONLY the vertical centering:
  the icon currently sits above the text because the children `<span>` carries
  `padding: "12px 16px 0"` (top padding the icon doesn't share). Move that padding OFF the
  inner children span and onto a wrapper `<div>` around the whole `<SectionLabel>` (SectionLabel
  already centers `icon + children + right` via `alignItems:center`), so the icon, name,
  description and chevron all align on one centered baseline. No change to copy, casing, icon,
  or the chevron behavior.

**Acceptance (update `SmartDiffViewer.test.tsx`):**
- Expanding the file that has a CRITICAL finding shows an inline tag with the text `blocker`
  on the finding's start line; a SUGGESTION finding shows `suggestion`, WARNING shows `warning`.
- The file-header count badge still renders unchanged (existing R1 badge assertions stay green).
- All prior Phase-D + R1 assertions still pass.
- (R2.3 vertical centering is visual — no unit assertion required; verified in the visual check.)

**Out of scope for R2:** still NO LLM / `pseudocode_summary` stays `null`; no "What this does"
prose line; header badge style/placement unchanged; no backend/contract/route change.

## Revision 3 — clickable inline tags open a per-finding popover

The inline per-line severity tag (R2) is currently a non-interactive `<Badge>`. Make it
clickable so a click opens the shared findings popover scoped to THAT line's finding(s).
**Client-only**; no backend/contract/route change. Owns: `SmartDiffViewer/SmartDiffViewer.tsx`,
`SmartDiffViewer/helpers.ts`, `SmartDiffViewer/SmartDiffViewer.test.tsx`.

**R3.1 — Inline tag becomes a clickable trigger.**
- Render the inline tag as a `<button type="button">` wrapping the existing `Badge` (keep the
  same severity color/icon/label and the absolute right-of-line positioning). `cursor: pointer`.
  Its accessible name is the tag's severity word (the visible Badge text suffices, or add an
  explicit `aria-label`).
- On click: `e.stopPropagation()` (hygiene — don't bubble), then open the SHARED
  `FindingsFilterPopover` anchored to the tag via `e.currentTarget.getBoundingClientRect()`
  (no per-tag ref — there can be many tags per file). Pass the finding(s) that START on this
  line and `counts` derived from them. `onPick` keeps the existing scroll-to-line behavior.

**R3.2 — Per-line finding payload.**
- Add a PURE helper in `helpers.ts`, e.g. `findingsByStartLine(findings: FindingRecord[]): Map<number, FindingRecord[]>`
  (non-dismissed findings grouped by `start_line`). Memoize in the component. The tag still
  uses `tagSeverityByLine` (R2) for its colour/label (worst severity per start line); the
  click passes `findingsByStartLine.get(lineNo) ?? []` so the popover shows exactly that
  line's finding(s) — i.e. "its specific finding" for the common 1-per-line case.

**R3.3 — Unify the popover state so both triggers share one popover.**
- Generalise the `FileRow` popover state from `anchor: DOMRect | null` to
  `{ anchor: DOMRect; findings: FindingRecord[]; key: string } | null`. Both the HEADER count
  badge (key `"badge"`, findings = all the file's findings — UNCHANGED behavior) and each inline
  tag (key `line-${lineNo}`, findings = that line's findings) set this state. Clicking the same
  trigger again toggles it closed (compare `key`); clicking a different trigger replaces the
  content. Only ONE popover open per file at a time. `FindingsFilterPopover` already closes on
  outside-click / Escape — keep that. The header badge's appearance/placement stays exactly as-is.

**Acceptance (update `SmartDiffViewer.test.tsx`):**
- Use a fixture with TWO findings on DIFFERENT start lines in one file (e.g. a CRITICAL on
  line 5 and a SUGGESTION on line 8). Expand the file.
- Clicking the `blocker` (line-5) inline tag opens the popover showing ONLY that finding's
  content (its title), and NOT the other finding's title.
- Clicking the `suggestion` (line-8) inline tag opens the popover showing ONLY the other
  finding's content.
- The header count badge still opens a popover listing ALL the file's findings (unchanged).
- Prior R1/R2/Phase-D assertions still pass.

**Out of scope for R3:** still NO LLM; `pseudocode_summary` stays `null`; header badge
**user-visible appearance/placement and what it shows (all the file's findings) unchanged** —
its `onClick` IS rerouted through the unified `togglePopover` (the intended R3.3 change), which
is not a user-facing behavior change; line tint + tag colour/label unchanged; no
backend/contract/route change.
