/**
 * DevDigest MCP server — entry point.
 *
 * Constructs the high-level `McpServer`, registers the tool registry, and
 * connects a `StdioServerTransport`. This is a thin onion edge (Variant A):
 * tools call the local DevDigest API over HTTP; this process holds no DB, no
 * secrets, no review logic.
 *
 * IMPORTANT: stdout is the JSON-RPC channel. ALL logging goes to stderr only —
 * a stray `console.log` would corrupt the protocol stream.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiClient } from './api-client.js';
import { loadConfig } from './config.js';
import { buildTools, registerAll } from './tools/index.js';

/** Logs to stderr — never stdout (which carries JSON-RPC). */
function log(message: string): void {
  process.stderr.write(`[devdigest-mcp] ${message}\n`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const api = new ApiClient(config);

  const server = new McpServer({
    name: 'devdigest-mcp',
    version: '0.0.0',
  });

  registerAll(server, buildTools(api));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`connected over stdio; API base = ${config.apiUrl}`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[devdigest-mcp] fatal: ${message}\n`);
  process.exit(1);
});
