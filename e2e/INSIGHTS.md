# e2e — INSIGHTS

> Running log of gotchas, debugging discoveries, and "why it's like this" decisions.
> Append as you learn. Keep entries short; link code with `path:line`.

## Codebase Patterns
- No LLM is ever called — never use agent-browser's `chat`; deterministic locators only.
- Assertions are `wait --text`/`wait --url` timing out (non-zero exit), not a DSL.
- [2026-07-06] On a 9p-mounted repo (WSL `/mnt/e`, TD-010 class) the API boots ~86s under tsx and
  next-dev cold-compiles a route on first hit (34s for `/settings/api-keys`) — `scripts/e2e.sh`
  therefore warms cold routes with `curl` after "web up" and exposes `E2E_BOOT_TIMEOUT` (default 240s);
  raise it before suspecting a boot failure.

## What Doesn't Work
- Flows 02/04/05 assume the seeded `acme/payments-api` is the ONLY repo; a dev DB with
  other repos can land on the wrong repo. Run hermetically (`pnpm e2e:hermetic`).
- [2026-07-06] agent-browser coordinate clicks (`find text … click`, `find role button click`) do NOT
  reach React's delegated `onClick` on `CollapsibleCard`'s button (jsdom `fireEvent` passes, real CDP
  click doesn't toggle) — use an `eval` step with native `HTMLElement.click()` instead;
  `e2e/specs/08-pr-why-risk-brief.flow.json` (expander step).
- [2026-07-12] agent-browser's `find role tab --name <X>` does NOT resolve the vendored `Tabs` primitive
  (`client/src/vendor/ui`) — it exposes no queryable `role="tab"`/`tablist` accessible name, so the step
  fails "Command failed: agent-browser find role tab --name Agents". For a tab strip: assert visibility with
  `wait --text "<label>"` and SWITCH tabs by opening the URL param the click pushes (`open {BASE}/eval?tab=skills`),
  not a role/text click. Caveat: nav-Sidebar labels duplicate the tab labels (Sidebar renders before `<main>`),
  so `wait --text` proves "text on page", NOT "tab strip" — assert the split via VIEW-UNIQUE markers
  ("Security Reviewer" = Agents view, "Run all skills" = Skills view); `e2e/specs/10-eval-agents-skills-split.flow.json`.
- [2026-07-12] The hermetic e2e (`pnpm e2e:hermetic` → `scripts/e2e.sh` → `run.ts`) exits **0 even when whole flows FAIL** — a run with **8/10** flows passing still returned exit 0 (the runner reports per-flow results but does not propagate a flow failure to its process exit code; the "non-zero exit" note under Codebase Patterns is per-STEP `wait`, NOT the aggregate). Gate the green barrier on the printed "N/M flows passed" line, NEVER on the exit code — a red e2e otherwise reads as green; `e2e/run.ts`.
