# client (@devdigest/web) — map for Claude

> A map, not documentation. Links only (no @import). Keep ≤100 lines.

**What this is:** the DevDigest studio — a Next.js 15 app (App Router, RSC) that drives
the whole UI: repos, PRs, diff viewer, agents, settings, live review runs. Pure client
of the Fastify API on :3001; it has NO API routes of its own.

## Use when
- Building/altering a page, component, hook, or data-fetching logic.
- Working on the live run trace (SSE), findings UI, diff viewer, or i18n strings.
- Anything about TanStack Query caching, theming, or the app shell.

## Gotchas / rules
- App state = TanStack Query; React Context is only for the active repo. Don't add a store.
- Talk to the API via `src/lib/api.ts` + hooks in `src/lib/hooks/*`; don't fetch ad hoc.
- UI strings go through next-intl (`messages/en/*.json`), not hardcoded text.
- Check [INSIGHTS.md](./INSIGHTS.md) before changing data/SSE flows.
- After a non-obvious discovery/fix here, append it to INSIGHTS.md via `engineering-insights`.

## Stack
- Next 15 · React 19 · TanStack Query 5 · Tailwind 4 · next-intl 3 · Recharts · Mermaid
- Tests: Vitest + jsdom (fetch mocked; no live API)

## Commands
- dev: `pnpm dev` (:3000) · build: `pnpm build` · test: `pnpm test` · typecheck: `pnpm typecheck`

## Where things live
- `src/app/` — App Router pages (thin routes delegate to colocated `_components/`)
- `src/lib/hooks/` — React Query hooks (`core` · `reviews` · `agents` · `trace` · `repo-intel`)
- `src/lib/api.ts` — typed fetch wrapper · `src/lib/providers.tsx` — Query + theme + toast
- `src/vendor/ui/` — hand-written UI primitives · `src/vendor/shared/` — re-exported contracts
- `messages/en/` — i18n strings

## Conventions (non-default)
- Thin routes, fat colocated `_components/` folders — feature logic lives next to the page.
- No external UI kit (no MUI/shadcn); primitives are vendored in `src/vendor/ui`.
- Theme via CSS variables + `data-theme` / `data-density`, not a Tailwind theme config.
- Live run logs via a native `EventSource` (`useRunEvents`); polling is only the reload fallback.
- Types re-exported from `@devdigest/shared`, never redefined client-side.

## Read when
- UI route map → [README](./README.md)
- deep design → [docs/](./docs/) · feature acceptance → [specs/](./specs/) · lessons/gotchas → [INSIGHTS.md](./INSIGHTS.md)
- API contracts the UI consumes → [../server/README.md](../server/README.md)
