/**
 * Tool: `devdigest_list_agents` (readOnly).
 *
 * Thin handler — the MCP equivalent of a Fastify route: no business logic, just
 * call the API client and shape the result. Takes no input.
 */
import { ApiClient } from '../api-client.js';
import { toAgentSummaries } from '../format.js';
import { defineTool, jsonResult } from './registry.js';

export function listAgentsTool(api: ApiClient) {
  return defineTool({
    name: 'devdigest_list_agents',
    config: {
      title: 'List review agents',
      description:
        'List the PR-review agents configured in this workspace. Call this first — running a review needs a valid `agent` id from here.',
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        // The agent set is fetched from the local API, not part of MCP's own world.
        openWorldHint: true,
      },
    },
    handler: async () => {
      // No input — the `args` parameter is intentionally unused.
      const agents = await api.listAgents();
      return jsonResult({ agents: toAgentSummaries(agents) });
    },
  });
}
