# client — INSIGHTS

> Running log of gotchas, debugging discoveries, and "why it's like this" decisions.
> Append as you learn. Keep entries short; link code with `path:line`.

## Codebase Patterns
- [2026-06-19] Run-cost UI shares `src/lib/format.ts` (`formatCost` → "—" for unknown cost, never "$0.00") and the `RunCostBadge` component (`compact` | `withTokens`) — reuse them, don't re-format cost inline; `client/src/components/run-cost-badge`.
- Live run logs use a native `EventSource` per active run (`useRunEvents`); on reload the
  log is rebuilt from the persisted trace (`GET /runs/:id/trace`), with a 4s polling fallback.
- Global errors (network/5xx) toast; 4xx is silent → handled inline as empty states.
- Theme is driven by CSS variables + `data-theme`/`data-density`, not a Tailwind theme config.
