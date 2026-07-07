import { describe, it, expect } from 'vitest';
import {
  OnboardingFacts,
  OnboardingIndexState,
  RankedFile,
  OnboardingTourMeta,
  OnboardingTourResponse,
} from '@devdigest/shared';

/**
 * Phase 1 contract tests (T1, T2).
 * Pure unit — no DB. Covers the NEW onboarding-generator boundary shapes; the
 * `Onboarding` narrative document is reused unchanged (asserted via the envelope).
 */

// ── T1: OnboardingFacts ──────────────────────────────────────────────────────
describe('OnboardingFacts contract (T1)', () => {
  it('parses a valid, fully-populated facts bundle', () => {
    const facts = OnboardingFacts.parse({
      repoSkeleton: 'src/\n  index.ts\n  service.ts',
      rankedFiles: [
        { path: 'src/index.ts', percentile: 99 },
        { path: 'src/service.ts', percentile: 87.5 },
      ],
      criticalPaths: [
        ['src/index.ts', 'src/service.ts', 'src/repository.ts'],
        ['src/routes.ts', 'src/service.ts'],
      ],
      indexState: {
        filesIndexed: 128,
        updatedAt: '2026-07-05T10:00:00.000Z',
        degraded: false,
        degradedReason: null,
      },
    });
    expect(facts.rankedFiles).toHaveLength(2);
    expect(facts.rankedFiles[0]).toEqual({ path: 'src/index.ts', percentile: 99 });
    expect(facts.criticalPaths[0]).toEqual(['src/index.ts', 'src/service.ts', 'src/repository.ts']);
    expect(facts.indexState.degraded).toBe(false);
  });

  it('parses a degraded (empty) facts bundle — arrays empty, degraded flagged (AC-9)', () => {
    const degraded = OnboardingFacts.parse({
      repoSkeleton: '',
      rankedFiles: [],
      criticalPaths: [],
      indexState: {
        filesIndexed: 0,
        updatedAt: null,
        degraded: true,
        degradedReason: 'index not built',
      },
    });
    expect(degraded.rankedFiles).toEqual([]);
    expect(degraded.criticalPaths).toEqual([]);
    expect(degraded.indexState.updatedAt).toBeNull();
    expect(degraded.indexState.degraded).toBe(true);
    expect(degraded.indexState.degradedReason).toBe('index not built');
  });

  it('round-trips through parse without loss', () => {
    const input = {
      repoSkeleton: 'a/b.ts',
      rankedFiles: [{ path: 'a/b.ts', percentile: 50 }],
      criticalPaths: [['a/b.ts']],
      indexState: { filesIndexed: 1, updatedAt: null, degraded: false, degradedReason: null },
    };
    expect(OnboardingFacts.parse(input)).toEqual(input);
  });

  it('RankedFile requires both path and percentile', () => {
    expect(RankedFile.safeParse({ path: 'x.ts', percentile: 12 }).success).toBe(true);
    expect(RankedFile.safeParse({ path: 'x.ts' }).success).toBe(false);
    expect(RankedFile.safeParse({ percentile: 12 }).success).toBe(false);
  });

  it('OnboardingIndexState requires filesIndexed>=0 int and nullable strings', () => {
    expect(
      OnboardingIndexState.safeParse({
        filesIndexed: 0,
        updatedAt: null,
        degraded: false,
        degradedReason: null,
      }).success,
    ).toBe(true);
    // negative / non-integer file count → reject
    expect(
      OnboardingIndexState.safeParse({
        filesIndexed: -1,
        updatedAt: null,
        degraded: false,
        degradedReason: null,
      }).success,
    ).toBe(false);
    expect(
      OnboardingIndexState.safeParse({
        filesIndexed: 1.5,
        updatedAt: null,
        degraded: false,
        degradedReason: null,
      }).success,
    ).toBe(false);
    // updatedAt / degradedReason are NULLABLE (not optional) — must be present
    expect(
      OnboardingIndexState.safeParse({ filesIndexed: 1, degraded: false }).success,
    ).toBe(false);
  });

  it('rejects a facts bundle missing indexState', () => {
    expect(
      OnboardingFacts.safeParse({ repoSkeleton: '', rankedFiles: [], criticalPaths: [] }).success,
    ).toBe(false);
  });
});

// ── T2: OnboardingTourResponse ───────────────────────────────────────────────
describe('OnboardingTourResponse contract (T2)', () => {
  const meta = {
    filesIndexed: 42,
    generatedAt: '2026-07-05T09:00:00.000Z',
    degraded: false,
    degradedReason: null,
    stale: false,
  };

  const storedTour = {
    sections: [
      {
        kind: 'overview',
        title: 'Overview',
        body: '# Overview\nWhat this repo does.',
        diagram: null,
        links: [{ label: 'README', path: 'README.md' }],
      },
      {
        kind: 'architecture',
        title: 'Architecture',
        body: 'The layers.',
        diagram: 'graph TD; A-->B',
        links: [],
      },
    ],
  };

  it('parses a stored-tour response (tour + meta), reusing Onboarding unchanged (AC-1)', () => {
    const parsed = OnboardingTourResponse.parse({ tour: storedTour, meta });
    expect(parsed.tour).not.toBeNull();
    expect(parsed.tour?.sections).toHaveLength(2);
    expect(parsed.tour?.sections[1].diagram).toBe('graph TD; A-->B');
    expect(parsed.meta.filesIndexed).toBe(42);
    expect(parsed.meta.stale).toBe(false);
  });

  it('parses a tour:null empty-state response (AC-6)', () => {
    const parsed = OnboardingTourResponse.parse({
      tour: null,
      meta: { ...meta, generatedAt: null },
    });
    expect(parsed.tour).toBeNull();
    expect(parsed.meta.generatedAt).toBeNull();
  });

  it('parses a degraded + stale response (AC-9, AC-10)', () => {
    const parsed = OnboardingTourResponse.parse({
      tour: storedTour,
      meta: {
        filesIndexed: 0,
        generatedAt: '2026-07-01T00:00:00.000Z',
        degraded: true,
        degradedReason: 'partial index',
        stale: true,
      },
    });
    expect(parsed.meta.degraded).toBe(true);
    expect(parsed.meta.degradedReason).toBe('partial index');
    expect(parsed.meta.stale).toBe(true);
  });

  it('round-trips a stored-tour response through parse without loss', () => {
    const input = { tour: storedTour, meta };
    expect(OnboardingTourResponse.parse(input)).toEqual(input);
  });

  it('rejects a response missing meta, and requires tour to be present (null allowed)', () => {
    expect(OnboardingTourResponse.safeParse({ tour: storedTour }).success).toBe(false);
    // `tour` must be present (null or an Onboarding) — absent key is invalid.
    expect(OnboardingTourResponse.safeParse({ meta }).success).toBe(false);
  });

  it('OnboardingTourMeta requires all fields (nullable, not optional)', () => {
    expect(OnboardingTourMeta.safeParse(meta).success).toBe(true);
    expect(
      OnboardingTourMeta.safeParse({ filesIndexed: 1, degraded: false, stale: false }).success,
    ).toBe(false);
  });
});
