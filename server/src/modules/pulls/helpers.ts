import type { PrMeta, PrDetail, PrFindingCounts } from '@devdigest/shared';
import type { PullRow, PrFileRow, PrCommitRow } from '../../db/rows.js';
import { deriveReviewStatus } from './status.js';

/**
 * PR DTO assembly (pure — no DB / `this`, so it unit-tests cleanly). The
 * row → contract mapping for the pulls endpoints lives here; the service owns
 * orchestration (GitHub sync, fallbacks), the repository owns the SQL.
 */

/** Per-PR rollups the list endpoint overlays onto each row. */
export interface PrRollups {
  score: number | null;
  costUsd: number | null;
  findings: PrFindingCounts | null;
}

/**
 * Reduce `{ prId, score }` rows (NEWEST FIRST) to the latest score per PR.
 * First sighting per PR wins — so callers must pass rows already ordered
 * created_at DESC (see `reviewRepo.latestReviewScores`).
 */
export function latestScoreByPr(
  rows: { prId: string; score: number | null }[],
): Map<string, number | null> {
  const byPr = new Map<string, number | null>();
  for (const r of rows) {
    if (!byPr.has(r.prId)) byPr.set(r.prId, r.score);
  }
  return byPr;
}

/** Build a PR-list row (`PrMeta`) from a stored PR + its rollups. */
export function toPrMeta(row: PullRow, rollups: PrRollups, now: number): PrMeta {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    author: row.author,
    branch: row.branch,
    base: row.base,
    head_sha: row.headSha,
    additions: row.additions,
    deletions: row.deletions,
    files_count: row.filesCount,
    status: deriveReviewStatus({
      ghStatus: row.status,
      lastReviewedSha: row.lastReviewedSha,
      headSha: row.headSha,
      updatedAt: row.updatedAt,
      now,
    }),
    opened_at: row.openedAt?.toISOString() ?? null,
    updated_at: row.updatedAt?.toISOString() ?? null,
    score: rollups.score,
    cost_usd: rollups.costUsd,
    findings: rollups.findings,
  };
}

/**
 * Build a full PR detail from persisted rows (the local-first / offline path,
 * when GitHub is unavailable). The online path returns GitHub's `PrDetail`
 * directly (only stamping the local `id`).
 */
export function toPrDetail(pr: PullRow, files: PrFileRow[], commits: PrCommitRow[]): PrDetail {
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    author: pr.author,
    branch: pr.branch,
    base: pr.base,
    head_sha: pr.headSha,
    additions: pr.additions,
    deletions: pr.deletions,
    files_count: pr.filesCount,
    status: pr.status as PrDetail['status'],
    opened_at: pr.openedAt?.toISOString() ?? null,
    updated_at: pr.updatedAt?.toISOString() ?? null,
    body: pr.body ?? null,
    files: files.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ?? null,
    })),
    commits: commits.map((c) => ({
      sha: c.sha,
      message: c.message,
      author: c.author,
      committed_at: c.committedAt?.toISOString() ?? null,
    })),
  };
}
