import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { AgentManifest, type CiFile, type CiFailOn, type Provider, type ReviewStrategy } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { MANIFEST_DIR, SKILLS_DIR } from './constants.js';

/**
 * Manifest + skill-body serialization (T10, T11). The studio WRITES the manifest
 * shape the agent-runner READS, using the ONE shared `AgentManifest` Zod schema —
 * one contract, two consumers, so the on-disk format can never drift. Note there
 * is deliberately NO `post_as` in the manifest: it is a WORKFLOW env var
 * (`workflow.ts`), not part of the frozen agent contract.
 */

/** kebab-case a skill/agent name for a stable `<slug>.md` / `<slug>.yaml`. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'agent'
  );
}

/**
 * Mint a STABLE, per-agent-UNIQUE manifest filename slug (AC-62).
 *
 * Composition `slugify(name)-<agentId prefix>`: the agent-id prefix guarantees
 * two agents whose display names slugify to the SAME value still get DISTINCT
 * files (they can never overwrite each other on the shared `devdigest/ci`
 * branch), while the value is deterministic for a given `(agentId, name)`.
 *
 * Rename-stability is delivered by the caller, not by this pure function: the
 * slug is minted ONCE on first export and STORED on the `ci_installations` row
 * (`manifest_slug`), then reused verbatim on every re-export — so it stays the
 * same path even after the agent is renamed. This helper is also the
 * deterministic backfill for legacy rows whose `manifest_slug` is still null.
 */
export function stableManifestSlug(agentId: string, name: string): string {
  const prefix = agentId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase() || 'agent';
  return `${slugify(name)}-${prefix}`;
}

export interface ManifestSource {
  name: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  /** Resolved skill slugs (matching the `.devdigest/skills/<slug>.md` files). */
  skills: string[];
}

/**
 * Build a validated `AgentManifest` from an agent's config. Parsing through the
 * schema applies its defaults and guarantees the object round-trips (AC-3/AC-4).
 * A 0-skill agent yields a valid manifest with `skills: []` (AC-5).
 */
export function buildManifest(src: ManifestSource): AgentManifest {
  return AgentManifest.parse({
    name: src.name,
    provider: src.provider,
    model: src.model,
    system_prompt: src.system_prompt,
    skills: src.skills,
    ...(src.strategy !== undefined ? { strategy: src.strategy } : {}),
    ...(src.ci_fail_on !== undefined ? { ci_fail_on: src.ci_fail_on } : {}),
  });
}

/** Serialize a manifest to YAML (block scalars keep the system prompt readable). */
export function manifestToYaml(manifest: AgentManifest): string {
  return stringifyYaml(manifest, { lineWidth: 0 });
}

/**
 * Parse + validate a manifest YAML string back into an `AgentManifest` (AC-4/AC-6).
 * Used to confirm a generated OR user-edited manifest still round-trips the shared
 * contract BEFORE anything is committed. Bad YAML / bad shape → a clean 422.
 */
export function parseManifestYaml(yaml: string): AgentManifest {
  let parsed: unknown;
  try {
    parsed = parseYaml(yaml);
  } catch (err) {
    throw new ValidationError(`Agent manifest is not valid YAML: ${(err as Error).message}`);
  }
  const result = AgentManifest.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new ValidationError(`Agent manifest failed validation: ${issues}`);
  }
  return result.data;
}

/**
 * One `.devdigest/skills/<slug>.md` per linked skill (T11), in order. Slugs are
 * disambiguated on collision so two skills never map to the same file — the
 * returned slugs are what the manifest's `skills` array must reference (AC-45).
 */
export function buildSkillFiles(
  skills: { name: string; body: string }[],
): { slug: string; body: string }[] {
  const seen = new Map<string, number>();
  return skills.map((s) => {
    const base = slugify(s.name);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const slug = count === 0 ? base : `${base}-${count + 1}`;
    return { slug, body: s.body };
  });
}

/** The `.devdigest/agents/<slug>.yaml` path for an agent slug. */
export function manifestPath(slug: string): string {
  return `${MANIFEST_DIR}/${slug}.yaml`;
}

/** The `.devdigest/skills/<slug>.md` path for a skill slug. */
export function skillPath(slug: string): string {
  return `${SKILLS_DIR}/${slug}.md`;
}

/** Locate the single agent manifest among a bundle's files (edited-carry path). */
export function findManifestFile(files: CiFile[]): CiFile | undefined {
  return files.find(
    (f) => f.path.startsWith(`${MANIFEST_DIR}/`) && /\.ya?ml$/.test(f.path),
  );
}
