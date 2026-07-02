/**
 * The tool registry: builds the full list of DevDigest MCP tools bound to an
 * `ApiClient`. All five L04 tools are wired here.
 */
import type { ApiClient } from '../api-client.js';
import { listAgentsTool } from './list-agents.js';
import { getConventionsTool } from './get-conventions.js';
import { getFindingsTool } from './get-findings.js';
import { getBlastRadiusTool } from './get-blast-radius.js';
import { runAgentOnPrTool } from './run-agent-on-pr.js';
import type { ToolDefinition } from './registry.js';

export { registerAll } from './registry.js';

/** All DevDigest tools, in listing order (list first — others need its ids). */
export function buildTools(api: ApiClient): ToolDefinition[] {
  return [
    listAgentsTool(api),
    getConventionsTool(api),
    getFindingsTool(api),
    getBlastRadiusTool(api),
    runAgentOnPrTool(api),
  ];
}
