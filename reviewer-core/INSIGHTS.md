# reviewer-core — INSIGHTS

> Running log of gotchas, debugging discoveries, and "why it's like this" decisions.
> Append as you learn. Keep entries short; link code with `path:line`.

## Codebase Patterns
- Stays pure on purpose: no DB/git/fs/network. Anything impure belongs in the server.
- Score and verdict shown to users are computed here from grounded findings, not taken
  from the model's response.
- Map-reduce auto mode triggers only when the diff is BOTH large AND multi-file.
- [2026-06-26] The risks classifier prompt (`buildRisksMessages`, `src/risks/risks-prompt.ts`) deliberately uses the FULL patch (`diff.raw`, capped ~40k chars) — the INVERSE of the intent classifier (`intent/classify-prompt.ts`), which uses hunk-headers-only to save tokens. Reason: risk detection (new dependency, added Redis round-trip, auth surface touched) lives in the patch BODIES, not the file/hunk structure. Each untrusted field (`diff`/`intent`/`pr-body`) is `wrapUntrusted`-wrapped behind a module-local `RISKS_INJECTION_GUARD`; the server passes the stored intent in to anchor scope (an optional input, not fetched — stays pure).
- [2026-06-28] L2-lite `content_changed` re-anchoring keeps core PURE by SPLITTING the work: pure `anchoredText(finding, diff)` extracts the NEW-side text of the finding's `[min(start,end)..max]` lines (rtrim-trailing each, join `\n`, returns `null` when the parser's `DiffHunk.newLineText` is absent or length-mismatched), and the SERVER hashes it (`sha256`) — never `node:crypto` in core. `anchorStatus` stays content-blind (only `current|moved_out|orphaned`); the `content_changed` verdict is derived server-side by comparing fingerprints; `reviewer-core/src/grounding.ts` (anchoredText, anchorStatus).
- [2026-07-02] `prompt.ts ⇄ intent/classify-prompt.ts` was the ONLY real value-level module cycle repo-wide (TD-001 C): `prompt.ts` imports `INTENT_RULE`, `classify-prompt.ts` imports `wrapUntrusted` back. Fix rule when breaking a 2-module value cycle: extract the MORE-shared symbol to a zero-import leaf, NOT the co-located constant — `wrapUntrusted` (5 importers) moved to new `src/prompt-shared.ts`, `INTENT_RULE` stayed put, `prompt.ts`'s remaining import became one-way. Moving the widely-shared helper also decouples every importer from the larger `prompt.ts`; the moved fn is security-load-bearing (untrusted-data delimiter) so it MUST move byte-identical; `reviewer-core/src/prompt-shared.ts`, `prompt.ts`, `intent/classify-prompt.ts`.

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
