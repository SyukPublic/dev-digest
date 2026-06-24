---
name: onion-architecture
description: "Enforces Onion Architecture (dependencies point inward) on the DevDigest backend (server/ Fastify + Drizzle + Zod, and the pure reviewer-core). Use this skill whenever you add or change a backend route, service, repository, adapter, DB query, contract, or DI wiring — and whenever deciding WHERE a piece of logic, an external-tool call (LLM/OpenAI/Anthropic/OpenRouter, GitHub/octokit, git, ripgrep/ast-grep, Postgres), a type, or a validation belongs across layers. Also use when reviewing layering, an import that crosses package/layer boundaries, a leaked Drizzle query, a directly-instantiated SDK client, or business logic creeping into a route. Trigger terms: onion architecture, layer, dependency direction/rule, ports and adapters, repository, service, adapter, composition root, container, dependency inversion, where should this live, layering violation."
---

# Onion Architecture (DevDigest backend)

Keeps the backend's dependencies pointing **inward**: the pure domain core
(`reviewer-core`) knows nothing about the database, GitHub, git, or any SDK;
those are replaceable outer details reached only through interfaces. This skill is
about **layers, dependency direction, and where each kind of code lives** — not
how to write a Fastify route, a Drizzle query, or a Zod schema (those have their
own skills).

For a good/bad code example per rule see [examples.md](examples.md); for sources
and the canonical definition see [references.md](references.md).

Sibling skills (do not duplicate — defer to them for mechanics):
- `fastify-best-practices` → route/plugin/hook mechanics, JSON-schema validation, error handling.
- `drizzle-orm-patterns` → how to write queries, relations, transactions, migrations.
- `zod` → how to author schemas, `safeParse`, `z.infer`, refinements.
- `react-frontend-architecture` → the same "where does it live" question for the **frontend**.

## Severity Levels

- **CRITICAL** — Breaks the dependency rule or leaks infrastructure into the core. Destroys testability and the ability to swap implementations; the core stops being pure.
- **HIGH** — Erodes a boundary (DB/SDK escapes its layer, logic in the wrong place). Compiles and runs, but couples layers and makes tests need real I/O.
- **MEDIUM** — Hurts navigability or invites future erosion.

## The layers (outer → inner) and where they live in this repo

Dependencies may point **only inward** (toward the core). Nothing inner may import
anything outer.

| Layer | Where | Tool |
|---|---|---|
| Presentation / edge | `server/src/modules/<f>/routes.ts` | Fastify 5 |
| Application services | `server/src/modules/<f>/service.ts` (+ `run-executor.ts`, `helpers.ts`) | — |
| Ports (interfaces) | `server/src/vendor/shared/adapters.ts` + Zod contracts in `vendor/shared/contracts/` | Zod 3 |
| Infrastructure adapters | `server/src/adapters/**` (llm, github, git, codeindex, embedder, depgraph, tokenizer, secrets, auth) | vendor SDKs |
| Data access (repositories) | `server/src/modules/<f>/repository.ts` (+ `repository/*.repo.ts`) | Drizzle 0.38 |
| Composition root (DI) | `server/src/platform/container.ts` | hand-rolled |
| Domain / application core (pure) | `reviewer-core/src/**` | pure TS |

> The structure already exists in DevDigest. This skill's job is to keep new code
> inside it, because the boundaries quietly erode exactly when a change "feels routine".

## Guiding principle

**The database, the LLM, GitHub, and git are external details, not the center.**
Inner layers define interfaces; outer layers implement them. When you don't know
where something goes, ask: *"what does this depend on?"* — and place it so its
dependencies point inward, never outward.

---

## 1. Dependencies point inward — `reviewer-core` stays pure (CRITICAL)

`reviewer-core` is the innermost layer. Its only side effect is the **injected**
`LLMProvider`. No `db`, `octokit`, `fs`, `simple-git`, `fetch`, or `process.env`.
The diff is an **input**, never something it fetches. If you reach for I/O here, the
logic belongs in the server (a service or adapter), not in the core.

Why: purity is what lets the engine run identically in the studio and the CI runner,
and be tested with a fake `LLMProvider` and no infrastructure. One real import of
`fs`/`db` ends that. (See `reviewer-core/AGENTS.md` — "The invariant".)

## 2. External systems only behind interfaces (CRITICAL)

Every outside system is reached through an interface declared in
`server/src/vendor/shared/adapters.ts` (`LLMProvider`, `GitHubClient`, `GitClient`,
`CodeIndex`, `Embedder`, `SecretsProvider`, `AuthProvider`). Services and the core
depend on the **interface**, never on a concrete adapter class.

Never `import { OpenAIProvider }` (or `Octokit`, `simple-git`, the `postgres`
client…) into a service or the core. That inverts the dependency arrow and forces
real network/credentials into tests.

## 3. Instantiate only in the composition root (HIGH)

Concrete adapters and repositories are constructed **only** in
`server/src/platform/container.ts` (lazily, resolving secrets). Everything else
receives them via the `Container`. Tests inject fakes through `ContainerOverrides`
— that is the whole point of the indirection.

A `new SomeAdapter(...)` outside the container is a smell: it can't be overridden in
tests and it hard-wires a choice the composition root should own.

## 4. All DB access lives in repositories (CRITICAL)

Drizzle (`db`, `t.*` tables, `eq/and/desc`) appears **only** in
`modules/<f>/repository.ts` / `repository/*.repo.ts`. Services and routes call
repository methods; they never build queries. Repositories return **domain
types / rows**, not a Drizzle query builder or a half-built query — that would leak
the ORM upward and let callers depend on its shape.

Why: the repository is the seam that keeps "what we store" swappable and lets the
service be tested without a database. A leaked query builder re-couples every caller
to Drizzle.

## 5. Zod contracts are the single source of truth at boundaries (HIGH)

Validate **once, at the edge**: parse untrusted input at the route and parse/serialize
output via `fastify-type-provider-zod`, using the shared schemas in
`@devdigest/shared` (`vendor/shared/contracts/`). Inward of that boundary, code works
with the already-parsed types (`z.infer`) — **parse, don't validate**; don't
re-validate the same data deeper in. Don't redefine a contract per layer; extend
`@devdigest/shared` with a **new** file (never edit the barrel).

Why: one gate means one place to trust. Re-validation inward is dead weight and drifts
out of sync; redefining shapes per layer breaks the single source of truth.

## 6. Routes are a thin edge (HIGH)

A route does three things: read context/auth, parse the request with a contract, call
**one** service method, return its result. No business logic, no Drizzle, no adapter
calls, no `new`-ing services-with-logic in the handler body.

Why: keeping orchestration in the service (not the handler) is what lets the same
logic be reused (CI runner, jobs) and tested without an HTTP layer.

## 7. Respect facade boundaries (MEDIUM)

Cross-cutting subsystems are reached only through their published facade —
repo-intel **only** via `container.repoIntel.*`, never by importing files from
`modules/repo-intel/`'s internal pipeline. Shared entities (agents, reviews) are
reached via `container.agentsRepo` / `container.reviewRepo`, not by deep-importing
another module's repository.

Why: the facade is the contract; reaching past it couples you to internals that are
free to change behind it.

## 8. Cross-package import direction (HIGH)

`reviewer-core` must never import from `server`. `@devdigest/shared` must import
nothing runtime (only Zod + its own contracts) — it sits at the center so every
package can depend on it. The arrows: `server → reviewer-core → shared` and
`server → shared`; never the reverse.

Why: a back-edge (core importing server) makes the "pure, shareable" core
un-shareable and creates import cycles.

## 9. Enforce the boundaries mechanically (HIGH)

Conventions erode; a check in CI doesn't. Encode the dependency rule as
`dependency-cruiser` **forbidden** rules (it's already a dependency here, used by the
depgraph adapter) and run it in CI. At minimum forbid:
- `reviewer-core` → `server` (rule 8)
- `modules/**/{routes,service}.ts` → `drizzle-orm` (rule 4: DB only in repositories)
- `modules/**/service.ts` & `reviewer-core/**` → `adapters/**` concrete impls (rule 2)
- any import into another module's internal `repository/` / `repo-intel` pipeline (rule 7)
- circular dependencies (`no-circular`).

See [examples.md](examples.md) for a ready-to-adapt `.dependency-cruiser.cjs`
`forbidden` block and the `package.json` script. `eslint-plugin-boundaries` is an
optional second, in-editor line of defense (faster feedback than CI).

---

## Quick placement checklist

When adding backend code, ask in order:
1. Does it touch an external system (DB, LLM, GitHub, git, fs)? → behind an **adapter interface** (or a **repository** for the DB), constructed in the **container**.
2. Is it orchestration / a use case? → a **service** method.
3. Is it pure review logic (prompt/grounding/scoring)? → **reviewer-core** (and keep it pure).
4. Is it HTTP shape (params/body/response)? → a **route** + a **Zod contract** in `@devdigest/shared`.
5. Does my import point **outward**? → stop; invert it with an interface.
