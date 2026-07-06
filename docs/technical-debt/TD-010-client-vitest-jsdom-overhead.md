# TD-010 — Client vitest wall is ~99% jsdom overhead (1465s wall / 10.5s tests)

| | |
|---|---|
| **Area** | `client/` — vitest config + test-suite shape |
| **Severity** | MEDIUM (the pipeline's longest single wait, ×2 with a fix iteration) |
| **Status** | `watch` |
| **Surfaced by** | workflow-retro ([2026-07-06 run](../retros/2026-07-06-brief-onboarding-ui-refinements.md), insight 2) |
| **Detected on** | branch `labs/l05`, recorded 2026-07-06 |
| **Owning skill** | `react-testing-library` (client tests) — consumed by `run-plan` (Stage 3 green barrier) |

## Summary

The full client suite takes **1464.6s wall for 10.5s of actual test time**.
Vitest's own phase report (worker-summed, hence values above wall): setup
1223s, environment 5037s, collect 7271s across **47 jsdom test files** — i.e.
the wall is dominated by per-file jsdom environment creation + module
transform/collect, not by the tests. The green barrier's serial rule (the WSL
`onTaskUpdate` flake — `.claude/agents/INSIGHTS.md` 2026-07-05, "What Doesn't
Work") keeps the client suite off the parallel batch, making this the
pipeline's longest single wait, repeated on every barrier re-run.

## Why it's accepted (for now)

- The candidate fix (`pool: 'threads'` + `isolate: false` — reuse one jsdom
  environment across files) changes semantics for the WHOLE suite: any test
  relying on a clean per-file global state (module mocks, `document` residue,
  globals set in `setup`) can start flaking. It needs a dedicated
  measure-and-verify pass, not a drive-by config edit inside a feature run.
- The suite is green and correct today; the debt is purely wall-clock.

## Risk if left unaddressed

- **Medium.** Every run-plan green barrier pays ~24 min for the client
  package; a fix iteration pays it again. As the suite grows (47 jsdom files
  and counting), the wait scales with file count, not test complexity.

## Paydown options (when a trigger fires)

- `pool: 'threads'` + `isolate: false` in `client/vitest.config.ts` (jsdom
  environment reuse). MUST be followed by a full-suite flake check (≥2 clean
  consecutive runs) and a scan for isolation-dependent tests before adoption.
- Alternatively/additionally: split the heaviest jsdom files (the retro names
  collect as the top cost) or move pure-logic tests off the `jsdom`
  environment to `node`.
- Re-measure with vitest's phase report to confirm the win before locking in.

## Triggers to re-evaluate

- The next run-plan green barrier: re-measure wall vs test time (the retro's
  explicit follow-up).
- Any edit to `client/vitest.config.ts`, or client-suite wall staying the
  dominant pipeline cost across two consecutive retros.
