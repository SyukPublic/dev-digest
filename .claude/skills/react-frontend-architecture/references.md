# References — react-frontend-architecture

Sources backing the `react-frontend-architecture` skill. Focus: **where code lives and how it is split** for **React 19 + Next.js 15 (App Router)**, across project scales (small → enterprise). Component runtime correctness lives in the sibling `react-best-practices` skill; App Router/RSC/data-fetching mechanics live in `next-best-practices`. This skill is intentionally about **project structure, file organization, and code-placement conventions**.

Researched 2026-06-22 via fan-out web search + adversarial verification (deep-research workflow) plus manual gap-filling. All URLs preserved.

Quality legend: **[primary]** official docs / first-party · **[secondary]** authoritative aggregators · **[blog]** recognized practitioners · **[community]** community round-ups.

---

## 1. Folder / project structure & where things live

- **[primary]** Next.js — Project Structure & Organization — https://nextjs.org/docs/app/getting-started/project-structure
  Next.js is unopinionated about organization. Private folders `_folder` (opt out of routing), route groups `(group)` (organize without affecting URL, enable multiple/nested layouts). Three named strategies: store files outside `app`, in top-level folders inside `app`, or split by feature. Folder names like `components/lib/ui/utils/hooks` have no special framework meaning. Co-location is safe — a route is public only with `page.js`/`route.js`.
- **[primary]** Bulletproof React — Project Structure — https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
  Feature-based: most code in `features/<feature>/` (api, components, hooks, stores, types, utils — only the subfolders needed). No cross-feature imports — compose at the app level, enforced via ESLint `import/no-restricted-paths`. Unidirectional flow shared → features → app. Barrel files discouraged (break Vite tree-shaking).
- **[primary]** Bulletproof React (repo root) — https://github.com/alan2207/bulletproof-react
- **[primary]** Feature-Sliced Design — Layers reference — https://feature-sliced.design/docs/reference/layers
  Seven layers (app, processes[deprecated], pages, widgets, features, entities, shared); a slice imports only from layers strictly below it.
- **[primary]** Feature-Sliced Design — Scalable React Architecture — https://feature-sliced.design/blog/scalable-react-architecture
  Single public entry point (`index.ts`) per slice; unidirectional dependencies; no circular references.
- **[primary]** Feature-Sliced Design — Frontend Folder Structure — https://feature-sliced.design/blog/frontend-folder-structure
  Type-based structure suits small apps but scales poorly (low cohesion / high coupling); dependencies form a DAG.
- **[blog]** Josh W. Comeau — Delightful React File/Directory Structure — https://www.joshwcomeau.com/react/file-structure/
  Flat `components/` (rejects Atomic Design buckets); easy imports; **helpers vs utils distinction** (helper = project-specific, util = generic shareable); pragmatic use of barrel `index.js`.
- **[blog]** Robin Wieruch — React Folder Structure Best Practices [2026] — https://www.robinwieruch.de/react-folder-structure/
  Evolution flat → feature-based; co-location; when to promote to shared.
- **[blog]** Robin Wieruch — Feature-based React Architecture — https://www.robinwieruch.de/react-feature-architecture/
- **[blog]** Kent C. Dodds — Colocation — https://kentcdodds.com/blog/colocation
  Principle: "place code as close to where it's relevant as possible."
- **[blog]** Sandro Roth — Project Structure — https://sandroroth.com/blog/project-structure/
  Rule of thumb: a util used by one feature stays in that feature; once two+ need it, promote to shared.
- **[blog]** Next.js 15 — Best Practices for Organizing (dev.to, Bajrayejoon) — https://dev.to/bajrayejoon/best-practices-for-organizing-your-nextjs-15-2025-53ji
- **[blog]** Web Dev Simplified — How To Structure React Projects (Beginner → Advanced) — https://blog.webdevsimplified.com/2022-07/react-folder-structure/
  `utils/` should hold only pure functions; explicit filenames `validation.helpers.js`; dedicated `constants.js`.
- **[blog]** Tania Rascia — How to Structure and Organize a React Application — https://www.taniarascia.com/react-architecture-directory-structure/
- **[community]** Recommended Folder Structure for React 2025 (dev.to, Pramod Boda) — https://dev.to/pramod_boda/recommended-folder-structure-for-react-2025-48mc

### Barrel files & path aliases
- **[blog]** TkDodo — Please Stop Using Barrel Files — https://tkdodo.eu/blog/please-stop-using-barrel-files
  Why barrel `index.ts` hurt: broken tree-shaking, slow dev servers, circular dependencies.

---

## 2. Component design & splitting (composition, container/presentational, compound, props)

- **[primary]** React — Thinking in React — https://react.dev/learn/thinking-in-react
  Break the UI into a component hierarchy using single-responsibility.
- **[primary]** React — Components and Hooks must be pure — https://react.dev/reference/rules/components-and-hooks-must-be-pure
- **[blog]** Kent C. Dodds — Advanced React Component Patterns — https://kentcdodds.com/blog/advanced-react-component-patterns
  Render Props, Component Injection, Compound Components, Provider, HOC.
- **[blog]** Kent C. Dodds — Compound Components with React Hooks — https://kentcdodds.com/blog/compound-components-with-react-hooks
- **[blog]** Kent C. Dodds — AHA Programming (Avoid Hasty Abstractions) — https://kentcdodds.com/blog/aha-programming
  Do not abstract prematurely; duplication is cheaper than the wrong abstraction.
- **[blog]** Kent C. Dodds — Prop Drilling — https://kentcdodds.com/blog/prop-drilling
  What it is, when it's a problem, why composition beats over-using context.
- **[secondary]** patterns.dev — Presentational/Container Pattern — https://www.patterns.dev/react/presentational-container-pattern/
  Separating "how it looks" from "how it works" (and how hooks partly superseded it).
- **[blog]** Robin Wieruch — React Component Composition — https://www.robinwieruch.de/react-component-composition/
  `children`, multiple children props, slot pattern.
- **[blog]** Robin Wieruch — React Render Props — https://www.robinwieruch.de/react-render-props/
- **[blog]** Robin Wieruch — React "as" Prop — https://www.robinwieruch.de/react-as-prop/
- **[blog]** Robin Wieruch — How to use Props in React — https://www.robinwieruch.de/react-pass-props-to-component/
- **[blog]** Robin Wieruch — React Function Components by Example [2026] — https://www.robinwieruch.de/react-function-component/
- **[blog]** Avoid Prop Drilling using Component Composition (Plain English) — https://plainenglish.io/react/how-to-avoid-prop-drilling-in-react-using-component-composition

### Props typing (TypeScript)
- **[blog]** Total TypeScript (Matt Pocock) — Discriminated Unions for Flexible Component Props — https://www.totaltypescript.com/workshops/advanced-react-with-typescript/advanced-props/type-checking-react-props-with-discriminated-unions/solution
- **[blog]** Developer Way — Advanced TypeScript for React: Discriminated Unions — https://www.developerway.com/posts/advanced-typescript-for-react-developers-discriminated-unions
- **[blog]** Steve Kinney — Complete Guide to React Component Props with TypeScript — https://stevekinney.com/courses/react-typescript/component-props-complete-guide

---

## 3. State, data & business-logic placement (custom hooks, logic↔UI separation, data fetching, RSC, server actions, state mgmt)

### React official — hooks, effects, state structure
- **[primary]** React — Reusing Logic with Custom Hooks — https://react.dev/learn/reusing-logic-with-custom-hooks
  Extract logic into `useXxx`; the name should convey intent, not implementation.
- **[primary]** React — You Might Not Need an Effect — https://react.dev/learn/you-might-not-need-an-effect
  Don't sync state via useEffect; derive during render; Effect anti-patterns.
- **[primary]** React — Rules of Hooks — https://react.dev/reference/rules/rules-of-hooks
- **[primary]** React — Managing State (overview) — https://react.dev/learn/managing-state
- **[primary]** React — Sharing State Between Components (lifting state up) — https://react.dev/learn/sharing-state-between-components
- **[primary]** React — Choosing the State Structure — https://react.dev/learn/choosing-the-state-structure
  Avoid redundant/nested state; prefer a flat single source of truth.
- **[primary]** React — Passing Data Deeply with Context — https://react.dev/learn/passing-data-deeply-with-context
- **[primary]** React — Scaling Up with Reducer and Context — https://react.dev/learn/scaling-up-with-reducer-and-context

### Server / data fetching (Next.js + TanStack Query)
- **[primary]** Next.js — Data Fetching, Caching & Patterns (App Router) — https://nextjs.org/docs/app/getting-started/fetching-data
  Async Server Components, fetch memoization, parallel fetching, preload pattern. (Note: `fetch` default changed to `no-store` in v15 — verify against live docs.)
- **[primary]** Next.js — Server Actions and Mutations — https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations
  Mutations without API endpoints; re-verify auth inside the action.
- **[primary]** Next.js — Data Security (Data Access Layer) — https://nextjs.org/docs/app/guides/data-security
  Keep core logic in a DAL; use `server-only`; pick one fetch strategy.
- **[primary]** TanStack Query v5 — Advanced SSR — https://tanstack.com/query/v5/docs/framework/react/guides/advanced-ssr
- **[blog]** TkDodo — Practical React Query — https://tkdodo.eu/blog/practical-react-query
- **[blog]** TkDodo — React Query as a State Manager — https://tkdodo.eu/blog/react-query-as-a-state-manager
  Server state ≠ client state; don't mirror server state into a global store.
- **[blog]** TkDodo — Creating Query Abstractions (custom hooks per feature) — https://tkdodo.eu/blog/creating-query-abstractions

### State management (client)
- **[secondary]** Bulletproof React — State Management — https://github.com/alan2207/bulletproof-react/blob/master/docs/state-management.md
  State categories: component / application / server cache / form / URL — different tools per category.
- **[blog]** Kent C. Dodds — Application State Management with React — https://kentcdodds.com/blog/application-state-management-with-react
- **[blog]** Kent C. Dodds — State Colocation will make your React app faster — https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster
- **[primary]** Zustand — Comparison — https://zustand.docs.pmnd.rs/learn/getting-started/comparison
- **[primary]** Jotai — Comparison — https://jotai.org/docs/basics/comparison
- **[community]** State Management in 2025: Context vs Redux vs Zustand vs Jotai (dev.to) — https://dev.to/hijazi313/state-management-in-2025-when-to-use-context-redux-zustand-or-jotai-2d2k

---

## 4. Naming, conventions & quality (naming, anti-patterns, linting/typing)

- **[blog]** Robin Wieruch — JavaScript Naming Conventions — https://www.robinwieruch.de/javascript-naming-conventions/
  camelCase variables/functions, PascalCase components/classes, UPPER_SNAKE constants, file naming.
- **[primary]** React — Custom Hook naming (`use` + Capital) — within https://react.dev/learn/reusing-logic-with-custom-hooks
- **[community]** 6 Common React Anti-Patterns Hurting Code Quality (ITNEXT, Juntao Qiu) — https://itnext.io/6-common-react-anti-patterns-that-are-hurting-your-code-quality-904b9c32e933
  Large components mixing logic+presentation+styles; props-as-state; transforming data in useEffect.
- **[blog]** LogRocket — 15 Common useEffect Mistakes — https://blog.logrocket.com/15-common-useeffect-mistakes-react/
- **[community]** Common React Anti-patterns to Avoid (Paulo Evangelista) — https://medium.com/@paulohfev/common-react-anti-patterns-you-should-avoid-eb9b605fded1

---

## Aspect coverage map

| Aspect | Primary sources |
|---|---|
| Folder structure / where things live | Next.js project-structure, Bulletproof React, FSD, Josh Comeau, Robin Wieruch, Kent C. Dodds (colocation), TkDodo (barrels) |
| Component splitting / design | React Thinking in React, Kent C. Dodds (patterns/compound/AHA), patterns.dev, Robin Wieruch (composition), Total TypeScript (props) |
| State / data / business logic | React (custom hooks, you-might-not-need-effect, state docs), Next.js (fetching/server actions/DAL), TanStack Query + TkDodo, Bulletproof React state-mgmt, Zustand/Jotai |
| Naming / conventions / quality | Robin Wieruch naming, anti-pattern catalogs (ITNEXT/LogRocket), ESLint import boundaries (Bulletproof React) |

## Validation notes
- 8 claims were verified 3-0 by adversarial voting — all from Next.js project-structure and Bulletproof React.
- Remaining claims (FSD, server/client component boundaries, barrels) were NOT refuted — they remained "abstain" because the verification stage hit a session limit. Sources are first-party; re-verify version-sensitive facts against live docs before finalizing the skill (esp. Next.js `fetch` caching default and RSC `use client` boundary semantics, which changed between versions).
- `https://profy.dev/article/react-folder-structure` was flagged unreliable (0 verified claims) and is excluded from the curated list.

## Scope boundaries (avoid overlap with sibling skills)
- `react-best-practices` → component purity, hooks misuse, memoization, keys, conditional rendering, render factories. **Not duplicated here.**
- `next-best-practices` → App Router file conventions, RSC boundaries, metadata, image/font optimization. **This skill references structure only where it informs placement decisions.**
