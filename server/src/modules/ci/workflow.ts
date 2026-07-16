import { ARTIFACT_NAME, DEFAULT_TRIGGERS, RESULT_FILE_GLOB, RUNNER_CMD } from './constants.js';

/**
 * Security-minimal GitHub Actions workflow generator (T13).
 *
 * Hard security properties (AC-12..AC-17), each load-bearing:
 *  - `on: pull_request` — NEVER `pull_request_target`. Fork PRs run WITHOUT
 *    repo secrets under `pull_request`, so an untrusted fork can't exfiltrate
 *    `OPENROUTER_API_KEY` (AC-17, fork-safe by trigger choice).
 *  - `permissions:` is `contents: read` + `pull-requests: write` ONLY —
 *    least privilege, enough to read the diff and post a review (AC-14).
 *  - The review runs `node .devdigest/runner/index.js` (the committed bundle) —
 *    NO third-party/marketplace action executes the review (AC-12). Only the
 *    first-party `actions/{checkout,setup-node,upload-artifact}` are used.
 *  - The API key is referenced as `${{ secrets.OPENROUTER_API_KEY }}` and is
 *    NEVER inlined into the YAML (AC-15).
 *  - `DEVDIGEST_POST_AS` is passed via `env` — the runner reads it (AC-16); it
 *    lives on the workflow, not in the frozen manifest.
 */

export interface WorkflowOptions {
  /** pull_request activity types (AC-13 default: opened/synchronize/reopened). */
  triggers: readonly string[];
  /** github_review | pr_comment | none — surfaced to the runner via env (AC-16). */
  postAs: string;
}

/**
 * Sanitize caller-supplied triggers to a safe token shape before they are
 * interpolated into YAML. `triggers` is a free `string[]` on the contract, so a
 * value like `"foo\n      - pull_request_target"` could otherwise inject YAML.
 * We drop anything that is not a bare lowercase activity token and fall back to
 * the safe defaults when nothing valid remains (defense-in-depth, security skill).
 */
function safeTriggers(triggers: readonly string[]): string[] {
  const clean = triggers.filter((t) => /^[a-z_]+$/.test(t));
  return clean.length > 0 ? clean : [...DEFAULT_TRIGGERS];
}

export function generateWorkflow({ triggers, postAs }: WorkflowOptions): string {
  const types = safeTriggers(triggers)
    .map((t) => `      - ${t}`)
    .join('\n');

  return `name: DevDigest Review

# Trigger on pull_request only (never the privileged target-event variant): fork
# PRs run WITHOUT repository secrets, so the review simply no-ops on forks instead
# of exposing OPENROUTER_API_KEY to untrusted code.
on:
  pull_request:
    types:
${types}

# Least privilege: read the code, write the review. Nothing else.
permissions:
  contents: read
  pull-requests: write

jobs:
  devdigest-review:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Run DevDigest review
        run: ${RUNNER_CMD}
        env:
          # Secret is referenced, NEVER inlined. Absent on fork PRs by design.
          OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPOSITORY: \${{ github.repository }}
          PR_NUMBER: \${{ github.event.pull_request.number }}
          DEVDIGEST_POST_AS: ${postAs}
      - name: Upload DevDigest result
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ${ARTIFACT_NAME}
          # Glob so ALL per-agent result files (devdigest-result-<slug>.json, one
          # per installed agent) upload under the single artifact — ingest reads
          # every agent's result from one download (AC-58). One artifact, N files.
          path: ${RESULT_FILE_GLOB}
          if-no-files-found: ignore
`;
}
