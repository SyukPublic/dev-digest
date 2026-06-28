import { ConfigError } from './errors.js';
import { TimeoutError } from './resilience.js';

/**
 * Honest, human-readable cause for a failed GitHub call (pure — `instanceof`
 * only, no IO). Disambiguates the three real failure modes so the WARN log no
 * longer always blames "no token / offline":
 *   - `ConfigError`  → no GitHub token configured ("no token").
 *   - `TimeoutError` → GitHub hung past our per-attempt timeout ("timed out").
 *   - anything else  → genuine network/HTTP error (surface `name`/`status`/`code`).
 *
 * Best-effort rate-limit diagnostics (`x-ratelimit-*` / `retry-after`) are
 * appended when the error carries response headers — with throttling disabled in
 * the Octokit adapter a rate-limit surfaces here as an error rather than a silent
 * sleep, so we want to tell it apart from a plain network stall.
 *
 * Lives in `platform/` (not a feature module) because it's consumed by multiple
 * modules (pulls, polling) and only references platform-level error types.
 */
export function describeGithubError(err: unknown): string {
  if (err instanceof ConfigError) return 'no GitHub token configured';
  if (err instanceof TimeoutError) return `GitHub request timed out (${err.message})`;

  const status =
    (err as { status?: number })?.status ??
    (err as { statusCode?: number })?.statusCode ??
    (err as { response?: { status?: number } })?.response?.status;
  const code = (err as { code?: string })?.code;
  const name = err instanceof Error ? err.name : typeof err;

  const parts: string[] = [name || 'Error'];
  if (typeof status === 'number') parts.push(`status=${status}`);
  if (typeof code === 'string') parts.push(`code=${code}`);

  const rl = rateLimitHint(err);
  if (rl) parts.push(rl);

  return `GitHub request failed (${parts.join(' ')})`;
}

/**
 * Best-effort rate-limit / retry-after summary from an error's response
 * headers — `null` when none are present. Lets a throttling stop be told apart
 * from a network stall in the WARN log.
 */
function rateLimitHint(err: unknown): string | null {
  const headers = (err as { response?: { headers?: Record<string, unknown> } })?.response?.headers;
  if (!headers || typeof headers !== 'object') return null;
  const get = (k: string): string | null => {
    const v = headers[k];
    return v == null ? null : String(v);
  };
  const remaining = get('x-ratelimit-remaining');
  const reset = get('x-ratelimit-reset');
  const retryAfter = get('retry-after');
  const bits: string[] = [];
  if (remaining != null) bits.push(`ratelimit-remaining=${remaining}`);
  if (reset != null) bits.push(`ratelimit-reset=${reset}`);
  if (retryAfter != null) bits.push(`retry-after=${retryAfter}`);
  return bits.length > 0 ? bits.join(' ') : null;
}
