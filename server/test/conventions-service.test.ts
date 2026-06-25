import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConventionsService } from '../src/modules/conventions/service.js';
import { ConventionsRepository } from '../src/modules/conventions/repository.js';
import type { Container } from '../src/platform/container.js';
import type { ExtractedConvention } from '@devdigest/shared';
import type { AstGrep, ParsedSymbol } from '../src/adapters/astgrep/index.js';
import { adjustConfidence } from '../src/modules/conventions/helpers.js';
import { STRUCTURAL_BOOST } from '../src/modules/conventions/constants.js';

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

/** A ParsedSymbol fixture (matches the helper-level tests' shape). */
function sym(name: string, kind: ParsedSymbol['kind'], exported = false): ParsedSymbol {
  return { name, kind, line: 1, exported, signature: null, endLine: 1 } as ParsedSymbol;
}

/**
 * Build a minimal Container mock; returns the inner completeStructured spy too.
 * `astGrep` overrides selected ports of the default astGrep stub so a test can
 * exercise the structural-corroboration seam (F3) through the container.
 */
function makeContainer(samplePaths = [FILE_A], astGrep?: Partial<AstGrep>) {
  const completeStructured = vi.fn().mockResolvedValue({
    data: { candidates: [] as ExtractedConvention[] },
    tokensIn: 0,
    tokensOut: 0,
    costUsd: null,
    raw: '{}',
  });
  const runBus = { publish: vi.fn(), complete: vi.fn() };
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
      ...astGrep,
    },
    embedder: vi.fn().mockRejectedValue(new Error('Embeddings are disabled')),
    runBus,
    db: {} as unknown,
  } as unknown as Container;
  return { container, completeStructured, runBus };
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
    const { container, completeStructured, runBus } = makeContainer();
    completeStructured.mockRejectedValueOnce(new Error('No API key'));

    await new ConventionsService(container).runExtractJob({ workspaceId: WS, repoId: REPO_ID }, JOB_ID);

    expect(replaceAllSpy).toHaveBeenCalledOnce();
    const [, , rows] = replaceAllSpy.mock.calls[0]!;
    expect((rows as { source: string }[]).every((r) => r.source !== 'llm')).toBe(true);

    // Stream must close on the success exit path…
    expect(runBus.complete).toHaveBeenCalledWith(JOB_ID);
    // …and the swallowed LLM failure must be an `info`, never an `error` (a false
    // error would pop a client toast).
    const publishes = runBus.publish.mock.calls as [string, string, string, unknown?][];
    expect(publishes.some(([, kind]) => kind === 'error')).toBe(false);
    expect(
      publishes.some(([, kind, msg]) => kind === 'info' && msg.includes('keeping config rules')),
    ).toBe(true);
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
    const { container, runBus } = makeContainer();

    await new ConventionsService(container).runExtractJob({ workspaceId: WS, repoId: REPO_ID }, JOB_ID);

    expect(replaceAllSpy).toHaveBeenCalledOnce();
    const [ws, repoId, rows] = replaceAllSpy.mock.calls[0]! as [string, string, { extractedAt: unknown }[]];
    expect(ws).toBe(WS);
    expect(repoId).toBe(REPO_ID);
    expect(rows.every((r) => r.extractedAt instanceof Date)).toBe(true);

    // Stream closes exactly once for this job…
    expect(runBus.complete).toHaveBeenCalledOnce();
    expect(runBus.complete).toHaveBeenCalledWith(JOB_ID);
    // …and each pipeline stage + the final result published a progress message.
    const messages = (runBus.publish.mock.calls as [string, string, string, unknown?][]).map(
      ([, , msg]) => msg,
    );
    for (const fragment of ['Parsing config files', 'Reading source samples', 'Merging + persisting', 'Extracted']) {
      expect(messages.some((m) => m.includes(fragment))).toBe(true);
    }
  });

  it('early return when repo is not cloned still completes the stream', async () => {
    const { container, runBus } = makeContainer();
    // Repo exists in the workspace but was never cloned (no clonePath).
    (container.reposRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...FAKE_REPO,
      clonePath: undefined,
    });

    await new ConventionsService(container).runExtractJob({ workspaceId: WS, repoId: REPO_ID }, JOB_ID);

    // Nothing to scan → no snapshot…
    expect(replaceAllSpy).not.toHaveBeenCalled();
    // …but the stream must still close so the client EventSource doesn't hang.
    expect(runBus.complete).toHaveBeenCalledWith(JOB_ID);
    const publishes = runBus.publish.mock.calls as [string, string, string, unknown?][];
    expect(
      publishes.some(([, kind, msg]) => kind === 'info' && msg.includes('not cloned')),
    ).toBe(true);
  });

  it('persist failure rethrows but still completes the stream', async () => {
    const { container, runBus } = makeContainer();
    replaceAllSpy.mockRejectedValueOnce(new Error('db down'));

    const service = new ConventionsService(container);
    await expect(
      service.runExtractJob({ workspaceId: WS, repoId: REPO_ID }, JOB_ID),
    ).rejects.toThrow();

    // The `finally` must run on the throwing path too.
    expect(runBus.complete).toHaveBeenCalledWith(JOB_ID);
    // The failing persist step surfaces an `error` event before re-throwing.
    const publishes = runBus.publish.mock.calls as [string, string, string, unknown?][];
    expect(publishes.some(([, kind]) => kind === 'error')).toBe(true);
  });

  // ── F3: structural corroboration through the astGrep port ───────────────────

  it('structural corroboration raises confidence when the rule maps to matching symbols', async () => {
    // One sample file → occurrences = 1 → text-only confidence = 0.9 * SINGLE_OCCURRENCE_PENALTY
    // = 0.72 (above MIN_CONFIDENCE, below 1 — so the boost is observable, not clamped).
    const FILE = 'src/exports.ts';
    const CONTENT = 'export function foo() {}';
    setupReadFile({ [FILE]: CONTENT });

    // 'export' + 'functions' → exported-function predicate (see symbolPredicate).
    const candidate = {
      rule: 'Export functions from modules',
      category: 'structure',
      evidence_path: FILE,
      evidence_snippet: CONTENT,
      confidence: 0.9,
    } as ExtractedConvention;
    const llmResult = {
      data: { candidates: [candidate] },
      tokensIn: 0, tokensOut: 0, costUsd: null, raw: '{}',
    };

    // Baseline: default astGrep parses no symbols → predicate matches nothing → no boost.
    const baseline = makeContainer([FILE]);
    baseline.completeStructured.mockResolvedValue(llmResult);
    await new ConventionsService(baseline.container).runExtractJob(
      { workspaceId: WS, repoId: REPO_ID }, JOB_ID,
    );
    const [, , baseRows] = replaceAllSpy.mock.calls[0]! as [
      string, string, { rule: string; confidence: number }[],
    ];
    const baseRow = baseRows.find((r) => r.rule === candidate.rule)!;

    // Boosted: parseSymbols yields an exported function → predicate matches 1 symbol.
    replaceAllSpy.mockClear();
    const boosted = makeContainer([FILE], { parseSymbols: () => [sym('foo', 'function', true)] });
    boosted.completeStructured.mockResolvedValue(llmResult);
    await new ConventionsService(boosted.container).runExtractJob(
      { workspaceId: WS, repoId: REPO_ID }, JOB_ID,
    );
    const [, , boostRows] = replaceAllSpy.mock.calls[0]! as [
      string, string, { rule: string; confidence: number }[],
    ];
    const boostRow = boostRows.find((r) => r.rule === candidate.rule)!;

    // Sanity: the text-only baseline is the corroborated (single-occurrence-penalised) value.
    expect(baseRow.confidence).toBeCloseTo(adjustConfidence(0.9, 1)); // 0.72
    // The structural branch is observable and additive (and neither side is clamped at 1).
    expect(boostRow.confidence).toBeGreaterThan(baseRow.confidence);
    expect(boostRow.confidence).toBeCloseTo(baseRow.confidence + STRUCTURAL_BOOST); // 0.82
  });

  it('unsupported language falls back to text corroboration without error', async () => {
    // `.py` → langForFile returns null → the file is absent from the symbol index,
    // so buildSymbolIndex never calls parseSymbols for it and no structural boost applies —
    // even though the rule WOULD trigger the exported-function predicate and parseSymbols
    // WOULD return a matching symbol if it were ever consulted.
    const FILE = 'src/script.py';
    const CONTENT = 'def foo():\n    return 1';
    setupReadFile({ [FILE]: CONTENT });

    const candidate = {
      rule: 'Export functions from modules',
      category: 'structure',
      evidence_path: FILE,
      evidence_snippet: 'def foo():',
      confidence: 0.9,
    } as ExtractedConvention;

    const { container, completeStructured } = makeContainer([FILE], {
      langForFile: () => null, // unsupported for every file
      parseSymbols: () => [sym('foo', 'function', true)], // would match — but must never be called
    });
    completeStructured.mockResolvedValue({
      data: { candidates: [candidate] },
      tokensIn: 0, tokensOut: 0, costUsd: null, raw: '{}',
    });

    await new ConventionsService(container).runExtractJob(
      { workspaceId: WS, repoId: REPO_ID }, JOB_ID,
    );

    // Job completed and snapshotted; the candidate survived.
    expect(replaceAllSpy).toHaveBeenCalledOnce();
    const [, , rows] = replaceAllSpy.mock.calls[0]! as [
      string, string, { rule: string; confidence: number }[],
    ];
    const row = rows.find((r) => r.rule === candidate.rule);
    expect(row).toBeDefined();
    // Exactly the text-only corroborated value — NO +STRUCTURAL_BOOST.
    expect(row!.confidence).toBeCloseTo(adjustConfidence(0.9, 1)); // 0.72, not 0.82
  });
});
