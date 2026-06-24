import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConventionsService } from '../src/modules/conventions/service.js';
import { ConventionsRepository } from '../src/modules/conventions/repository.js';
import type { Container } from '../src/platform/container.js';
import type { ExtractedConvention } from '@devdigest/shared';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
import { readFile } from 'node:fs/promises';

// ── fixtures ────────────────────────────────────────────────────────────────

const WS = 'ws-1';
const REPO_ID = 'repo-1';
const JOB_ID = 'job-1';
const CLONE = '/clone';
const FAKE_REPO = { id: REPO_ID, workspaceId: WS, fullName: 'owner/repo', clonePath: CLONE };

const FILE_A = 'src/a.ts';
const CONTENT_A = 'const x = await f();\nconst y = await g();';

/** Wire readFile to return specific content per filename suffix; everything else → ENOENT. */
function setupReadFile(files: Record<string, string>): void {
  vi.mocked(readFile).mockImplementation(async (path) => {
    const p = String(path);
    for (const [k, v] of Object.entries(files)) {
      if (p.endsWith(k)) return v as string;
    }
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
}

/** Build a minimal Container mock; returns the inner completeStructured spy too. */
function makeContainer(samplePaths = [FILE_A]) {
  const completeStructured = vi.fn().mockResolvedValue({
    data: { candidates: [] as ExtractedConvention[] },
    tokensIn: 0,
    tokensOut: 0,
    costUsd: null,
    raw: '{}',
  });
  const container = {
    reposRepo: { getById: vi.fn().mockResolvedValue(FAKE_REPO) },
    repoIntel: { getConventionSamples: vi.fn().mockResolvedValue(samplePaths) },
    llm: vi.fn().mockResolvedValue({ completeStructured }),
    astGrep: {
      langForFile: (f: string) => (f.endsWith('.ts') ? 'ts' : null),
      parseSymbols: () => [],
      parseReferences: () => [],
      parseInvocationHeads: () => [],
      parseImports: () => [],
    },
    embedder: vi.fn().mockRejectedValue(new Error('Embeddings are disabled')),
    runBus: { publish: vi.fn(), complete: vi.fn() },
    db: {} as unknown,
  } as unknown as Container;
  return { container, completeStructured };
}

// ── suite ───────────────────────────────────────────────────────────────────

describe('ConventionsService.runExtractJob', () => {
  let replaceAllSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    replaceAllSpy = vi
      .spyOn(ConventionsRepository.prototype, 'replaceAll')
      .mockResolvedValue([]);
    // Default: FILE_A has content; all config files → ENOENT (no config rules).
    setupReadFile({ [FILE_A]: CONTENT_A });
  });

  it('swallows an LLM error and still calls replaceAll (no llm rows, job survives)', async () => {
    const { container, completeStructured } = makeContainer();
    completeStructured.mockRejectedValueOnce(new Error('No API key'));

    await new ConventionsService(container).runExtractJob({ workspaceId: WS, repoId: REPO_ID }, JOB_ID);

    expect(replaceAllSpy).toHaveBeenCalledOnce();
    const [, , rows] = replaceAllSpy.mock.calls[0]!;
    expect((rows as { source: string }[]).every((r) => r.source !== 'llm')).toBe(true);
  });

  it('filters out candidates below MIN_CONFIDENCE after corroboration; edge-0.6 stays', async () => {
    // anchor-low: 0.7 * 0.8 (single-occurrence penalty) = 0.56 < 0.6 → dropped
    // anchor-edge: 0.75 * 0.8 = 0.60 ≥ 0.6 → kept
    const CONTENT_MULTI = 'anchor-low-conf\nanchor-edge-conf';
    setupReadFile({ [FILE_A]: CONTENT_MULTI });
    const { container, completeStructured } = makeContainer();
    completeStructured.mockResolvedValue({
      data: {
        candidates: [
          { rule: 'Low rule', category: 'c', evidence_path: FILE_A, evidence_snippet: 'anchor-low-conf', confidence: 0.7 },
          { rule: 'Edge rule', category: 'c', evidence_path: FILE_A, evidence_snippet: 'anchor-edge-conf', confidence: 0.75 },
        ] as ExtractedConvention[],
      },
      tokensIn: 0, tokensOut: 0, costUsd: null, raw: '{}',
    });

    await new ConventionsService(container).runExtractJob({ workspaceId: WS, repoId: REPO_ID }, JOB_ID);

    const [, , rows] = replaceAllSpy.mock.calls[0]! as [string, string, { rule: string }[]];
    expect(rows.some((r) => r.rule === 'Edge rule')).toBe(true);
    expect(rows.some((r) => r.rule === 'Low rule')).toBe(false);
  });

  it('drops candidates whose evidence snippet is not in the sample files (hallucination)', async () => {
    const { container, completeStructured } = makeContainer();
    completeStructured.mockResolvedValue({
      data: {
        candidates: [
          { rule: 'Hallucinated', category: 'c', evidence_path: FILE_A, evidence_snippet: 'not-in-file()', confidence: 0.9 },
          { rule: 'Grounded', category: 'c', evidence_path: FILE_A, evidence_snippet: CONTENT_A.split('\n')[0]!, confidence: 0.9 },
        ] as ExtractedConvention[],
      },
      tokensIn: 0, tokensOut: 0, costUsd: null, raw: '{}',
    });

    await new ConventionsService(container).runExtractJob({ workspaceId: WS, repoId: REPO_ID }, JOB_ID);

    const [, , rows] = replaceAllSpy.mock.calls[0]! as [string, string, { rule: string }[]];
    expect(rows.some((r) => r.rule === 'Grounded')).toBe(true);
    expect(rows.some((r) => r.rule === 'Hallucinated')).toBe(false);
  });

  it('dedup: config rule beats LLM restatement of the same rule (config wins)', async () => {
    // .prettierrc.json {"singleQuote": true} → extractConfigConventions produces 'Use single quotes'
    setupReadFile({
      [FILE_A]: CONTENT_A,
      '.prettierrc.json': '{"singleQuote": true}',
    });
    const { container, completeStructured } = makeContainer();
    completeStructured.mockResolvedValue({
      data: {
        candidates: [
          // same normalized key as 'Use single quotes'; should be deduped out
          { rule: 'use single quotes', category: 'formatting', evidence_path: FILE_A, evidence_snippet: CONTENT_A.split('\n')[0]!, confidence: 0.9 },
        ] as ExtractedConvention[],
      },
      tokensIn: 0, tokensOut: 0, costUsd: null, raw: '{}',
    });

    await new ConventionsService(container).runExtractJob({ workspaceId: WS, repoId: REPO_ID }, JOB_ID);

    const [, , rows] = replaceAllSpy.mock.calls[0]! as [string, string, { rule: string; source: string; confidence: number }[]];
    const quoteRule = rows.find((r) => r.rule.toLowerCase().includes('single quote'));
    expect(quoteRule?.source).toBe('config');
    expect(quoteRule?.confidence).toBe(1.0);
    expect(rows.filter((r) => r.rule.toLowerCase().includes('single quote'))).toHaveLength(1);
  });

  it('keeps string-deduped rules when the embedder throws (embeddings disabled)', async () => {
    // Two distinct, grounded candidates → 2 drafts → F4 attempts embed → rejects → kept.
    const CONTENT = 'anchor-one\nanchor-two';
    setupReadFile({ [FILE_A]: CONTENT });
    const { container, completeStructured } = makeContainer();
    completeStructured.mockResolvedValue({
      data: {
        candidates: [
          { rule: 'Rule one', category: 'c', evidence_path: FILE_A, evidence_snippet: 'anchor-one', confidence: 0.9 },
          { rule: 'Rule two', category: 'c', evidence_path: FILE_A, evidence_snippet: 'anchor-two', confidence: 0.9 },
        ] as ExtractedConvention[],
      },
      tokensIn: 0, tokensOut: 0, costUsd: null, raw: '{}',
    });

    await new ConventionsService(container).runExtractJob({ workspaceId: WS, repoId: REPO_ID }, JOB_ID);

    expect(replaceAllSpy).toHaveBeenCalledOnce();
    const [, , rows] = replaceAllSpy.mock.calls[0]! as [string, string, { rule: string }[]];
    expect(rows.map((r) => r.rule).sort()).toEqual(['Rule one', 'Rule two']); // job survived, both kept
  });

  it('calls replaceAll with (workspaceId, repoId, rows) where each row carries extractedAt', async () => {
    const { container } = makeContainer();

    await new ConventionsService(container).runExtractJob({ workspaceId: WS, repoId: REPO_ID }, JOB_ID);

    expect(replaceAllSpy).toHaveBeenCalledOnce();
    const [ws, repoId, rows] = replaceAllSpy.mock.calls[0]! as [string, string, { extractedAt: unknown }[]];
    expect(ws).toBe(WS);
    expect(repoId).toBe(REPO_ID);
    expect(rows.every((r) => r.extractedAt instanceof Date)).toBe(true);
  });
});
