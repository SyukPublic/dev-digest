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
- [2026-06-20] `Invalid response body … Premature close` (ERR_STREAM_PREMATURE_CLOSE) from the
  OpenAI SDK against OpenRouter is the SDK's bundled **node-fetch shim**, NOT undici, the network,
  HTTP version, or a proxy. Proof: raw `globalThis.fetch`/`node:https` read the SAME responses
  cleanly; only the SDK's default transport fails (consistently). Fix: pass
  `fetch: (...a) => globalThis.fetch(...a)` to `new OpenAI({...})` to force undici;
  `src/llm/openrouter.ts` (constructor). Same one-liner applied to `server/src/adapters/llm/openai.ts`.
  (Streaming + a manual retry layer were tried first on a wrong "idle upstream drops the socket"
  theory — they did NOT help because every request still went through node-fetch; reverted.)
- [2026-06-23] A per-request `timeout` does NOT bound total latency: the OpenAI client is built
  with `maxRetries: 2` and the SDK RETRIES on timeout, so a slow model runs ≈3× the timeout. To
  bound a call under a caller's budget (e.g. a 120s `JobRunner` job), pass BOTH
  `{ timeout, maxRetries: 0 }` as the per-request options — gated on `req.timeoutMs` so the review
  path (no timeoutMs) keeps SDK retries; `src/llm/openrouter.ts` (completeStructured).
