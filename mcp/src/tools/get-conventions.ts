/**
 * Tool: `devdigest_get_conventions` (readOnly).
 *
 * Thin handler: resolve `repo` → repoId, fetch the extracted conventions, and
 * shape each rule down to its evidence path + confidence.
 */
import type { ApiClient } from '../api-client.js';
import { toConventionSummaries } from '../format.js';
import { defineTool, jsonResult } from './registry.js';
import { repoInputShape, resolveRepo } from './resolve.js';

export function getConventionsTool(api: ApiClient) {
  return defineTool({
    name: 'devdigest_get_conventions',
    config: {
      title: 'Get repo conventions',
      description:
        "Get the repository's coding conventions (the repo-conventions extracted in L02): each rule with its evidence path and confidence.",
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        // Data comes from the local API, not part of MCP's own world.
        openWorldHint: true,
      },
      inputSchema: repoInputShape,
    },
    handler: async (args) => {
      const repoId = await resolveRepo(api, args);
      const conventions = await api.conventions(repoId);
      return jsonResult({ conventions: toConventionSummaries(conventions) });
    },
  });
}
