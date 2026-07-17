import { z } from 'zod';
import { CategoryCount } from './observability.js';

/**
 * L08 — Per-skill Stats (GET /skills/:id/stats).
 *
 * NEW contract file (the barrel re-exports it; nothing here edits an existing
 * shape — per the "extend @devdigest/shared with new files" rule). Backs the
 * Skill Editor → Stats tab: usage + value of one skill over a period.
 *
 * `used_by_agents` is a CONFIG-level count (agents currently linked), NOT
 * period-scoped; `pull_frequency` / `accept_rate` / `findings_total` /
 * `findings_by_category` are period-scoped over the subset of the period's runs
 * (by linked agents) WHOSE TRACE PULLED this skill (AC-31).
 */

/** One linked agent in the "Agents using this skill" list (AC-32). */
export const SkillAgentRef = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
});
export type SkillAgentRef = z.infer<typeof SkillAgentRef>;

export const SkillStats = z.object({
  skill_id: z.string(),
  skill_name: z.string(),
  /** count of agents currently linked to the skill (config-level, NOT period-scoped) (AC-30). */
  used_by_agents: z.number().int(),
  /** share (0..1) of period runs by linked agents whose trace pulled this skill; null when denominator=0 (AC-31). */
  pull_frequency: z.number().nullable(),
  /** accept-rate of findings from those runs; null when no acted findings (AC-8, AC-31). */
  accept_rate: z.number().nullable(),
  /** findings in the period from those runs. */
  findings_total: z.number().int(),
  /** "Agents using this skill" list (AC-32). */
  agents: z.array(SkillAgentRef),
  /** donut by count/share (AC-33). */
  findings_by_category: z.array(CategoryCount),
});
export type SkillStats = z.infer<typeof SkillStats>;
