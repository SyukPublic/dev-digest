# Review pipeline — internals

> Stage-by-stage walkthrough of `reviewPullRequest`: **diff → prompt → LLM → grounded
> findings**. The high-level diagram lives in the [README](../README.md#pipeline); this is the
> map with file anchors. Read before changing prompt assembly, grounding, scoring, or map-reduce.

## The invariants (do not break)
- **PURE:** no DB, GitHub, filesystem, git, or network. The only side effect is the injected
  `LLMProvider`. The diff is an input, not something fetched.
- **Grounding is mandatory:** every finding must cite a line in the diff or it is dropped.
- **Score is recomputed** from surviving findings; the model's self-reported score/verdict is
  ignored (the verdict is later set by the CI gate).
- **INJECTION_GUARD** is appended to every system prompt: untrusted content is data, never
  instructions — "test fixture / intentional / do not flag" never descopes the review.

## Stages
1. **assemblePrompt()** — `src/prompt.ts`. Builds the message from inputs (diff, system prompt,
   repo map, optional lesson slots: skills/memory/specs/callers). Untrusted content is fenced by
   `wrapUntrusted()` (`src/prompt-shared.ts`); the `INJECTION_GUARD` is appended.
2. **LLMProvider (injected)** — `src/llm/openrouter.ts`. The sole side effect; mockable in tests.
3. **structured output** — `src/llm/structured.ts`. Zod → JSON Schema; `extractJson` /
   `parseWithRepair` recover a valid object from imperfect model output.
4. **groundFindings()** — `src/grounding.ts`. Mechanical citation gate against the diff: a
   finding without a real diff line is dropped. Full-file kinds (secret_leak, phantom, …) only
   need the file to exist.
5. **reduce()** — `src/review/reduce.ts`. Merges map-reduce shards and recomputes the score.

`src/review/run.ts` orchestrates the run — **single-pass by default**. Map-reduce auto mode
triggers only when the diff is BOTH large AND multi-file.

## Public API
Exported from `src/index.ts`: `assemblePrompt` / `wrapUntrusted`, `groundFindings` /
`groundingSummary`, `toJsonSchema` / `extractJson` / `parseWithRepair`, plus `run` and `reduce`.
Contracts (`Review`, `Finding`, `Verdict`, …) come from `@devdigest/shared`.

## Before you change it
- Keep it pure — if you reach for `fs`/`db`/`octokit`, the change belongs in the server.
- Check [../insights/gotchas.md](../insights/gotchas.md) and [../INSIGHTS.md](../INSIGHTS.md)
  first. `build` = `tsc --noEmit`; run `pnpm test` after changes.
