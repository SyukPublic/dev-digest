import { z } from 'zod';
import { SkillType, SkillSource } from './knowledge.js';

/**
 * Skills I/O contracts — DTOs that complement the `Skill` entity in
 * `./knowledge.js` (version history + the import preview step). Kept in a NEW
 * file so the stable `knowledge.ts` contract is not edited.
 */

/**
 * An immutable body snapshot recorded in `skill_versions`. A new version is
 * appended whenever a skill's body changes (editing name/type/enabled does not
 * version it), mirroring agent_versions for reproducibility + edit history.
 */
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  created_at: z.string(), // ISO 8601
});
export type SkillVersion = z.infer<typeof SkillVersion>;

/**
 * A parsed-but-UNSAVED skill returned by `POST /skills/import`. The import flow
 * is two-step: parse → preview → (user confirms) → `POST /skills`. The body is
 * stored/handled as untrusted DATA — executable parts of an archive are never
 * extracted or run; only the markdown core is read.
 */
export const SkillImportPreview = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  /** Where the body came from (archive entry name or the URL), for display. */
  origin: z.string().nullish(),
});
export type SkillImportPreview = z.infer<typeof SkillImportPreview>;
