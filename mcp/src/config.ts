/**
 * Runtime configuration for the DevDigest MCP server.
 *
 * Variant A (HTTP bridge): the only thing this thin edge needs is the base URL
 * of the already-running local DevDigest API. No secrets, no auth — the API
 * resolves tenancy server-side via `LocalNoAuthProvider` (the default seeded
 * workspace + system user), so the MCP client sends no token or header.
 *
 * Precondition (not enforced here): the API must be up and the DB seeded
 * (`./scripts/dev.sh` or `pnpm db:seed`).
 */

/** Base URL of the local DevDigest API. Override via `DEVDIGEST_API_URL`. */
export const DEFAULT_API_URL = 'http://localhost:3001';

export interface McpConfig {
  /** Base URL of the DevDigest API, no trailing slash. */
  readonly apiUrl: string;
}

/** Reads config from the environment, applying defaults. Pure given `env`. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const raw = env.DEVDIGEST_API_URL?.trim();
  const apiUrl = (raw && raw.length > 0 ? raw : DEFAULT_API_URL).replace(/\/+$/, '');
  return { apiUrl };
}
