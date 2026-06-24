import type { ConventionCandidate, ConventionSource, ExtractedConvention } from '@devdigest/shared';
import type { ConventionRow } from '../../db/rows.js';
import {
  CORROBORATION_BOOST,
  CORROBORATION_THRESHOLD,
  SINGLE_OCCURRENCE_PENALTY,
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

  const confidence = adjustConfidence(candidate.confidence, occurrences);
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
