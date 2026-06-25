import type { ConventionCandidate, ConventionSource, ExtractedConvention } from '@devdigest/shared';
import type { ConventionRow } from '../../db/rows.js';
import type { AstGrep, ParsedSymbol } from '../../adapters/astgrep/index.js';
import {
  CORROBORATION_BOOST,
  CORROBORATION_THRESHOLD,
  SINGLE_OCCURRENCE_PENALTY,
  STRUCTURAL_BOOST,
} from './constants.js';

/**
 * Pure helpers for the Conventions Extractor — DB row ⇄ DTO mapping plus the
 * verify / corroborate / dedup logic. No I/O: the service reads files and passes
 * their contents in, so every function here is unit-testable without a clone.
 */

/** An in-flight candidate before it gets workspace/repo/timestamps in the service. */
export interface ConventionDraft {
  rule: string;
  category: string;
  evidencePath: string;
  evidenceSnippet: string;
  confidence: number;
  source: ConventionSource;
  /** Corroborating sample files; null for config-derived rules. */
  occurrences: number | null;
}

/** Map a persisted row to the public DTO (filling the empty-scaffold nullables). */
export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_snippet: row.evidenceSnippet ?? '',
    confidence: row.confidence ?? 0,
    accepted: row.accepted,
    category: row.category ?? null,
    source: (row.source as ConventionSource) ?? 'llm',
    occurrences: row.occurrences ?? null,
    extracted_at: row.extractedAt ? row.extractedAt.toISOString() : null,
  };
}

/** Normalized key for dedup: lowercase, alphanumeric-only, collapsed spaces. */
export function normalizeRule(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Normalized-rule keys of rows the curator accepted — for carrying accept across a re-scan. */
export function acceptedRuleKeys(rows: { rule: string; accepted: boolean }[]): Set<string> {
  const keys = new Set<string>();
  for (const r of rows) if (r.accepted) {
    const k = normalizeRule(r.rule);
    if (k.length > 0) keys.add(k);
  }
  return keys;
}

/** First non-empty, trimmed line of an evidence snippet (the anchor we verify). */
export function firstSnippetLine(snippet: string): string {
  for (const raw of snippet.split('\n')) {
    const line = raw.trim();
    if (line.length > 0) return line;
  }
  return '';
}

/**
 * Verify an LLM candidate against the sample contents we actually read: the file
 * it cites must be among the samples AND the snippet's first line must literally
 * appear in it. Drops hallucinated file:line references. Returns the draft (with
 * occurrences counted) or null if it fails verification.
 */
export function verifyAndCorroborate(
  candidate: ExtractedConvention,
  contents: Map<string, string>,
  parsedIndex?: Map<string, ParsedSymbol[]>,
): ConventionDraft | null {
  const cited = contents.get(candidate.evidence_path);
  if (!cited) return null;

  const anchor = firstSnippetLine(candidate.evidence_snippet);
  if (anchor.length === 0 || !cited.includes(anchor)) return null;

  // Corroboration: how many sample files contain the same anchor line.
  let occurrences = 0;
  for (const body of contents.values()) {
    if (body.includes(anchor)) occurrences += 1;
  }

  let confidence = adjustConfidence(candidate.confidence, occurrences);
  // F3: layer a structural boost on top when the rule maps to an AST predicate
  // that actually matches symbols in the parsed samples. `null` = no structural
  // sense for this rule → leave the text-based confidence untouched.
  if (parsedIndex) {
    const structural = structuralOccurrences(candidate.rule, parsedIndex);
    if (structural !== null && structural > 0) {
      confidence = Math.min(1, confidence + STRUCTURAL_BOOST);
    }
  }
  return {
    rule: candidate.rule.trim(),
    category: candidate.category.trim() || 'general',
    evidencePath: candidate.evidence_path,
    evidenceSnippet: candidate.evidence_snippet,
    confidence,
    source: 'llm',
    occurrences,
  };
}

/** Boost rules seen in ≥threshold files; penalize single-occurrence rules. */
export function adjustConfidence(base: number, occurrences: number): number {
  const adjusted =
    occurrences >= CORROBORATION_THRESHOLD
      ? base + CORROBORATION_BOOST
      : base * SINGLE_OCCURRENCE_PENALTY;
  return Math.max(0, Math.min(1, adjusted));
}

/**
 * F3 — parse each sample file ONCE into its symbols (parse-once, not per
 * candidate). Best-effort: files of an unsupported language (`langForFile` →
 * null) or that throw on parse are simply skipped, never fatal. The `astGrep`
 * port is passed in so this stays pure/unit-testable with a fake.
 */
export function buildSymbolIndex(
  astGrep: AstGrep,
  contents: Map<string, string>,
): Map<string, ParsedSymbol[]> {
  const index = new Map<string, ParsedSymbol[]>();
  for (const [path, source] of contents) {
    try {
      if (astGrep.langForFile(path) === null) continue;
      index.set(path, astGrep.parseSymbols(path, source));
    } catch {
      // best-effort: a single unparseable file must not break the index
    }
  }
  return index;
}

/**
 * F3 — keyword→AST-predicate heuristic. Returns the count of symbols across all
 * indexed files that satisfy the rule's structural predicate, or `null` when no
 * keyword fires (no structural sense → caller falls back to text corroboration).
 */
export function structuralOccurrences(
  rule: string,
  parsedIndex: Map<string, ParsedSymbol[]>,
): number | null {
  const predicate = symbolPredicate(rule);
  if (!predicate) return null;
  let count = 0;
  for (const symbols of parsedIndex.values()) {
    for (const s of symbols) if (predicate(s)) count += 1;
  }
  return count;
}

/** Pick a `ParsedSymbol` predicate from the rule's keywords; null if none apply. */
function symbolPredicate(rule: string): ((s: ParsedSymbol) => boolean) | null {
  const tokens = new Set(normalizeRule(rule).split(' '));
  const has = (...words: string[]) => words.some((w) => tokens.has(w));

  if (has('function', 'functions', 'fn')) {
    const exported = has('export', 'exported', 'exports');
    return (s) => s.kind === 'function' && (!exported || s.exported);
  }
  if (has('interface', 'interfaces', 'type', 'types', 'alias', 'aliases')) {
    return (s) => s.kind === 'interface' || s.kind === 'type';
  }
  if (has('class', 'classes')) return (s) => s.kind === 'class';
  if (has('method', 'methods')) return (s) => s.kind === 'method';
  return null;
}

/**
 * Merge config-derived + verified LLM drafts, dropping duplicates by normalized
 * rule. Config rules are deterministic ground truth, so they WIN over an LLM
 * candidate that restates the same rule. Within a source, the higher confidence
 * wins. Output is sorted by category then confidence (desc) for stable display.
 */
export function dedupeDrafts(
  config: ConventionDraft[],
  llm: ConventionDraft[],
): ConventionDraft[] {
  const byKey = new Map<string, ConventionDraft>();
  // Config first so it claims the key; LLM only fills gaps.
  for (const d of [...config, ...llm]) {
    const key = normalizeRule(d.rule);
    if (key.length === 0) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, d);
      continue;
    }
    // Config always beats LLM; otherwise keep the higher-confidence one.
    if (existing.source === 'config') continue;
    if (d.source === 'config' || d.confidence > existing.confidence) byKey.set(key, d);
  }
  return [...byKey.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || b.confidence - a.confidence,
  );
}

/**
 * F4 — semantic dedup on top of string `dedupeDrafts`: merge near-paraphrases
 * ("Use single quotes" vs "Prefer single-quoted strings") that survive the
 * normalized-key pass. `vectors[i]` is the embedding of `drafts[i].rule`.
 *
 * Pairs with cosine > threshold are clustered (union-find, O(n²) — n is dozens).
 * Per cluster the winner is: a `config` draft (deterministic ground truth, same
 * rule as `dedupeDrafts`), else the highest-confidence draft. Pure: takes ready
 * vectors, so it's testable without the embedder. Output sorted as dedupeDrafts.
 */
export function semanticDedup(
  drafts: ConventionDraft[],
  vectors: number[][],
  threshold: number,
): ConventionDraft[] {
  if (drafts.length <= 1 || vectors.length !== drafts.length) return drafts;

  const parent = drafts.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  for (let i = 0; i < drafts.length; i++) {
    for (let j = i + 1; j < drafts.length; j++) {
      if (cosine(vectors[i]!, vectors[j]!) > threshold) parent[find(i)] = find(j);
    }
  }

  const clusters = new Map<number, ConventionDraft[]>();
  for (let i = 0; i < drafts.length; i++) {
    const root = find(i);
    const bucket = clusters.get(root) ?? clusters.set(root, []).get(root)!;
    bucket.push(drafts[i]!);
  }

  const winners = [...clusters.values()].map((cluster) => cluster.reduce(clusterWinner));
  return winners.sort(
    (a, b) => a.category.localeCompare(b.category) || b.confidence - a.confidence,
  );
}

/** Config beats LLM (as in dedupeDrafts); otherwise higher confidence wins. */
function clusterWinner(a: ConventionDraft, b: ConventionDraft): ConventionDraft {
  if (a.source === 'config' && b.source !== 'config') return a;
  if (b.source === 'config' && a.source !== 'config') return b;
  return a.confidence >= b.confidence ? a : b;
}

/** Cosine similarity; 0 for a zero vector (degrades safely, never NaN). */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
