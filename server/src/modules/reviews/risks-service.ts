import type { Container } from '../../platform/container.js';
import { Risks } from '@devdigest/shared';
import type { UnifiedDiff } from '@devdigest/shared';
import { buildRisksMessages, formatIntentForPrompt } from '@devdigest/reviewer-core';
import { resolveFeatureModel } from '../settings/feature-models.js';
import type { ReviewRepository } from './repository.js';
import type { PullRow, RepoRow } from '../../db/rows.js';

export interface RisksAnalyzeResult {
  risks: Risks;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

/**
 * Analyze a PR's risk areas using the `risk_brief` feature model.
 *
 * Mirrors `classifyIntent` (intent-service.ts): pure prompt building lives in
 * reviewer-core, the LLM is reached through the `LLMProvider` interface, and the
 * result is persisted via the repository — no DB / SDK access leaks into this
 * service (onion boundary).
 *
 * Intent anchoring is BEST-EFFORT: if a stored intent already exists for the PR
 * we pass its compact rendering into the prompt to anchor risks to the declared
 * scope; otherwise risks run independently. The full patch (`diff.raw`) is sent —
 * dependency/perf/auth risks live in the patch bodies — capped inside the prompt
 * builder to bound token cost.
 */
export async function analyzeRisks(
  container: Container,
  repo: ReviewRepository,
  workspaceId: string,
  pull: PullRow,
  _repoRow: RepoRow,
  diff: UnifiedDiff,
  _opts?: { force?: boolean },
): Promise<RisksAnalyzeResult> {
  // 1. Best-effort intent anchoring — pass the stored intent when present.
  const storedIntent = await repo.getIntent(pull.id);
  const intent = storedIntent
    ? formatIntentForPrompt({
        intent: storedIntent.intent,
        in_scope: storedIntent.in_scope,
        out_of_scope: storedIntent.out_of_scope,
      })
    : undefined;

  // 2. Build prompt messages (pure — lives in reviewer-core; full capped patch).
  const messages = buildRisksMessages({
    prTitle: pull.title,
    prBody: pull.body ?? undefined,
    diff: diff.raw,
    ...(intent !== undefined ? { intent } : {}),
  });

  // 3. Resolve feature model → provider → completeStructured.
  const { provider, model } = await resolveFeatureModel(container, workspaceId, 'risk_brief');
  const llm = await container.llm(provider);

  const res = await llm.completeStructured<Risks>({
    model,
    schema: Risks,
    schemaName: 'Risks',
    messages,
  });

  // 4. Persist via repository (no DB access here — only repo.* calls).
  await repo.upsertRisks(pull.id, res.data, pull.headSha);

  return {
    risks: res.data,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
  };
}
