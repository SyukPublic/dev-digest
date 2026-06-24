---
name: react-frontend-architecture
description: "React/Next.js frontend architecture & code organization (2025-26): where files live, how to split components, feature-based structure, co-location, constants/utils/helpers/types/hooks placement, where business logic goes, import boundaries, barrel files, path aliases, and naming conventions. Use when structuring a new frontend, deciding where a file or piece of logic belongs, splitting an oversized component/module, reviewing folder layout, or naming files. Stack-agnostic (React 19 + Next.js 15 App Router aware)."
---

# React Frontend Architecture & Code Organization

How a React/Next.js frontend should be *organized* — where code lives, how it's split, and what to name it. This is about **structure and placement**, not component runtime correctness. For code examples (good/bad per rule) see [examples.md](examples.md); for sources see [references.md](references.md).

Sibling skills (do not duplicate):
- `react-best-practices` → component purity, hooks misuse, memoization, keys, derive-don't-store.
- `next-best-practices` → App Router file conventions, RSC mechanics, metadata, image/font optimization.

## Severity Levels

- **CRITICAL** — Will cause coupling/maintenance failures or leak server code to the client
- **HIGH** — Will cause scaling problems or hard-to-navigate codebases
- **MEDIUM** — Hurts maintainability or developer experience

## Guiding principle

**Colocation: place code as close to where it's used as possible.** A file's location is a claim about its scope. Promote code to a shared layer only when a *second* consumer actually appears — not in anticipation. Premature shared abstractions (AHA: *Avoid Hasty Abstractions*) are as harmful as duplication.

---

## Project Structure: feature-based over type-based (HIGH)

- Organize by **feature/domain**, not by technical role. `features/checkout/` beats a global `components/`, `hooks/`, `utils/` split once the app has more than a handful of screens.
- Type-based grouping (`components/`, `hooks/`, `utils/` at the root) is fine for **small** apps but scales poorly: working on one feature forces edits across many directories (low cohesion, high coupling).
- A **feature folder** colocates everything that feature needs and *only the subfolders it needs*: `api/`, `components/`, `hooks/`, `stores/`, `types/`, `utils/`.
- Keep a **shared layer** (`shared/`, `components/ui/`, `lib/`) for genuinely cross-feature primitives only.
- There is no single mandated layout. Pick one strategy and apply it **consistently** across the project — inconsistency costs more than the specific choice.
- For large/enterprise apps, a layered methodology (e.g. Feature-Sliced Design: `app → pages → widgets → features → entities → shared`) makes boundaries explicit. Adopt the layering, not necessarily the full vocabulary.

## Where each kind of code lives (HIGH)

- **Components** → `components/` within the feature, or a flat shared `components/` for cross-cutting UI. Avoid Atomic-Design buckets (`atoms/molecules/organisms`) — categorizing wastes time and the boundaries are arbitrary.
- **Custom hooks** → `hooks/` (feature-local) or alongside the component that owns them. One hook per file, file named after the hook (`useCart.ts`).
- **Constants** → a dedicated `constants.ts` (feature-local) or `shared/constants/`. Never scatter magic values inline; never dump everything into one global `constants.ts` with thousands of lines — split by domain.
- **Types** → `types.ts` colocated with the feature; shared contracts in a shared types module. Co-locate a type with its consumer until a second consumer appears.
- **utils vs helpers** — keep them distinct:
  - **utils** = *generic, pure, project-agnostic* functions (date formatting, array grouping) → shared `utils/`.
  - **helpers** = *project-specific* glue tied to your domain → feature-local `helpers.ts`.
  - `utils/` should hold **pure functions only**. A function with side effects is not a util — it belongs in a hook, service, or data layer.
- **Data access / API calls** → a dedicated `api/` or `lib/` module (a Data Access Layer), never inline in components.

## Where business logic lives (CRITICAL)

- **Components render; they do not contain business logic.** Extract domain logic into custom hooks (stateful logic) or plain functions/services (pure logic).
- Data fetching and mutations live in **custom hooks** or a **data-access layer**, never in component bodies.
- In an RSC/App Router app, keep data fetching, secrets, and heavy logic in **Server Components** or server-only modules; mark such modules with `server-only` so they can't be imported into the client bundle.
- A page-level auth check does **not** extend to a server action defined within it — re-verify authorization inside each action.

## Import boundaries & dependency direction (CRITICAL)

- **No cross-feature imports.** Feature A must not reach into Feature B's internals. Compose features at the application level (the page/route that uses both).
- Dependencies flow **one direction**: `shared → features → app`. Lower layers never import from higher layers. This keeps the dependency graph acyclic and prevents tangled coupling.
- Enforce boundaries mechanically with ESLint (`import/no-restricted-paths` or equivalent), not by convention alone.

## Barrel files (HIGH)

- **Avoid barrel files** (`index.ts` that re-exports a folder's contents) for internal modules. They break tree-shaking, slow dev servers/bundlers, and create circular-import hazards. Import directly from the source file.
- The defensible exception is a **single public entry point per published package or per architectural slice** — a deliberate, narrow API surface, not a convenience re-export of everything.

## Path aliases / absolute imports (MEDIUM)

- Configure path aliases (`@/features/...`, `@/shared/...`) instead of deep relative chains (`../../../`).
- Aliases make moves/refactors cheaper and imports readable. Keep alias roots aligned with the top-level structure.

---

## Component splitting & design (HIGH)

- **Split by responsibility, not by line count** — but treat a component that mixes data fetching + business logic + presentation + styling as a smell. Extract until each piece has one job.
- One primary component per file (small, file-local sub-components are fine).
- **Composition over configuration.** Prefer passing `children`/slots over adding ever more boolean/config props. A component accreting many flags (`isModal`, `isCompact`, `hasHeader`...) wants to be split or composed.
- Use the **`children` prop and composition to avoid prop drilling** before reaching for context. Lift content up; pass elements as props/slots.
- **Compound components** (e.g. `<Tabs><Tabs.List/><Tabs.Tab/></Tabs>`) express related parts that share implicit state — use them for cohesive widget families instead of one mega-component with a giant prop list.
- **Container/Presentational** is still a useful *mental* split (data/logic vs. pure rendering), though custom hooks now do much of what container components used to.

## Props design (MEDIUM)

- Model mutually-exclusive prop combinations with **discriminated unions** so invalid states are unrepresentable, instead of many optional props that can contradict each other.
- Prefer narrow, explicit prop types over permissive `any`/broad objects. Provide defaults for optional props.

---

## State, data & logic placement (HIGH)

- **Server state ≠ client state.** Data from the server (lists, entities, query results) belongs in a server-cache library (e.g. TanStack Query), not mirrored into a global client store. Don't duplicate server data into `useState`/Redux/Zustand.
- **Colocate client state** with the component that uses it; lift it up only when a second component needs it; reach for global state only when truly app-wide.
- Choose the **state tool by category**: component-local (`useState`/`useReducer`), URL state (search params for filters/pagination/sorting), server cache (TanStack Query/SWR), app-wide client state (Zustand/Jotai/Redux only when warranted).
- Wrap data access in **custom hooks per feature** (`useOrders`, `useCreateOrder`) so components depend on an intent-revealing API, not raw fetch/query plumbing.
- Don't sync state with `useEffect` — derive it. (Detail lives in `react-best-practices`; relevant here because it dictates that derived values get *no* storage location at all.)

---

## Naming conventions (MEDIUM)

- **Components / component files**: `PascalCase` — `UserCard`, `UserCard.tsx`.
- **Hooks**: `useCamelCase`, file `useCart.ts`. The name must convey intent ("what it does/returns"), not implementation. A hook you can't name clearly is probably too coupled to one component.
- **Variables / functions**: `camelCase`. **Booleans**: prefix `is/has/should` (`isLoading`, `hasAccess`).
- **Constants**: `UPPER_SNAKE_CASE` for true constants; `PascalCase`/objects for enums/config maps.
- **Folders**: consistent casing project-wide (commonly `kebab-case` for folders, `PascalCase` for component folders). Pick one and don't mix.
- **Explicit file roles** in names aid search: `validation.helpers.ts`, `order.constants.ts`, `cart.types.ts` beat a dozen ambiguous `index.ts`/`utils.ts`.

## Anti-patterns catalog (reference)

- God components mixing fetch + logic + presentation + styles.
- Type-based folders that force multi-directory edits per feature.
- Cross-feature reach-ins / circular dependencies.
- Barrel `index.ts` re-exporting everything.
- Deep relative imports (`../../../../`).
- Business logic inline in component bodies.
- Server-only code importable from the client (no `server-only` guard).
- Mirroring server state into a global client store.
- Premature shared abstractions with a single consumer.
- One giant `utils.ts`/`constants.ts` instead of domain-split files.
