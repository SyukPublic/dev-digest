import type { Container } from '../../platform/container.js';
import { Intent } from '@devdigest/shared';
import type { UnifiedDiff } from '@devdigest/shared';
import {
  serializeChangedFiles,
  buildIntentMessages,
} from '@devdigest/reviewer-core';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { parseLinkedIssueRef } from '../../lib/linked-issue.js';
import type { ReviewRepository } from './repository.js';
import type { PullRow, RepoRow } from '../../db/rows.js';

export interface IntentClassifyResult {
  intent: Intent;
  tokensSaved: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

/**
 * Classify a PR's intent using the cheap review_intent model.
 *
 * Linked issue resolution: `PullRow` (the DB type) does NOT carry `linked_issue`
 * (that is a client-facing `PrDetail` DTO field, assembled on-demand by the pulls
 * service). We extract the issue number from the PR body via the shared
 * `parseLinkedIssueRef` helper (the single source of truth, also used by the GitHub
 * adapter), then fetch via `container.github().getIssue(...)` through the
 * `GitHubClient` interface — NEVER a direct Octokit import (onion boundary).
 *
 * If the GitHub client is unavailable or the issue fetch fails, we proceed with
 * title + body + files only — classification is still best-effort, never throws.
 */
export async function classifyIntent(
  container: Container,
  repo: ReviewRepository,
  workspaceId: string,
  pull: PullRow,
  repoRow: RepoRow,
  diff: UnifiedDiff,
  _opts?: { force?: boolean },
): Promise<IntentClassifyResult> {
  // 1. Resolve linked issue: extract from PR body regex → GitHubClient interface.
  let issueTitle: string | undefined;
  let issueBody: string | undefined;
  if (pull.body) {
    const issueRef = parseLinkedIssueRef(pull.body);
    if (issueRef != null) {
      try {
        const gh = await container.github();
        const issue = await gh.getIssue(
          { owner: repoRow.owner, name: repoRow.name },
          issueRef,
        );
        issueTitle = issue.title;
        issueBody = issue.body ?? undefined;
      } catch {
        // Best-effort: proceed without the issue if unavailable.
      }
    }
  }

  // 2. Serialize changed files (hunk headers only — no patch bodies).
  const headersOnly = serializeChangedFiles(diff);
  const rawTokens = container.tokenizer.count(diff.raw);
  const headersTokens = container.tokenizer.count(headersOnly);
  const tokensSaved = Math.max(0, rawTokens - headersTokens);

  // 3. Build prompt messages (pure — lives in reviewer-core).
  const messages = buildIntentMessages({
    prTitle: pull.title,
    prBody: pull.body ?? undefined,
    issueTitle,
    issueBody,
    changedFiles: headersOnly,
  });

  // 4. Resolve feature model → provider → completeStructured (S3 pattern).
  const { provider, model } = await resolveFeatureModel(
    container,
    workspaceId,
    'review_intent',
  );
  const llm = await container.llm(provider);

  const res = await llm.completeStructured<Intent>({
    model,
    schema: Intent,
    schemaName: 'Intent',
    messages,
  });

  // 5. Persist via repository (no DB access here — only repo.* calls).
  await repo.upsertIntent(pull.id, res.data, pull.headSha);

  return {
    intent: res.data,
    tokensSaved,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
  };
}
