/**
 * Tool: `devdigest_get_blast_radius` (readOnly).
 *
 * Resolve `{repo, pr}` → pullId, then read the existing `GET /pulls/:id/blast`
 * (no backend work). Surfaces the impact map plus the index `status`; when the
 * repo isn't indexed the map is empty and we attach a forward-leading resync
 * hint (see `toBlastSummary`).
 */
import type { ApiClient } from '../api-client.js';
import { toBlastSummary } from '../format.js';
import { defineTool, jsonResult } from './registry.js';
import { repoPrInputShape, resolveRepoPr } from './resolve.js';

export function getBlastRadiusTool(api: ApiClient) {
  return defineTool({
    name: 'devdigest_get_blast_radius',
    config: {
      title: 'Get PR blast radius',
      description:
        "Impact map of a pull request — changed symbols, their downstream callers, and impacted endpoints, with an index `status`. If the repo isn't indexed the map is empty and `status` is `degraded`/`failed`.",
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: repoPrInputShape,
    },
    handler: async (args) => {
      const { pullId, repo } = await resolveRepoPr(api, args);
      const blast = await api.blast(pullId);
      return jsonResult(toBlastSummary(blast, repo));
    },
  });
}
