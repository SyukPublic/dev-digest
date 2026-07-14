import { describe, it, expect } from 'vitest';
import { AgentManifest } from '@devdigest/shared';
import {
  buildManifest,
  buildSkillFiles,
  manifestPath,
  manifestToYaml,
  parseManifestYaml,
  skillPath,
  slugify,
} from '../src/modules/ci/serialize.js';

/**
 * Serializer unit tests (T10/T11) — manifest ⇄ YAML round-trip through the ONE
 * shared `AgentManifest` contract, zero-skill handling, and skill-file naming.
 */
describe('ci manifest serializer', () => {
  const base = {
    name: 'PR Guardian',
    provider: 'openrouter' as const,
    model: 'anthropic/claude-3.5-sonnet',
    system_prompt: 'You review pull requests.\nBe concise.\nCite lines.',
    strategy: 'auto' as const,
    ci_fail_on: 'critical' as const,
  };

  it('test_manifest_serialize: agent config → AgentManifest YAML with NO post_as', () => {
    const manifest = buildManifest({ ...base, skills: ['security-rubric'] });
    const yaml = manifestToYaml(manifest);

    expect(yaml).toContain('PR Guardian');
    expect(yaml).toContain('anthropic/claude-3.5-sonnet');
    expect(yaml).toContain('You review pull requests.');
    // post_as belongs to the workflow env, NEVER the manifest.
    expect(yaml).not.toMatch(/post_as/);
    // The manifest still validates against the shared schema.
    expect(AgentManifest.safeParse(parseManifestYaml(yaml)).success).toBe(true);
  });

  it('test_manifest_roundtrip: YAML round-trips AgentManifest exactly', () => {
    const manifest = buildManifest({ ...base, skills: ['a', 'b'] });
    const parsed = parseManifestYaml(manifestToYaml(manifest));
    expect(parsed).toEqual(manifest);
  });

  it('test_zero_skills: a 0-skill agent yields a valid manifest with skills: []', () => {
    const manifest = buildManifest({ ...base, skills: [] });
    expect(manifest.skills).toEqual([]);

    const parsed = parseManifestYaml(manifestToYaml(manifest));
    expect(parsed.skills).toEqual([]);
    expect(buildSkillFiles([])).toEqual([]);
  });

  it('rejects a manifest that does not round-trip the contract', () => {
    expect(() => parseManifestYaml('name: ""\nmodel: ""')).toThrow(/validation/i);
    expect(() => parseManifestYaml(':::not yaml')).toThrow(/YAML|validation/i);
  });
});

describe('ci skill-file serializer', () => {
  it('test_skill_files: one .devdigest/skills/<slug>.md per linked skill, matching slugs', () => {
    const files = buildSkillFiles([
      { name: 'Security Rubric', body: '# Security\nCheck secrets.' },
      { name: 'PR Quality', body: '# Quality\nBe kind.' },
    ]);

    expect(files.map((f) => f.slug)).toEqual(['security-rubric', 'pr-quality']);
    expect(skillPath(files[0]!.slug)).toBe('.devdigest/skills/security-rubric.md');
    expect(files[1]!.body).toContain('Be kind.');

    // The manifest's skill slugs match the generated filenames exactly (AC-45).
    const manifest = buildManifest({
      name: 'Agent',
      provider: 'openrouter',
      model: 'm',
      system_prompt: 'p',
      skills: files.map((f) => f.slug),
    });
    expect(manifest.skills).toEqual(['security-rubric', 'pr-quality']);
  });

  it('disambiguates colliding slugs so no two skills share a file', () => {
    const files = buildSkillFiles([
      { name: 'Rubric!', body: 'a' },
      { name: 'Rubric?', body: 'b' },
    ]);
    expect(files.map((f) => f.slug)).toEqual(['rubric', 'rubric-2']);
  });

  it('manifestPath uses the agent slug', () => {
    expect(manifestPath(slugify('PR Guardian'))).toBe('.devdigest/agents/pr-guardian.yaml');
  });
});
