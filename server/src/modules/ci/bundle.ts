import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CiFile } from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { MEMORY_PATH, RUNNER_PATH, WORKFLOW_PATH } from './constants.js';
import { manifestPath, skillPath } from './serialize.js';

/**
 * Bundle assembler (T12). Produces the exact set of files the export commits:
 *  - `.devdigest/agents/<slug>.yaml`  — the agent manifest
 *  - `.devdigest/skills/<slug>.md`    — one per linked skill
 *  - `.devdigest/memory.jsonl`        — empty review-memory placeholder
 *  - `.devdigest/runner/index.js`     — the ncc-bundled runner (read from disk)
 *  - `.github/workflows/devdigest-review.yml` — the GitHub Actions workflow
 *
 * The ONLY `fs` in the ci module lives here (NOT in `service.ts`) so the arch
 * check keeps `service.ts` free of Node I/O.
 */

/** Resolve the ncc-built runner bundle path (env override wins for tests/deploys). */
function defaultBundlePath(): string {
  if (process.env.DEVDIGEST_RUNNER_BUNDLE) return process.env.DEVDIGEST_RUNNER_BUNDLE;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // server/src/modules/ci → repo root → agent-runner/dist/index.js
  return path.resolve(here, '../../../../agent-runner/dist/index.js');
}

/**
 * Read the bundled runner JS. Missing (not built) → a clear, actionable error
 * (AC-44); callers read this BEFORE any commit so a missing bundle commits
 * NOTHING. `bundlePath`/`readFile` are injectable for hermetic tests.
 */
export function readRunnerBundle(
  bundlePath: string = defaultBundlePath(),
  readFile: typeof readFileSync = readFileSync,
): string {
  try {
    return readFile(bundlePath, 'utf8') as unknown as string;
  } catch {
    throw new AppError(
      'runner_bundle_missing',
      `Runner bundle not found at ${bundlePath} — build it first: \`cd agent-runner && pnpm build\`.`,
      500,
    );
  }
}

export interface BundleInput {
  /** Agent slug → `.devdigest/agents/<slug>.yaml`. */
  agentSlug: string;
  manifestYaml: string;
  skillFiles: { slug: string; body: string }[];
  workflowYaml: string;
}

/**
 * Assemble the CI bundle files. Reads the runner bundle up front, so a missing
 * bundle throws before any file is produced (and thus before any commit).
 */
export function assembleBundle(
  input: BundleInput,
  readBundle: () => string = readRunnerBundle,
): CiFile[] {
  const runnerJs = readBundle();
  return [
    { path: manifestPath(input.agentSlug), contents: input.manifestYaml, editable: true },
    ...input.skillFiles.map((s) => ({ path: skillPath(s.slug), contents: s.body, editable: true })),
    { path: MEMORY_PATH, contents: '', editable: false },
    { path: RUNNER_PATH, contents: runnerJs, editable: false },
    { path: WORKFLOW_PATH, contents: input.workflowYaml, editable: true },
  ];
}
