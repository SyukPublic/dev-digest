# reviewer-core — INSIGHTS

> Running log of gotchas, debugging discoveries, and "why it's like this" decisions.
> Append as you learn. Keep entries short; link code with `path:line`.

## Codebase Patterns
- Stays pure on purpose: no DB/git/fs/network. Anything impure belongs in the server.
- Score and verdict shown to users are computed here from grounded findings, not taken
  from the model's response.
- Map-reduce auto mode triggers only when the diff is BOTH large AND multi-file.

## Tool & Library Notes
- `build` is `tsc --noEmit` — no JS is emitted; the package is consumed as TypeScript source.
