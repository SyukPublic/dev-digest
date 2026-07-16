import type { RepoRef } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';

/**
 * Export-to-CI (L07) constants — the fixed file paths, branch, PR metadata, and
 * artifact/workflow names shared by the bundle assembler, the workflow generator,
 * and the pull-on-refresh ingest. Kept in one place so the studio producer and
 * the ingest agree on names (e.g. the workflow uploads `ARTIFACT_NAME`, the
 * ingest downloads it by the same name).
 */

/** The single branch the export commits to (NEVER the base branch — AC-9). */
export const CI_BRANCH = 'devdigest/ci';

/** Title + body of the export PR. Stable so re-publishing reuses the same PR. */
export const CI_PR_TITLE = 'Add DevDigest CI review';
export const CI_PR_BODY = [
  'This PR adds a self-contained DevDigest AI code review that runs on every pull request.',
  '',
  'It commits:',
  '- `.devdigest/agents/<agent>.yaml` — the agent manifest',
  '- `.devdigest/skills/*.md` — the linked review skills',
  '- `.devdigest/memory.jsonl` — an empty review-memory placeholder',
  '- `.devdigest/runner/index.js` — the bundled, self-contained runner',
  '- `.github/workflows/devdigest-review.yml` — the GitHub Actions workflow',
  '',
  'Set the `OPENROUTER_API_KEY` repository secret to enable the review. No GitHub App is needed.',
].join('\n');

/** Commit message for the uninstall (remove-from-CI) branch commit. */
export const CI_UNINSTALL_MESSAGE = 'Remove DevDigest agent from CI';

/** Workflow file name — the ingest lists runs of exactly this workflow. */
export const WORKFLOW_FILENAME = 'devdigest-review.yml';
export const WORKFLOW_PATH = `.github/workflows/${WORKFLOW_FILENAME}`;

/** Bundle file paths (relative to the target repo root). */
export const MANIFEST_DIR = '.devdigest/agents';
export const SKILLS_DIR = '.devdigest/skills';
export const MEMORY_PATH = '.devdigest/memory.jsonl';
export const RUNNER_PATH = '.devdigest/runner/index.js';

/** The exact command the workflow runs — no marketplace/external action (AC-12). */
export const RUNNER_CMD = 'node .devdigest/runner/index.js';

/** Result-artifact name: the workflow uploads it, the ingest downloads it. */
export const ARTIFACT_NAME = 'devdigest-result';
export const RESULT_FILE = 'devdigest-result.json';
/**
 * Upload glob for the ONE shared artifact — captures EVERY per-agent result file
 * (`devdigest-result-<slug>.json`, one per installed agent) plus a legacy
 * single-agent `devdigest-result.json`, all under the single `ARTIFACT_NAME`
 * artifact so ingest can read all N results in one download (multi-agent CI,
 * AC-58). Multiple files under one artifact name is supported by
 * upload-artifact@v4; the same artifact NAME twice in a run is not — this stays
 * within that (one artifact, N files).
 */
export const RESULT_FILE_GLOB = 'devdigest-result*.json';

/** Default pull_request activity types when the caller does not choose (AC-13). */
export const DEFAULT_TRIGGERS = ['opened', 'synchronize', 'reopened'] as const;

/**
 * Parse an `"owner/name"` repo slug into a `RepoRef` for the GitHub port. A
 * clean 422 (not a downstream 500) when the caller sends a malformed slug.
 */
export function parseRepoSlug(repo: string): RepoRef {
  const parts = repo.split('/');
  const owner = parts[0]?.trim();
  const name = parts[1]?.trim();
  if (parts.length !== 2 || !owner || !name) {
    throw new ValidationError(`Invalid repo "${repo}" — expected "owner/name".`);
  }
  return { owner, name };
}
