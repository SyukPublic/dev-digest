import { z } from 'zod';
import { EvalCaseFile } from './eval-files.js';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: EvalCaseFile.array().nullable(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Memory (Studio CRUD + retrieval) ----
// Additive over the MemoryItem family above (unchanged). `Memory` is the
// display/persisted shape (MemoryItem + identity/lifecycle fields); the DTOs
// are the create/update boundary; the query drives list/filter/search. The
// derived 1536-dim embedding is server-owned and NEVER part of any client shape.

/** A memory entry as returned by the API (list/detail). */
export const Memory = z.object({
  id: z.string().uuid(),
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
  /** Non-null iff scope = `repo`; `global`/`team` carry null. */
  repo_id: z.string().uuid().nullable(),
  updated_at: z.string(),
  /** Null until the entry is first used in a review injection. */
  last_used_at: z.string().nullable(),
});
export type Memory = z.infer<typeof Memory>;

/** Create DTO — content required/non-empty, confidence 0..1, repo_id required
 *  iff scope = `repo` (else must be null/absent). No embedding (server-derived). */
export const CreateMemory = z
  .object({
    content: z.string().min(1),
    scope: MemoryScope,
    kind: MemoryKind,
    confidence: z.number().min(0).max(1),
    sources: z.array(MemorySource).default([]),
    repo_id: z.string().uuid().nullish(),
  })
  .refine((v) => (v.scope === 'repo' ? !!v.repo_id : !v.repo_id), {
    message: 'repo_id is required when scope is "repo" and must be null otherwise',
    path: ['repo_id'],
  });
export type CreateMemory = z.infer<typeof CreateMemory>;

/** Update DTO — every field optional (partial edit); the server destructures
 *  only known fields (no mass-assignment). When `scope` is supplied the same
 *  repo_id cross-field rule applies; changing `content` triggers re-embedding. */
export const UpdateMemory = z
  .object({
    content: z.string().min(1).optional(),
    scope: MemoryScope.optional(),
    kind: MemoryKind.optional(),
    confidence: z.number().min(0).max(1).optional(),
    sources: z.array(MemorySource).optional(),
    repo_id: z.string().uuid().nullish(),
  })
  .refine((v) => (v.scope === undefined ? true : v.scope === 'repo' ? !!v.repo_id : !v.repo_id), {
    message: 'repo_id is required when scope is "repo" and must be null otherwise',
    path: ['repo_id'],
  });
export type UpdateMemory = z.infer<typeof UpdateMemory>;

/** List/search query. Arrays accept a repeated param or a comma-separated
 *  string; `stale` filters to entries older than the stale threshold or never
 *  used; `q` is the semantic-search text; `repo_id` is the active repo used for
 *  repo-scope filtering. */
const csvArray = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return undefined;
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') return v.split(',').filter(Boolean);
    return v;
  }, z.array(inner).optional());

export const MemoryListQuery = z.object({
  scope: csvArray(MemoryScope),
  kind: csvArray(MemoryKind),
  stale: z.preprocess(
    (v) => (v === undefined ? undefined : v === 'true' || v === true),
    z.boolean().optional(),
  ),
  q: z.string().optional(),
  repo_id: z.string().uuid().optional(),
});
export type MemoryListQuery = z.infer<typeof MemoryListQuery>;

/** Per-facet counts for the rail, keyed by scope/kind value → count. */
export const MemoryFacets = z.object({
  scope: z.record(z.string(), z.number().int()),
  kind: z.record(z.string(), z.number().int()),
});
export type MemoryFacets = z.infer<typeof MemoryFacets>;

/** GET /memory envelope: the items, the rail facet counts, and the total. */
export const MemoryList = z.object({
  items: z.array(Memory),
  facets: MemoryFacets,
  total: z.number().int(),
});
export type MemoryList = z.infer<typeof MemoryList>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum(['manual', 'imported_url', 'extracted', 'community']);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
});
export type Skill = z.infer<typeof Skill>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions ----
// How a candidate was produced: 'config' = deterministic config-file rule
// (confidence 1.0, no LLM); 'llm' = model-extracted + snippet-verified on disk.
export const ConventionSource = z.enum(['llm', 'config']);
export type ConventionSource = z.infer<typeof ConventionSource>;

export const ConventionCandidate = z.object({
  id: z.string(),
  rule: z.string(),
  evidence_path: z.string(),
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
  accepted: z.boolean(),
  // Added by the Conventions Extractor (optional → back-compatible with the
  // empty-scaffold DTO). Free-form grouping bucket (naming / async / errors / …).
  category: z.string().nullish(),
  source: ConventionSource.default('llm'),
  // How many sample files corroborated the rule (≥2 boosts confidence).
  occurrences: z.number().int().nullish(),
  // ISO timestamp of the scan that produced this candidate.
  extracted_at: z.string().nullish(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

// ---- Agents ----
// 'openrouter' routes through the OpenAI-compatible API (OpenAIProvider with a
// custom baseURL) — used by the CI runner for cheap models (DeepSeek/GLM/MiniMax).
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a review should BLOCK (REQUEST_CHANGES + fail the check)
// vs just comment. Deterministic from finding severities, NOT the model's verdict:
//  - never:    never block, always comment (advisory only)
//  - critical: block iff >=1 CRITICAL finding (default)
//  - warning:  block iff >=1 WARNING or CRITICAL finding
//  - any:      block iff >=1 finding of any severity
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel
// plus the ordered skill ids linked at snapshot time. Used for reproducibility
// (eval replays a past version) and for surfacing an agent's edit history.
export const AgentVersionConfig = z.object({
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: ReviewStrategy,
  ci_fail_on: CiFailOn,
  repo_intel: z.boolean(),
  skills: z.array(z.string()),
});
export type AgentVersionConfig = z.infer<typeof AgentVersionConfig>;

export const AgentVersion = z.object({
  agent_id: z.string(),
  version: z.number().int(),
  config: AgentVersionConfig,
  created_at: z.string(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;
