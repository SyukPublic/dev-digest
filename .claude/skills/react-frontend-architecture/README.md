# React Frontend Architecture — basis & sources

> Working document the `react-frontend-architecture` skill is built from.
> Captures the research, how the four aspects map onto the skill's rules and examples,
> and the full source list (all links preserved). [SKILL.md](SKILL.md),
> [examples.md](examples.md), and [references.md](references.md) derive from this.
> Researched 2026-06-22 — `deep-research` workflow (fan-out search + adversarial
> verification) + manual gap-fill; version-sensitive facts re-checked against live docs.

## What this skill is & scope

This skill governs **where code lives and how it is split** — project structure, file
organization, and code-placement conventions for **React 19 + Next.js 15 (App Router)**,
across project scales (small → enterprise). It is **stack-agnostic** at its core: the
principles apply to any React/Next codebase.

It deliberately does **not** cover component runtime correctness or framework mechanics —
those live in sibling skills, and this skill cites them rather than repeating them:

- **`react-best-practices`** → component purity, hooks misuse, memoization, keys,
  conditional rendering, render factories.
- **`next-best-practices`** → App Router file conventions, RSC mechanics, metadata,
  image/font optimization.

The guiding principle throughout is **colocation** ("place code as close to where it's used
as possible") and **AHA** (*Avoid Hasty Abstractions* — promote to a shared layer only when
a second consumer actually appears).

## Research synthesis (the four aspects)

### 1. Folder structure & where things live
- Organize **by feature/domain, not by technical role**; type-based grouping suits tiny apps
  but scales poorly (low cohesion, high coupling) — [Bulletproof React](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md),
  [Feature-Sliced Design](https://feature-sliced.design/blog/frontend-folder-structure).
- **Colocation is safe and preferred**; Next.js is unopinionated and a route is public only
  with `page.js`/`route.js`, so files can live next to where they're used — [Next.js](https://nextjs.org/docs/app/getting-started/project-structure),
  [Kent C. Dodds](https://kentcdodds.com/blog/colocation).
- **utils vs helpers** are distinct: util = generic/pure/shareable; helper = project-specific;
  `utils/` should hold pure functions only — [Josh W. Comeau](https://www.joshwcomeau.com/react/file-structure/),
  [Web Dev Simplified](https://blog.webdevsimplified.com/2022-07/react-folder-structure/). Promote a util to
  shared only once 2+ features need it — [Sandro Roth](https://sandroroth.com/blog/project-structure/).
- **Barrel `index.ts` files are discouraged** (broken tree-shaking, slow bundlers, circular
  deps); import directly — [TkDodo](https://tkdodo.eu/blog/please-stop-using-barrel-files), [Bulletproof React](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md).
- Use **path aliases** over deep relative chains; constants/types live in dedicated, domain-split files.

### 2. Component design & splitting
- Split the UI into a **single-responsibility** hierarchy — [React, Thinking in React](https://react.dev/learn/thinking-in-react).
- **Composition over configuration**: prefer `children`/slots over accreting config props;
  use composition to avoid prop drilling before reaching for context — [Kent C. Dodds, Prop Drilling](https://kentcdodds.com/blog/prop-drilling),
  [Robin Wieruch, Composition](https://www.robinwieruch.de/react-component-composition/).
- **Compound components** for cohesive widget families; container/presentational remains a
  useful mental split (hooks now do much of it) — [Kent C. Dodds, Patterns](https://kentcdodds.com/blog/advanced-react-component-patterns),
  [patterns.dev](https://www.patterns.dev/react/presentational-container-pattern/).
- Model mutually-exclusive props with **discriminated unions** so invalid states are
  unrepresentable — [Total TypeScript](https://www.totaltypescript.com/workshops/advanced-react-with-typescript/advanced-props/type-checking-react-props-with-discriminated-unions/solution),
  [Developer Way](https://www.developerway.com/posts/advanced-typescript-for-react-developers-discriminated-unions).

### 3. State, data & business-logic placement
- **Components render; they don't hold business logic.** Extract stateful logic into custom
  hooks, pure logic into plain functions — [React, Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks).
- **Server state ≠ client state**: server data belongs in a server-cache library (TanStack
  Query), not mirrored into a global store — [TkDodo](https://tkdodo.eu/blog/react-query-as-a-state-manager).
- **Choose the state tool by category** (component / URL / server-cache / app-wide) —
  [Bulletproof React, State Management](https://github.com/alan2207/bulletproof-react/blob/master/docs/state-management.md);
  colocate client state and lift only when needed — [Kent C. Dodds](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster).
- In RSC apps keep data fetching/secrets/logic on the server (`server-only`, a Data Access
  Layer) and re-verify auth inside server actions — [Next.js Data Security](https://nextjs.org/docs/app/guides/data-security).

### 4. Naming, conventions & quality
- `PascalCase` components/files, `useCamelCase` hooks (name conveys intent), `camelCase`
  vars, `UPPER_SNAKE_CASE` constants, consistent folder casing — [Robin Wieruch](https://www.robinwieruch.de/javascript-naming-conventions/).
- Explicit file roles aid search (`order.constants.ts`, `cart.types.ts`) over ambiguous
  `index.ts`/`utils.ts`.
- Catalogued anti-patterns: god components, type-based sprawl, cross-feature reach-ins,
  barrels, deep relative imports, logic in component bodies — [ITNEXT](https://itnext.io/6-common-react-anti-patterns-that-are-hurting-your-code-quality-904b9c32e933),
  [LogRocket](https://blog.logrocket.com/15-common-useeffect-mistakes-react/).

> **Version-sensitive facts verified live (2026-06-22):** in the App Router, Server
> Components are the default and `'use client'` declares a boundary (Server Components passed
> as `children`/props stay server-rendered); push `'use client'` to leaf interactive
> components; `fetch` is **not** cached by default in modern Next.js — opt into caching
> explicitly. These were confirmed against the current Next.js docs, not recalled.

## Mapping (aspect → rule → example → sources)

| Aspect | [SKILL.md](SKILL.md) section(s) | [examples.md](examples.md) | Key sources |
|---|---|---|---|
| **1. Folder structure & placement** | Guiding principle · Project Structure · Where each kind of code lives · Import boundaries & dependency direction · Barrel files · Path aliases | 1 (feature vs type) · 2 (utils/helpers/constants) · 5 (import boundaries) · 6 (barrels) · 7 (path aliases) | Next.js project-structure · Bulletproof React · Feature-Sliced Design · Josh Comeau · Robin Wieruch · Kent C. Dodds (colocation) · TkDodo (barrels) |
| **2. Component design & splitting** | Component splitting & design · Props design | 8 (composition over config) · 9 (children vs prop drilling) · 10 (discriminated unions) | React (Thinking in React) · Kent C. Dodds (patterns/compound/AHA/prop-drilling) · patterns.dev · Robin Wieruch (composition) · Total TypeScript / Developer Way (props) |
| **3. State, data & business logic** | Where business logic lives · State, data & logic placement | 3 (logic out of components) · 4 (server-only code) · 11 (server vs client state) · 12 (state by category) | React (custom hooks, you-might-not-need-effect, state docs) · Next.js (fetching/server actions/DAL) · TanStack Query + TkDodo · Bulletproof React (state-mgmt) · Zustand/Jotai |
| **4. Naming, conventions & quality** | Naming conventions · Anti-patterns catalog | 13 (naming) | Robin Wieruch (naming) · ITNEXT / LogRocket (anti-patterns) · Bulletproof React (ESLint import boundaries) |

## How this applies to DevDigest `client/` (Next 15)

The repo's [client/](../../../client/AGENTS.md) is Next 15 (App Router) + React 19 + TanStack
Query — exactly this skill's target stack — so the rules apply directly: feature-based
structure under `client/`, server/client boundary placement (`'use client'` at leaves,
data/secrets on the server), and **server state via TanStack Query** rather than a global
store. The skill stays vendor-agnostic; treat this only as the orientation note for where it
lands in DevDigest. (Sibling skills `next-best-practices` and `react-best-practices` cover the
framework mechanics and runtime rules referenced above.)

---

## Sources (all links preserved)

Quality legend: **[primary]** official docs / first-party · **[secondary]** authoritative
aggregators · **[blog]** recognized practitioners · **[community]** community round-ups.

### Folder / project structure & where things live
- **[primary]** [Next.js — Project Structure & Organization](https://nextjs.org/docs/app/getting-started/project-structure)
- **[primary]** [Bulletproof React — Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)
- **[primary]** [Bulletproof React (repo root)](https://github.com/alan2207/bulletproof-react)
- **[primary]** [Feature-Sliced Design — Layers reference](https://feature-sliced.design/docs/reference/layers)
- **[primary]** [Feature-Sliced Design — Scalable React Architecture](https://feature-sliced.design/blog/scalable-react-architecture)
- **[primary]** [Feature-Sliced Design — Frontend Folder Structure](https://feature-sliced.design/blog/frontend-folder-structure)
- **[blog]** [Josh W. Comeau — Delightful React File/Directory Structure](https://www.joshwcomeau.com/react/file-structure/)
- **[blog]** [Robin Wieruch — React Folder Structure Best Practices [2026]](https://www.robinwieruch.de/react-folder-structure/)
- **[blog]** [Robin Wieruch — Feature-based React Architecture](https://www.robinwieruch.de/react-feature-architecture/)
- **[blog]** [Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation)
- **[blog]** [Sandro Roth — Project Structure](https://sandroroth.com/blog/project-structure/)
- **[blog]** [Next.js 15 — Best Practices for Organizing (dev.to, Bajrayejoon)](https://dev.to/bajrayejoon/best-practices-for-organizing-your-nextjs-15-2025-53ji)
- **[blog]** [Web Dev Simplified — How To Structure React Projects (Beginner → Advanced)](https://blog.webdevsimplified.com/2022-07/react-folder-structure/)
- **[blog]** [Tania Rascia — How to Structure and Organize a React Application](https://www.taniarascia.com/react-architecture-directory-structure/)
- **[community]** [Recommended Folder Structure for React 2025 (dev.to, Pramod Boda)](https://dev.to/pramod_boda/recommended-folder-structure-for-react-2025-48mc)

#### Barrel files & path aliases
- **[blog]** [TkDodo — Please Stop Using Barrel Files](https://tkdodo.eu/blog/please-stop-using-barrel-files)

### Component design & splitting
- **[primary]** [React — Thinking in React](https://react.dev/learn/thinking-in-react)
- **[primary]** [React — Components and Hooks must be pure](https://react.dev/reference/rules/components-and-hooks-must-be-pure)
- **[blog]** [Kent C. Dodds — Advanced React Component Patterns](https://kentcdodds.com/blog/advanced-react-component-patterns)
- **[blog]** [Kent C. Dodds — Compound Components with React Hooks](https://kentcdodds.com/blog/compound-components-with-react-hooks)
- **[blog]** [Kent C. Dodds — AHA Programming (Avoid Hasty Abstractions)](https://kentcdodds.com/blog/aha-programming)
- **[blog]** [Kent C. Dodds — Prop Drilling](https://kentcdodds.com/blog/prop-drilling)
- **[secondary]** [patterns.dev — Presentational/Container Pattern](https://www.patterns.dev/react/presentational-container-pattern/)
- **[blog]** [Robin Wieruch — React Component Composition](https://www.robinwieruch.de/react-component-composition/)
- **[blog]** [Robin Wieruch — React Render Props](https://www.robinwieruch.de/react-render-props/)
- **[blog]** [Robin Wieruch — React "as" Prop](https://www.robinwieruch.de/react-as-prop/)
- **[blog]** [Robin Wieruch — How to use Props in React](https://www.robinwieruch.de/react-pass-props-to-component/)
- **[blog]** [Robin Wieruch — React Function Components by Example [2026]](https://www.robinwieruch.de/react-function-component/)
- **[blog]** [Avoid Prop Drilling using Component Composition (Plain English)](https://plainenglish.io/react/how-to-avoid-prop-drilling-in-react-using-component-composition)

#### Props typing (TypeScript)
- **[blog]** [Total TypeScript (Matt Pocock) — Discriminated Unions for Flexible Component Props](https://www.totaltypescript.com/workshops/advanced-react-with-typescript/advanced-props/type-checking-react-props-with-discriminated-unions/solution)
- **[blog]** [Developer Way — Advanced TypeScript for React: Discriminated Unions](https://www.developerway.com/posts/advanced-typescript-for-react-developers-discriminated-unions)
- **[blog]** [Steve Kinney — Complete Guide to React Component Props with TypeScript](https://stevekinney.com/courses/react-typescript/component-props-complete-guide)

### State, data & business-logic placement
- **[primary]** [React — Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks)
- **[primary]** [React — You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- **[primary]** [React — Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks)
- **[primary]** [React — Managing State (overview)](https://react.dev/learn/managing-state)
- **[primary]** [React — Sharing State Between Components (lifting state up)](https://react.dev/learn/sharing-state-between-components)
- **[primary]** [React — Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure)
- **[primary]** [React — Passing Data Deeply with Context](https://react.dev/learn/passing-data-deeply-with-context)
- **[primary]** [React — Scaling Up with Reducer and Context](https://react.dev/learn/scaling-up-with-reducer-and-context)
- **[primary]** [Next.js — Data Fetching, Caching & Patterns (App Router)](https://nextjs.org/docs/app/getting-started/fetching-data)
- **[primary]** [Next.js — Server Actions and Mutations](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations)
- **[primary]** [Next.js — Data Security (Data Access Layer)](https://nextjs.org/docs/app/guides/data-security)
- **[primary]** [TanStack Query v5 — Advanced SSR](https://tanstack.com/query/v5/docs/framework/react/guides/advanced-ssr)
- **[blog]** [TkDodo — Practical React Query](https://tkdodo.eu/blog/practical-react-query)
- **[blog]** [TkDodo — React Query as a State Manager](https://tkdodo.eu/blog/react-query-as-a-state-manager)
- **[blog]** [TkDodo — Creating Query Abstractions (custom hooks per feature)](https://tkdodo.eu/blog/creating-query-abstractions)
- **[secondary]** [Bulletproof React — State Management](https://github.com/alan2207/bulletproof-react/blob/master/docs/state-management.md)
- **[blog]** [Kent C. Dodds — Application State Management with React](https://kentcdodds.com/blog/application-state-management-with-react)
- **[blog]** [Kent C. Dodds — State Colocation will make your React app faster](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster)
- **[primary]** [Zustand — Comparison](https://zustand.docs.pmnd.rs/learn/getting-started/comparison)
- **[primary]** [Jotai — Comparison](https://jotai.org/docs/basics/comparison)
- **[community]** [State Management in 2025: Context vs Redux vs Zustand vs Jotai (dev.to)](https://dev.to/hijazi313/state-management-in-2025-when-to-use-context-redux-zustand-or-jotai-2d2k)

### Naming, conventions & quality
- **[blog]** [Robin Wieruch — JavaScript Naming Conventions](https://www.robinwieruch.de/javascript-naming-conventions/)
- **[primary]** [React — Custom Hook naming (`use` + Capital)](https://react.dev/learn/reusing-logic-with-custom-hooks)
- **[community]** [6 Common React Anti-Patterns Hurting Code Quality (ITNEXT, Juntao Qiu)](https://itnext.io/6-common-react-anti-patterns-that-are-hurting-your-code-quality-904b9c32e933)
- **[blog]** [LogRocket — 15 Common useEffect Mistakes](https://blog.logrocket.com/15-common-useeffect-mistakes-react/)
- **[community]** [Common React Anti-patterns to Avoid (Paulo Evangelista)](https://medium.com/@paulohfev/common-react-anti-patterns-you-should-avoid-eb9b605fded1)

## Methodology & validation
- Gathered via the `deep-research` workflow (5-angle fan-out web search + adversarial
  3-vote verification) plus manual gap-filling for the official react.dev / Next.js guides,
  Kent C. Dodds, Josh Comeau, and state-management sources.
- 8 claims passed 3-0 adversarial verification (Next.js project-structure + Bulletproof
  React); remaining first-party claims (FSD, server/client boundaries, barrels) were not
  refuted. Version-sensitive facts (RSC defaults, `'use client'` boundary, `fetch` caching)
  were re-checked against live Next.js docs on 2026-06-22.
- `https://profy.dev/article/react-folder-structure` was flagged unreliable (0 verified
  claims) and is **excluded**.
- For the per-rule annotated breakdown, see [references.md](references.md).
