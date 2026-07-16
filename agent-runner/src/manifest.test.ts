import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findManifestPaths, loadAgentManifest, manifestSlugFromPath } from './manifest.js';
import { RunnerError } from './errors.js';

const VALID_MANIFEST_YAML = `
name: "Security Reviewer"
provider: "openrouter"
model: "deepseek/deepseek-v4-flash"
system_prompt: "Review this PR for security issues."
skills: ["security-basics"]
strategy: "auto"
ci_fail_on: "critical"
`;

function loadFirst(dir: string) {
  const [p] = findManifestPaths(dir);
  return loadAgentManifest(p!);
}

describe('manifest loading + validation (AC-20)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'devdigest-runner-manifest-'));
    mkdirSync(path.join(dir, 'agents'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads and validates a well-formed manifest against the AgentManifest schema', () => {
    writeFileSync(path.join(dir, 'agents', 'security-reviewer.yaml'), VALID_MANIFEST_YAML);

    const manifest = loadFirst(dir);

    expect(manifest.name).toBe('Security Reviewer');
    expect(manifest.model).toBe('deepseek/deepseek-v4-flash');
    expect(manifest.skills).toEqual(['security-basics']);
    expect(manifest.ci_fail_on).toBe('critical');
  });

  it('fails clearly when the manifest fails schema validation (bad ci_fail_on)', () => {
    writeFileSync(
      path.join(dir, 'agents', 'bad.yaml'),
      `
name: "Bad Agent"
model: "gpt-4.1"
system_prompt: "review"
ci_fail_on: "sometimes"
`,
    );

    expect(() => loadFirst(dir)).toThrow(RunnerError);
    expect(() => loadFirst(dir)).toThrow(/failed validation/i);
  });

  it('fails clearly when the manifest is missing required fields', () => {
    writeFileSync(path.join(dir, 'agents', 'incomplete.yaml'), 'name: "No model or prompt"\n');
    expect(() => loadFirst(dir)).toThrow(RunnerError);
  });

  it('fails clearly when no manifest file exists', () => {
    rmSync(path.join(dir, 'agents'), { recursive: true, force: true });
    expect(() => findManifestPaths(dir)).toThrow(/not found/i);
  });

  it('fails clearly on malformed YAML', () => {
    writeFileSync(path.join(dir, 'agents', 'broken.yaml'), 'name: "unterminated\n  bad: [1, 2\n');
    const manifestPath = path.join(dir, 'agents', 'broken.yaml');
    expect(() => loadAgentManifest(manifestPath)).toThrow(RunnerError);
  });
});

describe('findManifestPaths — multi-agent (test_find_all_manifests, AC-59)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'devdigest-runner-manifests-'));
    mkdirSync(path.join(dir, 'agents'), { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns EVERY *.yaml/*.yml manifest with NO hard-fail on more than one', () => {
    writeFileSync(path.join(dir, 'agents', 'security-reviewer-aaaa1111.yaml'), VALID_MANIFEST_YAML);
    writeFileSync(path.join(dir, 'agents', 'perf-reviewer-bbbb2222.yml'), VALID_MANIFEST_YAML);

    const paths = findManifestPaths(dir);
    expect(paths).toHaveLength(2);
    // Deterministic (sorted) order.
    expect(paths.map((p) => path.basename(p))).toEqual([
      'perf-reviewer-bbbb2222.yml',
      'security-reviewer-aaaa1111.yaml',
    ]);
  });

  it('still resolves a single manifest (single-agent repos unchanged)', () => {
    writeFileSync(path.join(dir, 'agents', 'only.yaml'), VALID_MANIFEST_YAML);
    expect(findManifestPaths(dir)).toHaveLength(1);
  });

  it('throws a clear RunnerError on an empty agents/ directory', () => {
    expect(() => findManifestPaths(dir)).toThrow(RunnerError);
    expect(() => findManifestPaths(dir)).toThrow(/No agent manifest/i);
  });
});

describe('manifestSlugFromPath — artifact identity (AC-64)', () => {
  it('strips the directory and the .yaml/.yml extension', () => {
    expect(manifestSlugFromPath('/x/.devdigest/agents/security-reviewer-1a2b3c4d.yaml')).toBe(
      'security-reviewer-1a2b3c4d',
    );
    expect(manifestSlugFromPath('agents/perf-def.yml')).toBe('perf-def');
  });
});
