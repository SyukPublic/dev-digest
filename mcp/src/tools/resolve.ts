/**
 * Shared PR/repo resolution for the tool handlers, with error-leads-forward
 * messages. Flat scalar args (`repo` = `owner/name`, `pr` = number) are resolved
 * to the API's uuids: `repo` → repoId via `GET /repos`, then `(repoId, pr)` →
 * pullId via the Phase-1 `?number=` filter.
 *
 * On a miss we throw `ApiClientError` (whose message is safe to surface) so the
 * registry turns it into a clean `isError` tool result instead of a stack trace.
 */
import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import { ApiClientError } from '../api-client.js';

/** Input shapes (raw Zod shapes — what the SDK's `inputSchema` expects). */
export const repoArg = z
  .string()
  .min(1)
  .describe('Repository as `owner/name`.');

export const prArg = z
  .number()
  .int()
  .positive()
  .describe('Pull request number.');

/** `{ repo }` — used by `devdigest_get_conventions`. */
export const repoInputShape = { repo: repoArg } as const;

/** `{ repo, pr }` — used by the findings / blast tools. */
export const repoPrInputShape = { repo: repoArg, pr: prArg } as const;

const RepoInput = z.object(repoInputShape);
const RepoPrInput = z.object(repoPrInputShape);

/** Resolves `repo` → repoId, or throws a forward-leading error. */
export async function resolveRepo(api: ApiClient, args: Record<string, unknown>): Promise<string> {
  const { repo } = RepoInput.parse(args);
  const repoId = await api.resolveRepoId(repo);
  if (!repoId) {
    throw new ApiClientError(
      `Repository '${repo}' not found. Import it first, or check the spelling (expected \`owner/name\`).`,
    );
  }
  return repoId;
}

/** Resolves `{repo, pr}` → `{repoId, pullId, repo}`, or throws forward-leading. */
export async function resolveRepoPr(
  api: ApiClient,
  args: Record<string, unknown>,
): Promise<{ repoId: string; pullId: string; repo: string; pr: number }> {
  const { repo, pr } = RepoPrInput.parse(args);
  const repoId = await api.resolveRepoId(repo);
  if (!repoId) {
    throw new ApiClientError(
      `Repository '${repo}' not found. Import it first, or check the spelling (expected \`owner/name\`).`,
    );
  }
  const pullId = await api.resolvePull(repoId, pr);
  if (!pullId) {
    throw new ApiClientError(
      `PR #${pr} not found in ${repo}. Check the number, or that the repo is imported.`,
    );
  }
  return { repoId, pullId, repo, pr };
}
