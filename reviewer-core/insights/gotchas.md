# reviewer-core — known gotchas (troubleshooting)

> Symptom → cause → fix, for when reviewer-core behaves unexpectedly. This is the
> **quick-lookup** index; the full chronological log of discoveries and "why it's like this"
> decisions is [INSIGHTS.md](../INSIGHTS.md). Add an entry here when a symptom is likely to
> recur; keep the deep story in INSIGHTS.md and link it.

## `Invalid response body … Premature close` (ERR_STREAM_PREMATURE_CLOSE)
- **Symptom:** the OpenAI SDK throws mid-stream against OpenRouter, consistently.
- **Cause:** the SDK's bundled **node-fetch shim** — NOT undici, the network, or a proxy (raw
  `globalThis.fetch`/`node:https` read the same responses cleanly).
- **Fix:** force undici — pass `fetch: (...a) => globalThis.fetch(...a)` to `new OpenAI({...})`
  in `src/llm/openrouter.ts`. (Same one-liner in `server/src/adapters/llm/openai.ts`.)

## A single review call runs ~3× longer than its timeout
- **Symptom:** a per-request `timeout` doesn't bound total latency; a slow model overruns a
  caller's budget (e.g. a 120s `JobRunner` job).
- **Cause:** the client is built with `maxRetries: 2` and the SDK RETRIES on timeout → ≈3× the
  timeout.
- **Fix:** pass BOTH `{ timeout, maxRetries: 0 }` as per-request options, gated on
  `req.timeoutMs` so the review path (no timeoutMs) keeps SDK retries; `src/llm/openrouter.ts`
  (`completeStructured`).

## A finding the model reported is missing from the output
- **Symptom:** a finding is absent from the returned `Review`.
- **Cause:** by design — `groundFindings` drops any finding that doesn't cite a real line in the
  diff, and the score is recomputed from survivors. Not a bug.
- **Fix:** check the finding's citation; full-file kinds (secret_leak, phantom, …) only need the
  file to exist. See [../docs/pipeline.md](../docs/pipeline.md).
