/**
 * Tool: `devdigest_get_findings` (readOnly).
 *
 * Resolve `{repo, pr}` → pullId, read the PR's persisted reviews, and return
 * `{verdict, findings[]}` from the LATEST review run (most recent `created_at`).
 * Does NOT start a new run — use `devdigest_run_agent_on_pr` for that.
 */
import type { ApiClient } from '../api-client.js';
import { latestReviewSummary } from '../format.js';
import { defineTool, jsonResult } from './registry.js';
import { repoPrInputShape, resolveRepoPr } from './resolve.js';

export function getFindingsTool(api: ApiClient) {
  return defineTool({
    name: 'devdigest_get_findings',
    config: {
      title: 'Get PR findings',
      description:
        'Get `{verdict, findings[]}` from the latest review run on a pull request, without starting a new run. Use after running a review, or to re-read an earlier one.',
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: repoPrInputShape,
    },
    handler: async (args) => {
      const { pullId, repo, pr } = await resolveRepoPr(api, args);
      const reviews = await api.reviewsForPull(pullId);
      const summary = latestReviewSummary(reviews);
      if (!summary) {
        return jsonResult({
          verdict: null,
          findings: [],
          note: `No review has run yet on PR #${pr} in ${repo}. Run devdigest_run_agent_on_pr to create one.`,
        });
      }
      return jsonResult(summary);
    },
  });
}
