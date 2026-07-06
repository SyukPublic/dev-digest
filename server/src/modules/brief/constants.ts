/**
 * brief module constants — the fixed knobs for the Why+Risk Brief producer.
 *
 * The content language handed to the system prompt (rendered via
 * `renderPrompt('why-risk-brief.system.md', { language })`). DevDigest is
 * English-only by decision (see root `AGENTS.md` — Conventions): all
 * LLM-generated content is English; there is no per-locale override
 * (mirrors onboarding-generator's `DEFAULT_CONTENT_LANGUAGE`).
 */
export const DEFAULT_CONTENT_LANGUAGE = 'English';

/**
 * The feature-model registry id resolved for the single brief LLM call (CP-3).
 * The Phase 1 contracts registered `'why_risk_brief'` in `FEATURE_MODELS`.
 */
export const BRIEF_FEATURE_MODEL_ID = 'why_risk_brief' as const;
