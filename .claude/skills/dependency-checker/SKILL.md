---
name: dependency-checker
description: Analyze and visualize a repository's dependencies — external npm packages AND internal cross-package / path-alias links — then draw a Mermaid dependency graph, weigh each package by installed size, and produce a prioritized findings report (P0/P1/P2/Info) with concrete, actionable recommendations. Use this skill whenever the user asks to audit, map, or check dependencies; wants a dependency graph or diagram; asks about bundle/package size or how heavy a package is or what it pulls in; suspects unused or duplicate dependencies; wants to find version drift across packages; or asks for a dependency health-check of the whole repo or one component — even if they never say "dependency-checker". Trigger terms — dependency checker, dependency graph, dependency audit, dependency map, package size, bundle size, node_modules size, unused dependencies, duplicate dependencies, version drift, залежності, граф залежностей, розмір пакетів, аудит залежностей, невикористані залежності.
---

# Dependency Checker

Produce a **structured, developer-facing dependency report** for a repo (or one component): a
dependency graph, per-package size, and a prioritized list of findings with concrete
recommendations. The value is a report an engineer can act on in minutes — not a raw dump of
`package.json` — so every claim is grounded in gathered data and every finding names a *specific*
package, dependency, or file.

**This skill is read-only and advisory.** It NEVER installs, removes, upgrades, moves, or dedupes
anything, and it never runs a mutating package-manager command (`npm/pnpm/yarn add|remove|up`,
`dedupe`, edits to `package.json`). Removals and upgrades are presented as recommendations for the
user to confirm and run themselves. Say what to change and why — do not claim you changed it.

## Workflow

1. **Gather** the dependency facts (Step 1).
2. **Classify** them: external vs internal, and by severity (Step 2).
3. **Report** using the required template (Step 3). Do not skip a section; if a section is empty,
   say so explicitly (e.g. "No version drift detected") rather than dropping it.

## Step 1 — Gather the data

**If the prompt already contains the dependency data** (declared deps, sizes, imports, drift), treat
it as already collected and go straight to the report — do not ask for tool access or stall.

**Otherwise, gather it from the repo.** Prefer the bundled collector — it is deterministic and
cross-platform (pure Node ≥22, no `du`/`grep` shell-outs, no extra deps), so you get the same facts
every run instead of assembling them ad-hoc:

```bash
node .claude/skills/dependency-checker/scripts/collect-deps.mjs            # human-readable block
node .claude/skills/dependency-checker/scripts/collect-deps.mjs . --json   # machine-readable JSON
node .claude/skills/dependency-checker/scripts/collect-deps.mjs client     # scope to one component
```

The collector — see [scripts/collect-deps.mjs](scripts/collect-deps.mjs) — emits, per component:
declared runtime/dev dependencies, tsconfig **path aliases**, approximate installed **size** (own
footprint; `n/a` when a package isn't installed), detected **internal / cross-package links**
(alias, cross-package-relative, deep imports into another package's `src/`), **version drift**
(same dep at different versions across components), and **possibly-unused** runtime deps (declared
but never imported). It also emits a **ready-to-paste Mermaid graph** (the
`## Dependency graph (Mermaid)` section; `mermaid` field in JSON) with sanitized node IDs and the
edge conventions below already applied — paste it into the report's "Dependency graph" section and
trim if noisy, rather than redrawing it from scratch.

If you gather manually instead, collect the same facts: read each component's `package.json`
(`dependencies` + `devDependencies`) and `tsconfig.json` (`compilerOptions.paths`); size the
installed packages; and grep the source for cross-component imports and for whether each declared
dependency is actually imported.

**Treat the collector's heuristics as leads, not verdicts.** "Possibly unused" catches real dead
deps but also flags side-effect imports (`import "dotenv/config"`), binary-only packages
(`@vscode/ripgrep`), and config-referenced plugins (`@fastify/autoload`) — verify by grepping for
the package name and its side-effect/subpath forms before you recommend removing it.

## Step 2 — Classify

**External vs internal — never conflate them.** They have different fixes.
- **External** = published npm packages in `dependencies` / `devDependencies`. Concerns: size,
  duplication, version drift, unused, known-vulnerable versions.
- **Internal** = one component depending on another *inside this repo* — via a tsconfig **path
  alias** (`@shared/*`, `@devdigest/reviewer-core`) or a **relative cross-package import**. Concern:
  is the dependency direction and entry-point discipline correct?

**Know the repo topology before you name it.** DevDigest is **not a monorepo / npm workspace** —
each package (`server/`, `client/`, `reviewer-core/`, `e2e/`, `mcp/`, `evals/`) has its own
`package.json` + lockfile and they are wired by **tsconfig path aliases**, not `workspace:*`. Never
claim packages are linked via workspaces / `workspace:*` / pnpm workspaces unless an actual
workspace file (`pnpm-workspace.yaml` with a `packages:` list) exists and says so.

**Severity rubric** — assign each finding exactly one tier:

- **P0 — correctness / boundary / security.** A **deep import into another package's internals**
  (e.g. importing `reviewer-core/src/pipeline.js` by relative path instead of the package's public
  entry point) — it bypasses the module's contract and breaks the dependency direction. Also:
  a known-vulnerable version, a wrong/mismatched version that breaks types or runtime, or a
  dependency that leaks secrets.
- **P1 — high-value cleanup.** A confirmed **unused** dependency that still ships; a **heavy**
  dependency with a materially lighter standard alternative (e.g. `moment` → `date-fns` / `Intl`);
  the same dependency **duplicated at different versions** where it causes bloat or subtle bugs.
- **P2 — optimization.** Dedupe drifting versions to one, move a build-only dep to
  `devDependencies`, tighten a loose range, tree-shake a partially-used package.
- **Info — observation, no action needed.** Notable but fine as-is (e.g. an expected large dev-only
  package like a test runner or browser driver).

## Step 3 — Write the report

Use **exactly this structure and these section names**, in this order. Keep tables and the Mermaid
block; fill them from Step 1's data.

```markdown
# Dependency Report — <repo or component name>

## Scope
Which components were analyzed (e.g. client, server, reviewer-core, e2e) and what was included
(runtime vs dev deps; internal links). One or two lines.

## Dependency graph
A Mermaid `flowchart` of how the components depend on each other, plus their heaviest external
deps. Internal links are solid edges (thick `==>` for a deep import into another package's
internals — a P0 candidate); external deps are leaf nodes on dotted edges. Example:

```mermaid
flowchart LR
  subgraph internal[Internal packages]
    server[server]
    client[client]
    core[reviewer-core]
  end
  client -->|@shared alias| server
  server -->|@devdigest/reviewer-core| core
  server -.->|npm| fastify([fastify])
  client -.->|npm| next([next 132M])
```

## Size breakdown
A table — one row per notable dependency — sorted heaviest first. Include the installed size so the
weight is concrete, not a vague "this is large".

| Component | Dependency | Version | Scope | Installed size |
|---|---|---|---|---|
| client | next | 15.0.3 | runtime | 132M |
| e2e | playwright | 1.48.2 | dev | 210M |
| server | moment | 2.30.1 | runtime | 4.2M |

## Findings & Priorities
Group findings under explicit severity headings. Every finding names a specific package,
dependency, or file and its location — never generic advice like "consider optimizing dependencies".

### P0
- **`reviewer-core/src/pipeline.js` imported by relative path** from
  `server/src/services/review-service.ts` — bypasses reviewer-core's public entry point and breaks
  the dependency direction. Recommendation: import via the package's public API instead.

### P1
- **`moment` (server/package.json, 4.2M) is unused** — no import of it exists under `server/src`.
  Recommendation: drop it (confirm first) and use `date-fns` / `Intl`, already lighter alternatives.

### P2
- **`zod` version drift** — server 3.23.8, client 3.22.4, reviewer-core 3.23.8. Recommendation:
  align all three to one version to avoid duplicate installs and type mismatches.

### Info
- **`playwright` (e2e, 210M)** is large but expected for a browser test runner — no action.

## Summary
3–5 concrete, actionable takeaways ordered by priority. Each is a one-line "do X to Y".

1. Fix the deep import into `reviewer-core/src` (P0) — route through its public entry point.
2. Remove unused `moment` from server (P1, ~4.2M) after confirming.
3. Align the three `zod` versions to one (P2).
```

### Rules that keep the report useful

- **Be specific.** Every finding cites a real package / dependency / file and its `package.json`
  path or import site. If you can't ground it, don't include it.
- **Distinguish internal from external** in both the graph and the findings — a path-alias link and
  an npm package are different kinds of dependency with different fixes.
- **Ground sizes and versions in the gathered data.** If a size is unknown (`n/a`), say so — never
  invent a number. If nothing is installed, report from `package.json` and note sizes are unavailable.
- **Stay advisory.** Frame every removal / upgrade / move as a recommendation for the user to
  confirm and run. Do not execute it and do not claim you did.
- **Right-size the report.** For a single-component request, scope the graph and tables to that
  component; for a whole-repo audit, cover every component named in Scope.
