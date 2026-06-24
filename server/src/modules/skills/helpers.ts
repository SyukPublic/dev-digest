import type { Skill, SkillSource, SkillType, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping, the
 * body-version-bump rule, and markdown-core parsing for imports. No I/O.
 */

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

/** Map a persisted `skill_versions` row to the public `SkillVersion` DTO. */
export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * True when a patch changes the skill BODY (the only field that versions a
 * skill). Editing name/description/type or toggling enabled does NOT bump the
 * version — mirrors the agents' "config change" rule, narrowed to body.
 */
export function isBodyChange(existing: Pick<SkillRow, 'body'>, patch: { body?: string }): boolean {
  return patch.body !== undefined && patch.body !== existing.body;
}

/** Whether a skill body is treated as trusted instructions (vs untrusted data)
 *  in the assembled prompt. Manual/extracted skills are the workspace's own;
 *  imported (file/URL/community) skills are someone else's instructions → data. */
export function isTrustedSource(source: SkillSource): boolean {
  return source === 'manual' || source === 'extracted';
}

const HEADING_RE = /^#{1,6}\s+(.+?)\s*#*\s*$/m;

/** Slugify a heading into a kebab-case skill name (e.g. "PR Quality Rubric" →
 *  "pr-quality-rubric"). */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Derive a skill name from the first markdown heading; falls back to `fallback`
 * when the body has no heading (i18n: "derived from the first heading if blank").
 */
export function deriveSkillName(body: string, fallback = 'imported-skill'): string {
  const m = body.match(HEADING_RE);
  const slug = m ? slugify(m[1]!) : '';
  return slug || fallback;
}

/** Derive a one-line description: the first non-heading, non-empty line. */
export function deriveSkillDescription(body: string): string {
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    return line.slice(0, 200);
  }
  return '';
}
