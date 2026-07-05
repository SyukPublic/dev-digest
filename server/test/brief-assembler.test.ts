/**
 * Phase 4 (T7, T8) — brief assembler unit tests (CP-4, AC-1/AC-12/AC-19).
 *
 * The assembler builds the `BriefInputBundle` from ALREADY-COMPUTED artifacts
 * reached via the facades (blast, smart-diff, intent, GitHub, project-context).
 * We spy the facade services' methods so the test isolates the assembler's pure
 * SHAPING logic (no DB/IO, no LLM). Covers:
 *   T7  builds the bundle from all sources with ZERO LLM/embedding + NO diff
 *       hunks / file bodies / raw patch (AC-1, AC-19);
 *   T8  any missing/degraded/erroring source is dropped best-effort; assembly
 *       continues over the rest without throwing (AC-12).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BlastResponse, SmartDiff } from '@devdigest/shared';
import { assembleBriefBundle, toBlastFiles, toSmartDiffGroups } from '../src/modules/brief/assembler.js';
import { BlastService } from '../src/modules/blast/service.js';
import { SmartDiffService } from '../src/modules/smart-diff/service.js';
import { ProjectContextService } from '../src/modules/project-context/service.js';
import type { Container } from '../src/platform/container.js';
import type { PullRow } from '../src/db/rows.js';

const WS = 'ws-1';
const PR_ID = 'pr-1';

const FAKE_PULL: PullRow = {
  id: PR_ID,
  workspaceId: WS,
  repoId: 'repo-1',
  number: 7,
  title: 'Add the widget',
  author: 'dev',
  branch: 'feat/x',
  base: 'main',
  headSha: 'sha-1',
  lastReviewedSha: null,
  additions: 3,
  deletions: 1,
  filesCount: 2,
  status: 'needs_review',
  body: 'closes #12',
  openedAt: null,
  updatedAt: null,
};

const BLAST: BlastResponse = {
  pr_id: PR_ID,
  status: 'full',
  degraded_reason: null,
  indexed_branch: 'main',
  indexed_sha: 'sha-idx',
  blast: {
    changed_symbols: [{ name: 'alpha', file: 'src/a.ts', kind: 'function' }],
    downstream: [
      {
        symbol: 'alpha',
        callers: [{ name: 'callA', file: 'src/x.ts', line: 10 }],
        endpoints_affected: ['GET /things'],
        crons_affected: [],
      },
    ],
    summary: 'Alpha reaches one caller.',
  },
};

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: 'core',
      files: [
        { path: 'src/a.ts', pseudocode_summary: 'does X', additions: 3, deletions: 1, finding_lines: [10, 11] },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 4, proposed_splits: [] },
};

/** A container fake carrying only what the assembler's own code reads directly. */
function makeContainer() {
  const reviewRepo = {
    getIntent: vi.fn().mockResolvedValue({
      intent: 'Introduce the widget',
      in_scope: ['add widget'],
      out_of_scope: ['unrelated'],
      headSha: 'sha-1',
      freshnessKey: 'ik-1',
    }),
    getRepo: vi.fn().mockResolvedValue({ owner: 'acme', name: 'app' }),
  };
  const github = vi.fn().mockResolvedValue({
    getIssue: vi.fn().mockResolvedValue({ number: 12, title: 'Widget request', body: 'please add', state: 'open' }),
  });
  const agentsRepo = {
    listEnabled: vi.fn().mockResolvedValue([]),
    linkedSkills: vi.fn().mockResolvedValue([]),
  };
  const container = { reviewRepo, github, agentsRepo } as unknown as Container;
  return { container, reviewRepo, github, agentsRepo };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── pure shapers ──────────────────────────────────────────────────────────────

describe('toBlastFiles', () => {
  it('unions changed-symbol + caller files with callers/endpoints, no duplicates', () => {
    const files = toBlastFiles(BLAST);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(['src/a.ts', 'src/x.ts']);
    const caller = files.find((f) => f.path === 'src/x.ts')!;
    expect(caller.callers).toEqual(['callA']);
    expect(caller.endpoints).toEqual(['GET /things']);
    // A bare changed file with no downstream contributes its path (callers null).
    const changed = files.find((f) => f.path === 'src/a.ts')!;
    expect(changed.callers).toBeNull();
  });
});

describe('toSmartDiffGroups', () => {
  it('maps finding_lines.length → finding_count and drops patch/pseudocode (AC-1)', () => {
    const groups = toSmartDiffGroups(SMART_DIFF);
    expect(groups).toEqual([
      { role: 'core', files: [{ path: 'src/a.ts', additions: 3, deletions: 1, finding_count: 2 }] },
    ]);
    // No raw-patch/pseudocode keys leak into the shaped stats.
    const serialized = JSON.stringify(groups);
    expect(serialized).not.toContain('pseudocode');
    expect(serialized).not.toContain('finding_lines');
  });
});

// ── full assembler: happy path (T7) ───────────────────────────────────────────

describe('assembleBriefBundle — all sources present (T7)', () => {
  it('builds the bundle with zero LLM/embedding and NO diff bodies', async () => {
    const { container } = makeContainer();
    vi.spyOn(BlastService.prototype, 'getBlast').mockResolvedValue(BLAST);
    vi.spyOn(SmartDiffService.prototype, 'getSmartDiff').mockResolvedValue(SMART_DIFF);
    vi.spyOn(ProjectContextService.prototype, 'resolveSpecPathsForAgent').mockResolvedValue([]);

    const bundle = await assembleBriefBundle(container, WS, FAKE_PULL);

    expect(bundle.intent).toContain('Introduce the widget');
    expect(bundle.blast_summary).toBe('Alpha reaches one caller.');
    expect(bundle.blast_files.map((f) => f.path).sort()).toEqual(['src/a.ts', 'src/x.ts']);
    expect(bundle.smart_diff_groups[0]!.files[0]!.finding_count).toBe(2);
    expect(bundle.linked_issue).toEqual({ number: 12, title: 'Widget request', body: 'please add' });

    // No raw diff / hunks / patch anywhere in the assembled bundle (AC-1).
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('@@');
    expect(serialized).not.toContain('finding_lines');
    expect(serialized).not.toContain('pseudocode');
  });
});

// ── degraded / missing sources (T8) ───────────────────────────────────────────

describe('assembleBriefBundle — best-effort degraded sources (T8)', () => {
  it('drops each missing/erroring source and continues without throwing', async () => {
    const { container, reviewRepo, github } = makeContainer();
    // No intent stored.
    reviewRepo.getIntent.mockResolvedValue(undefined);
    // Blast throws (degraded index) → dropped.
    vi.spyOn(BlastService.prototype, 'getBlast').mockRejectedValue(new Error('blast boom'));
    // Smart-diff throws (no review) → dropped.
    vi.spyOn(SmartDiffService.prototype, 'getSmartDiff').mockRejectedValue(new Error('no review'));
    // GitHub token missing → issue dropped.
    github.mockRejectedValue(new Error('no token'));
    vi.spyOn(ProjectContextService.prototype, 'resolveSpecPathsForAgent').mockResolvedValue([]);

    const bundle = await assembleBriefBundle(container, WS, FAKE_PULL);

    expect(bundle.intent).toBeNull();
    expect(bundle.blast_summary).toBeNull();
    expect(bundle.blast_files).toEqual([]);
    expect(bundle.smart_diff_groups).toEqual([]);
    expect(bundle.linked_issue).toBeNull();
    expect(bundle.specs).toEqual([]);
  });

  it('drops just the linked issue when the PR body has no ref (others survive)', async () => {
    const { container } = makeContainer();
    const noRefPull = { ...FAKE_PULL, body: 'no ref here' };
    vi.spyOn(BlastService.prototype, 'getBlast').mockResolvedValue(BLAST);
    vi.spyOn(SmartDiffService.prototype, 'getSmartDiff').mockResolvedValue(SMART_DIFF);
    vi.spyOn(ProjectContextService.prototype, 'resolveSpecPathsForAgent').mockResolvedValue([]);

    const bundle = await assembleBriefBundle(container, WS, noRefPull);

    expect(bundle.linked_issue).toBeNull();
    expect(bundle.blast_files.length).toBeGreaterThan(0);
    expect(bundle.smart_diff_groups.length).toBeGreaterThan(0);
  });

  it('reads only ok-status specs from the resolver (skipped specs are dropped)', async () => {
    const { container, agentsRepo } = makeContainer();
    agentsRepo.listEnabled.mockResolvedValue([{ id: 'agent-1' }]);
    agentsRepo.linkedSkills.mockResolvedValue([]);
    vi.spyOn(BlastService.prototype, 'getBlast').mockResolvedValue(BLAST);
    vi.spyOn(SmartDiffService.prototype, 'getSmartDiff').mockResolvedValue(SMART_DIFF);
    vi.spyOn(ProjectContextService.prototype, 'resolveSpecPathsForAgent').mockResolvedValue([
      'docs/a.md',
      'docs/b.md',
    ]);
    vi.spyOn(ProjectContextService.prototype, 'readSpecsForRun').mockResolvedValue([
      { path: 'docs/a.md', ok: true, content: '# A' },
      { path: 'docs/b.md', ok: false, reason: 'dangling' },
    ]);

    const bundle = await assembleBriefBundle(container, WS, FAKE_PULL);

    expect(bundle.specs).toEqual([{ path: 'docs/a.md', content: '# A' }]);
  });
});
