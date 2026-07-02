/**
 * Tool: `devdigest_run_agent_on_pr` (write, non-destructive).
 *
 * The ONLY tool that starts a review. Outcome-not-operation: it starts a run,
 * WAITS for it to finish, and returns `{verdict, findings[]}` in one call.
 *
 * Flow (per the API's actual behavior):
 *   1. resolve `{repo, pr}` → pullId
 *   2. validate `agent` (an id from devdigest_list_agents, or `all`)
 *   3. POST /pulls/:id/review → responds immediately with `runs[]`, EMPTY reviews
 *   4. consume each run's SSE until the stream ENDS (D3: end-of-stream == done)
 *   5. GET /pulls/:id/reviews → format the just-run reviews
 *
 * Decision (single vs all): for ONE agent, return that run's `{verdict,
 * findings}`. For `all` (multiple reviews), return `{verdict, findings[]}` where
 * `findings` is the union of the just-run reviews and `verdict` is the
 * most-blocking among them (request_changes > comment > approve). Deterministic.
 */
import { z } from 'zod';
import type { ApiClient, ReviewTarget } from '../api-client.js';
import { ApiClientError } from '../api-client.js';
import {
  aggregateReviews,
  toReviewSummary,
  type ReviewSummary,
} from '../format.js';
import type { ReviewRecord } from '@devdigest/shared';
import { defineTool, jsonResult } from './registry.js';
import { prArg, repoArg, resolveRepoPr } from './resolve.js';

const ALL = 'all';

const inputShape = {
  repo: repoArg,
  pr: prArg,
  agent: z
    .string()
    .min(1)
    .describe('Agent id from `devdigest_list_agents`, or `all` to run every enabled agent.'),
} as const;

const Input = z.object(inputShape);

export function runAgentOnPrTool(api: ApiClient) {
  return defineTool({
    name: 'devdigest_run_agent_on_pr',
    config: {
      title: 'Run a review agent on a PR',
      description:
        'Run a review agent on a pull request and return the finished result. Starts a run, waits for it to complete, and returns `{verdict, findings[]}` in one call. The only tool that starts a review.',
      annotations: {
        // Write, but non-destructive (creates a new review run; idempotency not
        // guaranteed — each call starts a fresh run).
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: inputShape,
    },
    handler: async (args) => {
      const { agent } = Input.parse(args);
      const { pullId, repo, pr } = await resolveRepoPr(api, args);

      const runAll = agent === ALL;
      if (!runAll) {
        // Validate the agent id up front so an unknown id leads forward.
        const agents = await api.listAgents();
        if (!agents.some((a) => a.id === agent)) {
          throw new ApiClientError(
            `Agent '${agent}' not found. Call devdigest_list_agents for valid ids.`,
          );
        }
      }

      const target: ReviewTarget = runAll ? { kind: 'all' } : { kind: 'agent', agentId: agent };
      const started = await api.runReview(pullId, target);

      if (started.runs.length === 0) {
        throw new ApiClientError(
          runAll
            ? `No enabled agents to run on PR #${pr} in ${repo}. Enable an agent in the workspace.`
            : `Agent '${agent}' could not be started on PR #${pr} in ${repo}.`,
        );
      }

      // Wait for every started run to finish. D3: each SSE stream ENDS (server
      // closes the body) at completion — there is no terminal data event.
      const runIds = new Set(started.runs.map((r) => r.run_id));
      await Promise.all(started.runs.map((r) => api.consumeRunEvents(r.run_id)));

      // Reviews are persisted by the time the runs complete; fetch and keep only
      // the ones produced by the runs we just started (deterministic, no staleness).
      const reviews = await api.reviewsForPull(pullId);
      const justRun = reviews.filter((rev) => rev.run_id != null && runIds.has(rev.run_id));

      const summary: ReviewSummary = pickSummary(runAll, justRun, reviews);
      return jsonResult(summary);
    },
  });
}

/**
 * For `all`, aggregate the just-run reviews. For a single agent, return its one
 * review. Falls back to the full review set if the run→review join came up empty
 * (e.g. a run that produced no review row) so the caller still gets a result.
 */
function pickSummary(
  runAll: boolean,
  justRun: ReviewRecord[],
  allReviews: ReviewRecord[],
): ReviewSummary {
  const source = justRun.length > 0 ? justRun : allReviews;
  if (runAll) return aggregateReviews(source);
  const one = source[0];
  return one ? toReviewSummary(one) : { verdict: null, findings: [] };
}
