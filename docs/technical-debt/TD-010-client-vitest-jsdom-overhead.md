# TD-010 — Client vitest wall was ~99% WSL 9p I/O, not jsdom (2373s → ~9.5s)

| | |
|---|---|
| **Area** | `client/` — test-execution environment (WSL2 + repo on a Windows drive), *not* vitest config |
| **Severity** | MEDIUM (was the pipeline's longest single wait, ×2 with a fix iteration) |
| **Status** | `paid` (2026-07-06 — WSL-native test mirror, `scripts/test-mirror.sh`) |
| **Surfaced by** | workflow-retro ([2026-07-06 run](../retros/2026-07-06-brief-onboarding-ui-refinements.md), insight 2) |
| **Detected on** | branch `labs/l05`, recorded 2026-07-06; root-caused + paid same day |
| **Owning skill** | `react-testing-library` (client tests) — consumed by `run-plan` (Stage 3 green barrier) |

## Summary

The full client suite took **1464.6s wall for 10.5s of actual test time**
(re-measured next run: 2373s / 10.6s — the pipeline's dominant wall-clock
cost). Vitest's phase report blamed per-file jsdom environment creation +
collect (setup 1223s, environment 5037s, collect 7271s worker-summed across
47 jsdom files), which this document originally attributed to vitest config /
test-suite shape.

**That diagnosis was wrong.** The root cause is the filesystem: the repo
lives on `E:\` (Windows drive) and the suite runs inside WSL2 through the
`/mnt/e` **9p bridge** (`mount`: `type 9p (…aname=drvfs;path=E:\…)`). Every
module read crosses 9p, and jsdom/react/RTL module graphs are thousands of
small files.

## Root cause — verified by bisection (2026-07-06)

Same distro (Ubuntu-24.04-dev-digest-test), same Node v22.23.0, same
jsdom 25.0.1, only the filesystem differs:

| Probe | Wall | CPU |
|---|---|---|
| `require('jsdom') + new JSDOM()` from `/mnt/e` (cold) | **82.7s** | ~1.6s user + 3.8s sys |
| Same, warm re-run (9p caching does not help) | 81.6s | — |
| Same from ext4 (`/tmp`) | **0.47s** | 0.45s |

**~175× penalty, pure I/O wait.** This matches the vitest phase report
exactly: one test file (6 tests, 26ms) cost 108.6s Duration, of which
`environment` was 81.2s — one jsdom module-graph load through 9p.

## Resolution — WSL-native test mirror (`scripts/test-mirror.sh`)

`rsync` the package (≈2.5MB: `src/` + `messages/` + configs + lockfile;
`node_modules`/`.next` excluded) to `~/.devdigest-test-mirror/<pkg>` on ext4,
`pnpm install --frozen-lockfile` there (store-linked; `allowBuilds` in the
package's `pnpm-workspace.yaml` covers esbuild/sharp/unrs-resolver, so no
`ERR_PNPM_IGNORED_BUILDS`), run the suite in the mirror. Idempotent; the
mirror's `node_modules` persists across runs.

Measured result (full suite, three consecutive clean runs; ~17.5s
end-to-end through the script incl. rsync + no-op install):

| | Before (9p) | After (mirror, ext4) |
|---|---|---|
| Wall (vitest Duration) | 1464.6s → 2373s | **9.07s / 9.53s / 9.80s** |
| Test files / tests | 47 files | 44 files, 257/257 passed |
| environment (worker-sum) | 5037s | 25–28s |
| collect (worker-sum) | 7271s | 35–36s |

The green barrier on the affected machine now runs the client suite via
`bash scripts/test-mirror.sh client test` inside WSL (see the machine-local
barrier rules; the script itself is machine-agnostic — any `/mnt/*`-hosted
checkout benefits).

**Extended to the server suites (2026-07-06, same day):** the script mirrors
package-specific extras — for `server` it excludes runtime `clones/` + `dist/`
and also mirrors the `reviewer-core` companion (the `../reviewer-core/src`
alias in `server/vitest.config.ts`/`tsconfig.json`; `openai` resolves from
`reviewer-core/node_modules`). Measured, all lanes green:

| server lane | Via 9p | Via mirror |
|---|---|---|
| unit (59 files / 528 tests) | 279.5s | **5.86s / 5.97s** (×47) |
| integration, testcontainers (21 files / 109 tests) | 633.9s | **72.1s** (×8.8, 0 Ryuk flakes) |

Testcontainers is unaffected by the working-tree location
(`test/helpers/pg.ts`: no bind mounts, container URI + Node-side migrations);
`@vscode/ripgrep/bin` is absent under both paths (its postinstall isn't in
`allowBuilds`), so the mirror install reproduces the status quo.

## Rejected option — `pool: 'threads'` + `isolate: false` (measured, do not revisit from memory)

The originally proposed config fix was tested live on vitest 2.1.9 and
rejected:

- At default worker count it changes **nothing**: 8 files = 230.1s (default
  forks+isolate) vs 223.5s (`--pool=threads --no-isolate`) — with 12 cores,
  workers ≥ files, so no environment reuse ever happens.
- Forced reuse (`--maxWorkers=2 --no-isolate`) does cut cost (138.6s,
  environment 73.5s) but **deterministically breaks 5 of 8 files** (14 tests:
  `smoke`, `RunCostBadge`, `CollapsibleCard`, `Button`, `AgentCard` — RTL
  module-level state: `screen`/auto-cleanup bind to the first file's
  `document`, later files query an empty `<body />`).
- Environment-instance reuse under `isolate: false` is **not documented** by
  vitest (v2-pinned docs verified 2026-07-06; the docs only promise
  worker/module-cache reuse). Also note: default pool is `forks` since
  vitest 2.0, and vitest 4 flattens `poolOptions.*`, so the recipe wouldn't
  survive an upgrade as written.
- After the FS fix the entire suite pays ~25s worker-sum for environments —
  the option's ceiling is a few seconds. Risk/benefit is decisively bad.

## Optional hygiene (not performance)

At least 4 pure-logic test files (`helpers.test.ts` ×3,
`why-risk-brief.test.ts`) don't need a DOM; a `// @vitest-environment node`
docblock is semantically cleaner. Worth ~2s total — do opportunistically,
never as a scheduled paydown. (Do NOT use `environmentMatchGlobs` for this:
deprecated in vitest 3, removed in 4 — per-file pragma or `projects`.)

## Triggers to re-evaluate

- Client-suite wall dominates the green barrier again *despite* the mirror →
  re-profile with vitest's phase report before touching config.
- The repo moves to a WSL-native filesystem (or off WSL) → the mirror script
  becomes redundant; retire it.
- `scripts/test-mirror.sh` starts failing on install → check new
  build-script deps against `allowBuilds` (one-time `pnpm approve-builds`).
