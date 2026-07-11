import { defineConfig } from "vitest/config";
import TrendReporter from "./src/trend-reporter.js";

export default defineConfig({
  test: {
    // *.eval.ts = model-backed evals; src/**/*.test.ts = the pure stats unit tests.
    include: ["**/*.eval.ts", "src/**/*.test.ts"],
    // Real Claude sessions (and a subagent dispatch) are slow — give them room. 480s, not 240s:
    // the dispatch case runs a FULL nested architecture-reviewer session inside the main one, and
    // after the 2026-07-11 agent upgrades (mandatory Gate verdict + fuller evidence-gathering)
    // that nested session alone can run 60–130s+, which pushed one full `pnpm eval` run past the
    // old 240s ceiling (timeout, not a content failure).
    testTimeout: 480_000,
    hookTimeout: 480_000,
    // One session per test; a few files can run concurrently. Keep it modest to stay cheap.
    fileParallelism: true,
    reporters: ["default", new TrendReporter()],
  },
});
