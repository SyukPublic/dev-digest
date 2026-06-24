# Onion Architecture skill — basis & sources

> Working document the `onion-architecture` skill is built from.
> Captures the research, how Onion maps onto **our** backend, the 9 rules to encode,
> and the full source list. `SKILL.md` / `examples.md` / `references.md` are generated from this.

## What Onion Architecture is (verified against the primary source)

Coined by **Jeffrey Palermo (2008)**. Concentric layers around a domain core with a single
**Dependency Rule: all dependencies point inward.** Outer layers may depend on inner layers,
never the reverse. Palermo's tenets (from [Part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/)):

- **The database is not the center — it is external.** Used as an external storage service, not a foundation.
- **Inner layers define interfaces; outer layers implement them** (Dependency Inversion).
- Coupling flows toward the center; the edges hold what changes often (UI, infrastructure, tests).

Onion is the same family as **Hexagonal (Ports & Adapters)** and **Clean Architecture** — same
dependency-inward idea, different vocabulary. Onion is *domain-first*; Clean is *use-case-first*.

## How it maps onto DevDigest (the structure already exists — the skill codifies & enforces it)

| Onion layer | Where in our code | Tool |
|---|---|---|
| Domain/Application core (pure) | `reviewer-core/src/**` | pure TS |
| Application services (orchestration) | `server/src/modules/<f>/service.ts` | — |
| Ports (interfaces) | `server/src/vendor/shared/adapters.ts` + Zod contracts | Zod 3 |
| Infrastructure adapters | `server/src/adapters/**` (openai/anthropic/openrouter, octokit, simple-git, ripgrep, ast-grep) | vendor SDKs |
| Data access (repositories) | `server/src/modules/<f>/repository.ts` | Drizzle 0.38 |
| Composition root (DI) | `server/src/platform/container.ts` | hand-rolled |
| Presentation / edge | `server/src/modules/<f>/routes.ts` | Fastify 5 |

**Enforcement mechanism:** `dependency-cruiser` (already a dependency via the depgraph adapter) —
forbidden-rules encode the layer direction; run in CI.

## The 9 rules the skill encodes (each gets a good/bad example)

1. **Dependencies point inward** (CRITICAL) — `reviewer-core` stays pure: no DB/git/fs/network except the injected `LLMProvider`.
2. **Adapters only behind interfaces** (CRITICAL) — services depend on interfaces in `@devdigest/shared/adapters.ts`, never on concrete classes.
3. **Instantiate only in the composition root** (HIGH) — adapters/repos created in `platform/container.ts`; tests inject mocks via `ContainerOverrides`.
4. **All DB access lives in repositories** (CRITICAL) — no Drizzle queries in services/routes; repos return domain types, don't leak the query builder.
5. **Zod contracts are the single source of truth at boundaries** (HIGH) — validate at the route edge; the core works with parsed types ("parse, don't validate"); no re-validation inward.
6. **Routes are a thin edge** (HIGH) — validation + service call only; no business logic or direct adapter/DB access.
7. **Facade boundaries** (MEDIUM) — repo-intel only via `container.repoIntel.*`; modules don't reach into its internal pipeline.
8. **Cross-package import direction** (HIGH) — `reviewer-core` never imports `server`; `@devdigest/shared` imports nothing runtime.
9. **Mechanical enforcement** (HIGH) — `dependency-cruiser` forbidden-rules for layer direction, run in CI.

---

## Sources (all links preserved)

### Canonical / primary
- [Palermo — The Onion Architecture: Part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/)
- [Palermo — Part 2 (CodeCampServer)](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/)
- [Palermo — onion-architecture tag (incl. Part 3)](https://jeffreypalermo.com/tag/onion-architecture/)
- [Palermo — Part 4: After Four Years](http://jeffreypalermo.com/blog/onion-architecture-part-4-after-four-years/)
- [Original Palermo example (mirror)](https://github.com/Jordiag/Jeffrey-Palermo-Onion-Architecture)
- [Herberto Graça — Onion Architecture](https://medium.com/the-software-architecture-chronicles/onion-architecture-79529d127f85)
- [Herberto Graça — DDD, Hexagonal, Onion, Clean, CQRS… all together](https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/)

### Explanations & best-practice guides
- [NDepend — Going Beyond Layers](https://blog.ndepend.com/onion-architecture-layers/)
- [DEV (Yasmine) — Onion in DDD](https://dev.to/yasmine_ddec94f4d4/onion-architecture-in-domain-driven-design-ddd-35gn)
- [Serhat Alaftekin — Comprehensive Guide](https://medium.com/@serhatalftkn/onion-architecture-a-comprehensive-guide-for-modern-applications-940f007d0218)
- [Marco Schaefer — Onion explained](https://marcoatschaefer.medium.com/onion-architecture-explained-building-maintainable-software-54996ff8e464)
- [Anton Baksheiev — A Clean Approach](https://medium.com/lets-code-future/understanding-onion-architecture-a-clean-approach-to-software-design-f41af77b72d8)
- [Codefinity — Onion in Software Development](https://codefinity.com/blog/Onion-Architecture-in-Software-Development)
- [Dani Grudzynskyi — Unfolding infrastructure](https://dgrudzynskyi.github.io/dev-blog/architecture/2020/12/18/unfolding-infrastructure-in-onion-architecture.html)
- [Code Maze — Onion in ASP.NET Core](https://code-maze.com/onion-architecture-in-aspnetcore/)
- [Bitloops — Concentric Layers Without Compromise](https://bitloops.com/resources/software-architecture/onion-architecture)
- [Oliver Drotbohm — Sliced Onion Architecture](http://odrotbohm.github.io/2023/07/sliced-onion-architecture/)

### Node.js / TypeScript / Fastify implementations
- [DEV (Remo Jansen) — SOLID + Onion w/ InversifyJS](https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad)
- [GitHub topic — onion-architecture (TS)](https://github.com/topics/onion-architecture?l=typescript)
- [Melzar — onion-architecture-boilerplate](https://github.com/Melzar/onion-architecture-boilerplate)
- [Sankhadip Samanta — Onion in Node.js w/ TS](https://sankhadip.medium.com/onion-architecture-in-node-js-with-typescript-5508612a4391)
- [borjatur — clean-architecture-fastify-mongodb](https://github.com/borjatur/clean-architecture-fastify-mongodb)
- [tonyfreed — fastify-clean-architecture](https://github.com/tonyfreed/fastify-clean-architecture)
- [André Bazaglia — Clean architecture w/ TS: DDD, Onion](https://bazaglia.com/clean-architecture-with-typescript-ddd-onion/)
- [Fastify — official site](https://fastify.dev/)

### Repository pattern & ORM boundary (Drizzle-relevant)
- [Khalil Stemmler — DTOs, Mappers & Repository Pattern](https://khalilstemmler.com/articles/typescript-domain-driven-design/repository-dto-mapper/)
- [vimulatus — Repository Pattern w/ Drizzle ORM](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae)
- [João Batista da Silva — Transactions w/ DDD & Repository (Part 2)](https://medium.com/@joaojbs199/transactions-with-ddd-and-repository-pattern-in-typescript-a-guide-to-good-implementation-part-2-da0af3e10901)
- [Muyiwa-dev — The Repository Pattern](https://medium.com/@muyiwa-dev/the-repository-pattern-ff87cde360ce)
- [Albin Aji — Service–Repository Pattern in Action](https://medium.com/@albinaji.official/service-repository-pattern-in-action-0db4bb9a474b)
- [Abdulrahman Mohamed — Abstraction or Over-Engineering?](https://medium.com/@abied.abiad/the-repository-pattern-your-gateway-to-clean-data-c72235f34916)
- [Alex Rusin — Repository Pattern w/ TS & Prisma](https://blog.alexrusin.com/clean-architecture-in-node-js-implementing-the-repository-pattern-with-typescript-and-prisma/)
- [TheDataGuy — Node.js ORMs in 2025](https://thedataguy.pro/blog/2025/12/nodejs-orm-comparison-2025/)
- [Drizzle ORM — official](https://orm.drizzle.team/)

### Comparison: Hexagonal vs Clean vs Onion
- [CCD Akademie — Clean vs Onion vs Hexagonal](https://ccd-akademie.de/en/clean-architecture-vs-onion-architecture-vs-hexagonal-architecture/)
- [Programming Pulse — Choosing the Right Architecture](https://programmingpulse.vercel.app/blog/hexagonal-vs-clean-vs-onion-architectures)
- [Rup Singh — Practical guide](https://medium.com/@rup.singh88/stop-confusing-clean-onion-hexagonal-architecture-heres-when-to-use-each-692079e56267)
- [Eric Damtoft — Onion vs Clean vs Hexagonal](https://medium.com/@edamtoft/onion-vs-clean-vs-hexagonal-architecture-9ad94a27da91)
- [Thoughtworks — Demystifying architecture patterns](https://www.thoughtworks.com/en-us/insights/blog/architecture/demystify-software-architecture-patterns)
- [Javed Iqbal — Onion vs Hexagonal](https://medium.com/codex/onion-architecture-vs-hexagonal-architecture-67ac670bb691)

### Dependency Inversion / SOLID
- [Wikipedia — Dependency inversion principle](https://en.wikipedia.org/wiki/Dependency_inversion_principle)
- [Vinod Madubashana — SOLID 5: DIP](https://medium.com/@vinod.mby/solid-principles-5-dependency-inversion-principle-10f2b92a200b)
- [HamerSoft — SOLID Part 5: DIP](https://hamersoft.com/2021/03/10/14-solid-part-5-the-dependency-inversion-principle/)
- [Stackify — Dependency Inversion Principle](https://stackify.com/dependency-inversion-principle/)
- [Matthias Schenk — SOLID DIP (Part 5)](https://medium.com/@inzuael/solid-dependency-inversion-principle-part-5-f5bec43ab22e)
- [Arth Cruz — DIP in Clean Architecture](https://arthcruz.dev/en/posts/demystifying_the_dependency_inversion_principle_in_clean_architecture/)

### Validation at boundaries (Zod / DTO / parse-don't-validate)
- [angular.love — Parsing & mapping API response w/ zod](https://angular.love/parsing-and-mapping-api-response-using-zod-js)
- [Aljaz Oblonsek — Zod Types in DTOs](https://medium.com/@aljaz.oblonsek/zod-types-in-class-validator-dtos-a10c5f1732f2)
- [Zod — Defining schemas](https://zod.dev/api)
- [Jeff Segovia — REST API Validation Using Zod](https://jeffsegovia.dev/blogs/rest-api-validation-using-zod)
- [Zod — Intro](https://zod.dev/)
- [OneUptime — Validate Data with Zod in TS](https://oneuptime.com/blog/post/2026-01-25-zod-validation-typescript/view)
- [LogRocket — Schema validation w/ Zod](https://blog.logrocket.com/schema-validation-typescript-zod/)
- [Dimitrios Lytras — Domain Model with Zod & FP-TS](https://dnlytras.com/snippets/domain-zod)

### Enforcement tooling
- [DEV (jacobandrewsky) — Avoid Cross Module Deps w/ dependency-cruiser](https://dev.to/jacobandrewsky/avoid-cross-module-dependencies-with-dependency-cruiser-3b0b)
- [jmulholland — 6 Tools for Enforcing Good Web Architecture](https://jmulholland.com/architecture-tools/)
- [Taynan Duarte — eslint-plugin-boundaries](https://medium.com/@taynan_duarte/ensuring-dependency-rules-in-a-nodejs-application-with-typescript-using-eslint-plugin-boundaries-68b70ce32437)
- [Stefanos Lignos — Module Boundaries in Nx](https://www.stefanos-lignos.dev/posts/nx-module-boundaries)
- [eslint-plugin-boundaries (npm)](https://www.npmjs.com/package/eslint-plugin-boundaries)
- [Xebia — Frontend Architecture w/ dependency-cruiser](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/)
- [Steve Kinney — Architectural Linting](https://stevekinney.com/courses/enterprise-ui/architectural-linting-exercise)
- [Nx — Enforce Module Boundaries ESLint Rule](https://nx.dev/docs/technologies/eslint/eslint-plugin/guides/enforce-module-boundaries)
- [Atomic Object — Dependency Cruiser: Restrict Imports](https://spin.atomicobject.com/dependency-cruiser-imports/)
