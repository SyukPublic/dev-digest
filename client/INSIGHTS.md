# client — INSIGHTS

> Running log of gotchas, debugging discoveries, and "why it's like this" decisions.
> Append as you learn. Keep entries short; link code with `path:line`.

## Codebase Patterns
- [2026-06-19] Run-cost UI shares `src/lib/format.ts` (`formatCost` → "—" for unknown cost, never "$0.00") and the `RunCostBadge` component (`compact` | `withTokens`) — reuse them, don't re-format cost inline; `client/src/components/run-cost-badge`.
- Live run logs use a native `EventSource` per active run (`useRunEvents`); on reload the
  log is rebuilt from the persisted trace (`GET /runs/:id/trace`), with a 4s polling fallback.
- Global errors (network/5xx) toast; 4xx is silent → handled inline as empty states.
- Theme is driven by CSS variables + `data-theme`/`data-density`, not a Tailwind theme config.
- [2026-06-20] The PR-list table card (`pulls/styles.ts` `tableCard`) has `overflow:hidden`, so a row-anchored popover positioned `absolute` gets clipped. Render it `position:fixed` from the trigger's `getBoundingClientRect()` and `createPortal` to `document.body`; also `e.stopPropagation()` on the cell + popover so clicks don't trigger the row's navigate-to-PR `onClick`.
- [2026-06-20] One findings popover serves BOTH the PR-list FINDINGS cell and the PR-detail timeline run rows: `pulls/_components/findings-preview/` holds `FindingsFilterPopover` (severity chips + list), `FindingPreviewList`, `SeverityCountBadges`, and shared `styles.ts`. Callers resolve `counts` + `findings` and pass an optional `onPick` (list → navigate to PR; timeline → scroll to the run's accordion). The list cell lazy-loads via `usePrReviews` while open; the timeline already has findings in memory (the PR's reviews, keyed by `run_id`).
- [2026-06-20] Severity tally + filter is a reusable primitive `SeverityFilter` (toggle `Chip`s over `SEV` tokens) shared by the popover and each run's `FindingsPanel`; the filter helper is `visibleFindings(findings, hideLow, activeSeverities?)`. A popover resets its filter to "all on" simply by mounting fresh on open (no key hack), since it only renders while open.
