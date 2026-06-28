/**
 * Unit tests for ReviewService.reviewsForPull — anchor_status annotation (gap 25b).
 *
 * Mirror the fake-repo style from intent-service.test.ts: a fake ReviewRepository +
 * a fake AgentsRepository are injected into ReviewService via a Container stub.
 * No DB, no Docker, no git.
 *
 * Scenarios:
 *  A. Review whose headSha !== pull.headSha → three findings →
 *       - finding on a file absent from pr_files  ⇒ 'orphaned'
 *       - finding whose lines are NOT in the patch ⇒ 'moved_out'
 *       - finding whose lines ARE in the patch     ⇒ 'current'
 *     getPrFiles MUST be called (diff was built).
 *
 *  B. Review whose headSha === pull.headSha → all findings 'current', getPrFiles NOT called.
 *
 *  C. Review whose headSha === null → all findings 'current', getPrFiles NOT called.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewService } from '../src/modules/reviews/service.js';
import type { Container } from '../src/platform/container.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import { anchorFingerprint } from '../src/modules/reviews/freshness.js';
import { anchoredText } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../src/lib/diff-parser.js';
import type { Finding } from '@devdigest/shared';

/**
 * Recompute the fingerprint the server would store for a finding against the
 * CURRENT pr_files patch — the SAME anchoredText + sha256 path the read uses.
 * This is how the write side derives the fp; a matching value ⇒ `current`, any
 * other value ⇒ `content_changed`.
 */
function fpForCurrentDiff(file: string, startLine: number, endLine: number): string {
  const diff = parseUnifiedDiff(
    PR_FILES.map((f) => `diff --git a/${f.path} b/${f.path}\n--- a/${f.path}\n+++ b/${f.path}\n${f.patch}`).join('\n'),
  );
  const finding = {
    id: 'probe',
    severity: 'WARNING',
    category: 'bug',
    title: 't',
    file,
    start_line: startLine,
    end_line: endLine,
    rationale: 'r',
    confidence: 0.8,
    kind: 'finding',
  } as Finding;
  const text = anchoredText(finding, diff);
  if (text == null) throw new Error('probe finding has no anchored text');
  return anchorFingerprint(text);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'ws-uuid-1';
const PR_ID = 'pr-uuid-1';
const REVIEW_ID = 'rev-uuid-1';

const PULL = {
  id: PR_ID,
  workspaceId: WORKSPACE_ID,
  repoId: 'repo-uuid-1',
  number: 42,
  title: 'Add rate limiting',
  author: 'dev',
  branch: 'feat/rl',
  base: 'main',
  headSha: 'current-sha',
  lastReviewedSha: null,
  additions: 5,
  deletions: 0,
  filesCount: 1,
  status: 'needs_review',
  body: null,
  openedAt: null,
  updatedAt: null,
};

/**
 * pr_files for the CURRENT head: one file with a patch that touches lines 10–14.
 * diffFromPrFiles builds the diff from these rows → line 12 is in the hunk,
 * line 999 is not, and 'src/gone.ts' is absent entirely.
 */
const PR_FILES = [
  {
    id: 'pf-1',
    prId: PR_ID,
    path: 'src/service.ts',
    additions: 5,
    deletions: 0,
    patch: '@@ -10,3 +10,5 @@\n   existing code;\n+  newline1;\n+  newline2;\n+  newline3;\n+  newline4;',
  },
];

/** A finding row that converts to a ReviewDtoFinding via findingRowToDto. */
function makeRow(
  id: string,
  file: string,
  startLine: number,
  endLine: number,
  reviewId = REVIEW_ID,
  anchorFingerprint: string | null = null,
) {
  return {
    id,
    reviewId,
    file,
    startLine,
    endLine,
    severity: 'WARNING',
    category: 'bug',
    title: `Finding ${id}`,
    rationale: 'r',
    suggestion: null,
    confidence: 0.8,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: null,
    dismissedAt: null,
    anchorFingerprint,
  };
}

/** Build a fake ReviewRow with optional headSha. */
function makeReviewRow(headSha: string | null) {
  return {
    id: REVIEW_ID,
    prId: PR_ID,
    workspaceId: WORKSPACE_ID,
    agentId: null,
    runId: null,
    kind: 'review' as const,
    verdict: 'comment',
    summary: 'seeded',
    score: 80,
    model: 'mock',
    headSha,
    createdAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Fake container builder
// ---------------------------------------------------------------------------

function makeContainer(
  reviewRow: ReturnType<typeof makeReviewRow>,
  findings: ReturnType<typeof makeRow>[],
  getPrFiles?: () => Promise<typeof PR_FILES>,
): { container: Container; getPrFilesSpy: ReturnType<typeof vi.fn> } {
  const getPrFilesSpy = vi.fn(getPrFiles ?? (() => Promise.resolve(PR_FILES)));

  const fakeRepo = {
    getPull: vi.fn().mockResolvedValue(PULL),
    reviewsForPull: vi.fn().mockResolvedValue([{ review: reviewRow, findings }]),
    getPrFiles: getPrFilesSpy,
  } as unknown as ReviewRepository;

  const fakeAgentsRepo = {
    listEnabled: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    linkedSkills: vi.fn().mockResolvedValue([]),
  };

  const container = {
    db: {} as Container['db'],
    agentsRepo: fakeAgentsRepo,
    runBus: {
      publish: vi.fn(),
      complete: vi.fn(),
      cancel: vi.fn(),
      isCancelled: vi.fn().mockReturnValue(false),
      buffer: vi.fn().mockReturnValue([]),
      subscribe: vi.fn(),
    },
    llm: vi.fn(),
    repoIntel: { getCallerSignatures: vi.fn(), getRepoMap: vi.fn(), getFileRank: vi.fn() },
    tokenizer: { count: (t: string) => Math.ceil(t.length / 4) },
  } as unknown as Container;

  // Inject the fake repo by bypassing the private constructor pattern:
  // ReviewService builds its own ReviewRepository from container.db.
  // We patch the private `repo` field after construction so no real DB is used.
  return { container, getPrFilesSpy };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReviewService.reviewsForPull — anchor_status annotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Scenario A: HEAD MOVED ────────────────────────────────────────────────
  // review.headSha ('old-sha') !== pull.headSha ('current-sha')
  // → diff is built from pr_files; three findings receive distinct anchor_status values.
  it('annotates findings correctly when review headSha differs from pull headSha', async () => {
    // Unit under test : ReviewService.reviewsForPull
    // Input           : pull.headSha='current-sha', review.headSha='old-sha'
    //                   findings: orphan (absent file), moved (line 999), current (line 12)
    // Stubs           : fakeRepo.getPrFiles returns PR_FILES (patch covers lines 10-14)
    // Expected        : orphaned, moved_out, current respectively; getPrFiles called once

    const reviewRow = makeReviewRow('old-sha');
    const findings = [
      makeRow('f-orphan', 'src/gone.ts', 5, 5),      // file absent from pr_files
      makeRow('f-moved', 'src/service.ts', 999, 999), // line NOT in hunk
      makeRow('f-current', 'src/service.ts', 12, 12), // line 12 IS in hunk [10..14]
    ];

    const { container, getPrFilesSpy } = makeContainer(reviewRow, findings);
    const service = new ReviewService(container);
    // Patch the private `repo` to inject our fake instead of real ReviewRepository.
    (service as unknown as { repo: ReviewRepository }).repo = {
      getPull: vi.fn().mockResolvedValue(PULL),
      reviewsForPull: vi.fn().mockResolvedValue([{ review: reviewRow, findings }]),
      getPrFiles: getPrFilesSpy,
    } as unknown as ReviewRepository;

    const dtos = await service.reviewsForPull(WORKSPACE_ID, PR_ID);

    expect(dtos).toHaveLength(1);
    const dtoFindings = dtos[0]!.findings;

    const orphan = dtoFindings.find((f) => f.id === 'f-orphan');
    const moved = dtoFindings.find((f) => f.id === 'f-moved');
    const current = dtoFindings.find((f) => f.id === 'f-current');

    expect(orphan?.anchor_status).toBe('orphaned');
    expect(moved?.anchor_status).toBe('moved_out');
    expect(current?.anchor_status).toBe('current');

    // getPrFiles was called ONCE (diff built once and reused).
    expect(getPrFilesSpy).toHaveBeenCalledTimes(1);
  });

  // ── Scenario B: HEAD MATCHES ──────────────────────────────────────────────
  // review.headSha === pull.headSha → fast path: all 'current', getPrFiles NOT called.
  it('fast-paths when review headSha matches pull headSha — all current, getPrFiles skipped', async () => {
    // Unit under test : ReviewService.reviewsForPull
    // Input           : pull.headSha='current-sha', review.headSha='current-sha'
    // Stubs           : getPrFiles spy (should never be called)
    // Expected        : every finding.anchor_status === 'current'; getPrFiles call count 0

    const reviewRow = makeReviewRow('current-sha');
    const findings = [
      makeRow('f1', 'src/service.ts', 12, 12),
      makeRow('f2', 'src/service.ts', 999, 999),
    ];

    const { container, getPrFilesSpy } = makeContainer(reviewRow, findings);
    const service = new ReviewService(container);
    (service as unknown as { repo: ReviewRepository }).repo = {
      getPull: vi.fn().mockResolvedValue(PULL),
      reviewsForPull: vi.fn().mockResolvedValue([{ review: reviewRow, findings }]),
      getPrFiles: getPrFilesSpy,
    } as unknown as ReviewRepository;

    const dtos = await service.reviewsForPull(WORKSPACE_ID, PR_ID);
    const dtoFindings = dtos[0]!.findings;

    for (const f of dtoFindings) {
      expect(f.anchor_status).toBe('current');
    }
    expect(getPrFilesSpy).not.toHaveBeenCalled();
  });

  // ── Scenario C: LEGACY NULL headSha ──────────────────────────────────────
  // review.headSha === null → fast path: all 'current', getPrFiles NOT called.
  it('fast-paths when review headSha is null (legacy row) — all current, getPrFiles skipped', async () => {
    // Unit under test : ReviewService.reviewsForPull
    // Input           : pull.headSha='current-sha', review.headSha=null
    // Stubs           : getPrFiles spy (should never be called)
    // Expected        : every finding.anchor_status === 'current'; getPrFiles call count 0

    const reviewRow = makeReviewRow(null);
    const findings = [makeRow('f1', 'src/service.ts', 50, 50)];

    const { container, getPrFilesSpy } = makeContainer(reviewRow, findings);
    const service = new ReviewService(container);
    (service as unknown as { repo: ReviewRepository }).repo = {
      getPull: vi.fn().mockResolvedValue(PULL),
      reviewsForPull: vi.fn().mockResolvedValue([{ review: reviewRow, findings }]),
      getPrFiles: getPrFilesSpy,
    } as unknown as ReviewRepository;

    const dtos = await service.reviewsForPull(WORKSPACE_ID, PR_ID);

    for (const f of dtos[0]!.findings) {
      expect(f.anchor_status).toBe('current');
    }
    expect(getPrFilesSpy).not.toHaveBeenCalled();
  });

  // ── Scenario D: CONTENT CHANGED (L2-lite, Issue #3) ──────────────────────
  // head moved; the finding's lines are STILL present (anchorStatus → current)
  // but the stored fingerprint does NOT match the current anchored text →
  // 'content_changed'. A sibling finding whose stored fp MATCHES → 'current'.
  it("flags content_changed when stored fingerprint differs, current when it matches", async () => {
    // Unit under test : ReviewService.reviewsForPull
    // Input           : pull.headSha='current-sha', review.headSha='old-sha'
    //                   f-changed: line 12 in hunk, stored fp = STALE value
    //                   f-same:    line 12 in hunk, stored fp = CURRENT value
    // Stubs           : getPrFiles returns PR_FILES (patch covers lines 10-14)
    // Expected        : f-changed → 'content_changed', f-same → 'current'

    const reviewRow = makeReviewRow('old-sha');
    const matchingFp = fpForCurrentDiff('src/service.ts', 12, 12);
    const findings = [
      makeRow('f-changed', 'src/service.ts', 12, 12, REVIEW_ID, 'sha-of-old-rewritten-code'),
      makeRow('f-same', 'src/service.ts', 12, 12, REVIEW_ID, matchingFp),
    ];

    const { container, getPrFilesSpy } = makeContainer(reviewRow, findings);
    const service = new ReviewService(container);
    (service as unknown as { repo: ReviewRepository }).repo = {
      getPull: vi.fn().mockResolvedValue(PULL),
      reviewsForPull: vi.fn().mockResolvedValue([{ review: reviewRow, findings }]),
      getPrFiles: getPrFilesSpy,
    } as unknown as ReviewRepository;

    const dtoFindings = (await service.reviewsForPull(WORKSPACE_ID, PR_ID))[0]!.findings;
    expect(dtoFindings.find((f) => f.id === 'f-changed')?.anchor_status).toBe('content_changed');
    expect(dtoFindings.find((f) => f.id === 'f-same')?.anchor_status).toBe('current');
  });

  // ── Scenario E: LEGACY NULL fingerprint → never content_changed ──────────
  // head moved, line present, but the finding predates the column (fp NULL) →
  // we do NOT compare → stays 'current' (no false content_changed).
  it('legacy finding with NULL fingerprint stays current even when head moved', async () => {
    // Unit under test : ReviewService.reviewsForPull
    // Input           : review.headSha='old-sha', finding line 12 in hunk, fp = null
    // Expected        : 'current' (NULL fp ⇒ skip comparison)

    const reviewRow = makeReviewRow('old-sha');
    const findings = [makeRow('f-legacy', 'src/service.ts', 12, 12, REVIEW_ID, null)];

    const { container, getPrFilesSpy } = makeContainer(reviewRow, findings);
    const service = new ReviewService(container);
    (service as unknown as { repo: ReviewRepository }).repo = {
      getPull: vi.fn().mockResolvedValue(PULL),
      reviewsForPull: vi.fn().mockResolvedValue([{ review: reviewRow, findings }]),
      getPrFiles: getPrFilesSpy,
    } as unknown as ReviewRepository;

    const dtoFindings = (await service.reviewsForPull(WORKSPACE_ID, PR_ID))[0]!.findings;
    expect(dtoFindings[0]!.anchor_status).toBe('current');
  });

  // ── Scenario F: ADDED-FILE rewritten content → content_changed ───────────
  // The Issue #3 acceptance criterion: an added file is one whole-file hunk so
  // every line is "covered" (anchorStatus can only say current), yet the code
  // on those lines was rewritten by a later commit — the fingerprint catches it.
  it('added-file rewritten content → content_changed; unchanged → current', async () => {
    const ADDED_FILES = [
      {
        id: 'pf-add',
        prId: PR_ID,
        path: 'server/src/modules/share/repository.ts',
        additions: 3,
        deletions: 0,
        // current (post-fix) content of an added file: a parameterized query
        patch:
          '@@ -0,0 +1,3 @@\n+export function getShare(db, id) {\n+  return db.query(SELECT_SHARE, [id]);\n+}',
      },
    ];
    const reviewRow = makeReviewRow('old-sha');
    // The review ran when the file held VULNERABLE code → its stored fp hashes
    // the OLD text, which differs from the current parameterized version.
    const staleFp = anchorFingerprint(
      ['export function getShare(db, id) {', '  return db.query(`SELECT * FROM shares WHERE id=${id}`);', '}'].join('\n'),
    );
    // A second finding stored the CURRENT text's fp → unchanged.
    const currentText = ['export function getShare(db, id) {', '  return db.query(SELECT_SHARE, [id]);', '}'].join('\n');
    const currentFp = anchorFingerprint(currentText);

    const findings = [
      makeRow('f-vuln', 'server/src/modules/share/repository.ts', 1, 3, REVIEW_ID, staleFp),
      makeRow('f-ok', 'server/src/modules/share/repository.ts', 1, 3, REVIEW_ID, currentFp),
    ];

    const { container } = makeContainer(reviewRow, findings, () => Promise.resolve(ADDED_FILES as never));
    const service = new ReviewService(container);
    (service as unknown as { repo: ReviewRepository }).repo = {
      getPull: vi.fn().mockResolvedValue(PULL),
      reviewsForPull: vi.fn().mockResolvedValue([{ review: reviewRow, findings }]),
      getPrFiles: vi.fn().mockResolvedValue(ADDED_FILES),
    } as unknown as ReviewRepository;

    const dtoFindings = (await service.reviewsForPull(WORKSPACE_ID, PR_ID))[0]!.findings;
    expect(dtoFindings.find((f) => f.id === 'f-vuln')?.anchor_status).toBe('content_changed');
    expect(dtoFindings.find((f) => f.id === 'f-ok')?.anchor_status).toBe('current');
  });
});
