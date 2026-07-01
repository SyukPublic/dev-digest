/**
 * Pure mappers: API DTO → concise, high-signal tool output. No I/O.
 *
 * Tool responses are trimmed to the fields an MCP client actually needs to act,
 * keeping the payload small and the model's job easy.
 */
import type {
  Agent,
  BlastResponse,
  ConventionCandidate,
  FindingRecord,
  ReviewRecord,
  Verdict,
} from '@devdigest/shared';

/** A compact view of a review agent — just what's needed to pick and run one. */
export interface AgentSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly model: string;
  readonly enabled: boolean;
}

/** Maps the full `Agent` contract down to the high-signal fields. */
export function toAgentSummary(agent: Agent): AgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    model: agent.model,
    enabled: agent.enabled,
  };
}

export function toAgentSummaries(agents: readonly Agent[]): AgentSummary[] {
  return agents.map(toAgentSummary);
}

// ---- Reviews → {verdict, findings[]} ----

/**
 * A compact view of one finding. Snake_case `start_line`/`end_line` mirror the
 * `Finding` contract EXACTLY — the source of truth uses snake_case, so camelCase
 * here would silently emit `undefined`.
 */
export interface FindingSummary {
  readonly file: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly severity: string;
  readonly category: string;
  readonly title: string;
  readonly suggestion?: string;
  readonly confidence: number;
}

/** Maps a persisted finding down to the high-signal fields. */
export function toFindingSummary(f: FindingRecord): FindingSummary {
  return {
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    severity: f.severity,
    category: f.category,
    title: f.title,
    ...(f.suggestion != null ? { suggestion: f.suggestion } : {}),
    confidence: f.confidence,
  };
}

/** The concise review payload returned by the findings / run tools. */
export interface ReviewSummary {
  /** Null when the review had no verdict (e.g. a summary-kind row). */
  readonly verdict: Verdict | null;
  readonly findings: FindingSummary[];
}

/** Maps one persisted review run to `{verdict, findings[]}`. */
export function toReviewSummary(review: ReviewRecord): ReviewSummary {
  return {
    verdict: review.verdict,
    findings: review.findings.map(toFindingSummary),
  };
}

/**
 * Picks the latest review run (most recent `created_at`) from a PR's reviews and
 * maps it to `{verdict, findings[]}`. Returns null when there are no reviews yet.
 */
export function latestReviewSummary(reviews: readonly ReviewRecord[]): ReviewSummary | null {
  const latest = pickLatest(reviews);
  return latest ? toReviewSummary(latest) : null;
}

/** Most-recent review by `created_at` (lexicographic ISO compare). */
export function pickLatest(reviews: readonly ReviewRecord[]): ReviewRecord | undefined {
  return reviews.reduce<ReviewRecord | undefined>((latest, r) => {
    if (!latest) return r;
    return r.created_at > latest.created_at ? r : latest;
  }, undefined);
}

/** Blocking order: request_changes > comment > approve. Higher = more blocking. */
const VERDICT_RANK: Record<Verdict, number> = {
  request_changes: 2,
  comment: 1,
  approve: 0,
};

/**
 * Aggregates several review runs into one `{verdict, findings[]}`: findings are
 * the union across runs, and the verdict is the MOST-BLOCKING among them. Used
 * for `agent === 'all'`. Null verdicts are ignored when ranking; the result
 * verdict is null only when every run lacked a verdict.
 */
export function aggregateReviews(reviews: readonly ReviewRecord[]): ReviewSummary {
  let verdict: Verdict | null = null;
  const findings: FindingSummary[] = [];
  for (const r of reviews) {
    if (r.verdict != null && (verdict === null || VERDICT_RANK[r.verdict] > VERDICT_RANK[verdict])) {
      verdict = r.verdict;
    }
    for (const f of r.findings) findings.push(toFindingSummary(f));
  }
  return { verdict, findings };
}

// ---- Conventions ----

/** A compact convention rule with its provenance. */
export interface ConventionSummary {
  readonly rule: string;
  readonly category?: string;
  readonly evidence_path: string;
  readonly confidence: number;
}

export function toConventionSummary(c: ConventionCandidate): ConventionSummary {
  return {
    rule: c.rule,
    ...(c.category != null ? { category: c.category } : {}),
    evidence_path: c.evidence_path,
    confidence: c.confidence,
  };
}

export function toConventionSummaries(
  conventions: readonly ConventionCandidate[],
): ConventionSummary[] {
  return conventions.map(toConventionSummary);
}

// ---- Blast radius ----

/** The blast impact map plus its index status, trimmed for the tool. */
export interface BlastSummary {
  readonly status: BlastResponse['status'];
  readonly degraded_reason?: string;
  readonly summary: string;
  readonly changed_symbols: BlastResponse['blast']['changed_symbols'];
  readonly downstream: BlastResponse['blast']['downstream'];
  /** Forward-leading hint, present only when the index is degraded/failed. */
  readonly hint?: string;
}

/**
 * Maps the blast response to the tool output. When the index is degraded/failed
 * the map is empty and we attach a resync hint naming the repo.
 */
export function toBlastSummary(res: BlastResponse, ownerName: string): BlastSummary {
  const degraded = res.status === 'degraded' || res.status === 'failed';
  return {
    status: res.status,
    ...(res.degraded_reason != null ? { degraded_reason: res.degraded_reason } : {}),
    summary: res.blast.summary,
    changed_symbols: res.blast.changed_symbols,
    downstream: res.blast.downstream,
    ...(degraded
      ? {
          hint: `Blast radius is empty because ${ownerName} isn't indexed yet — trigger a resync (POST /repos/:id/resync).`,
        }
      : {}),
  };
}
