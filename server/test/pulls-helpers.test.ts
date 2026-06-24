/**
 * PR DTO assembly (`modules/pulls/helpers.ts`) — the pure row → contract mapping
 * the pulls service uses to build list (`PrMeta`) and detail (`PrDetail`)
 * payloads. Covered independently of the route's queries / GitHub sync.
 */
import { describe, it, expect } from 'vitest';
import { latestScoreByPr, toPrMeta, toPrDetail } from '../src/modules/pulls/helpers.js';
import type { PullRow, PrFileRow, PrCommitRow } from '../src/db/rows.js';

const now = Date.UTC(2026, 5, 11);

function pull(overrides: Partial<PullRow> = {}): PullRow {
  return {
    id: 'pr-1',
    workspaceId: 'ws-1',
    repoId: 'repo-1',
    number: 7,
    title: 'Add rate limiting',
    author: 'marisa.koch',
    branch: 'feat/rl',
    base: 'main',
    headSha: 'abc',
    lastReviewedSha: null,
    additions: 10,
    deletions: 2,
    filesCount: 3,
    status: 'open',
    body: null,
    openedAt: new Date(now - 86_400_000),
    updatedAt: new Date(now),
    ...overrides,
  };
}

describe('latestScoreByPr', () => {
  it('keeps the FIRST score seen per PR (caller passes rows newest-first)', () => {
    const map = latestScoreByPr([
      { prId: 'a', score: 90 }, // newest for a
      { prId: 'a', score: 50 }, // older — ignored
      { prId: 'b', score: null },
    ]);
    expect(map.get('a')).toBe(90);
    expect(map.get('b')).toBe(null);
    expect(map.has('c')).toBe(false);
  });
});

describe('toPrMeta', () => {
  it('maps a row + rollups into PrMeta and derives review status', () => {
    const meta = toPrMeta(
      pull({ lastReviewedSha: null }),
      { score: 88, costUsd: 0.42, findings: { CRITICAL: 1, WARNING: 0, SUGGESTION: 2 } },
      now,
    );
    expect(meta).toMatchObject({
      id: 'pr-1',
      number: 7,
      head_sha: 'abc',
      additions: 10,
      deletions: 2,
      files_count: 3,
      status: 'needs_review', // open + never reviewed
      score: 88,
      cost_usd: 0.42,
      findings: { CRITICAL: 1, WARNING: 0, SUGGESTION: 2 },
    });
    expect(meta.opened_at).toBe(new Date(now - 86_400_000).toISOString());
    expect(meta.updated_at).toBe(new Date(now).toISOString());
  });

  it('passes through null rollups (unreviewed PR) without inventing zeros', () => {
    const meta = toPrMeta(pull(), { score: null, costUsd: null, findings: null }, now);
    expect(meta.score).toBeNull();
    expect(meta.cost_usd).toBeNull();
    expect(meta.findings).toBeNull();
  });
});

describe('toPrDetail', () => {
  it('assembles the offline detail from persisted rows', () => {
    const files: PrFileRow[] = [
      { id: 'f1', prId: 'pr-1', path: 'src/a.ts', additions: 5, deletions: 1, patch: '@@ -1 +1 @@' },
    ];
    const commits: PrCommitRow[] = [
      {
        id: 'c1',
        prId: 'pr-1',
        sha: 'deadbeef',
        message: 'fix',
        author: 'dev',
        committedAt: new Date(now),
      },
    ];
    const detail = toPrDetail(pull({ body: 'PR body' }), files, commits);
    expect(detail.body).toBe('PR body');
    expect(detail.files).toEqual([
      { path: 'src/a.ts', additions: 5, deletions: 1, patch: '@@ -1 +1 @@' },
    ]);
    expect(detail.commits).toEqual([
      { sha: 'deadbeef', message: 'fix', author: 'dev', committed_at: new Date(now).toISOString() },
    ]);
  });
});
