# e2e — INSIGHTS

> Running log of gotchas, debugging discoveries, and "why it's like this" decisions.
> Append as you learn. Keep entries short; link code with `path:line`.

- No LLM is ever called — never use agent-browser's `chat`; deterministic locators only.
- Flows 02/04/05 assume the seeded `acme/payments-api` is the ONLY repo; a dev DB with
  other repos can land on the wrong repo. Run hermetically (`pnpm e2e:hermetic`).
- Assertions are `wait --text`/`wait --url` timing out (non-zero exit), not a DSL.
