import { describe, it, expect } from 'vitest';
import { assembleBundle, readRunnerBundle } from '../src/modules/ci/bundle.js';

/**
 * Bundle assembler unit tests (T12) — the produced file set (AC-2) and the
 * clear error when the runner bundle is missing (AC-44), which must commit
 * NOTHING (assembleBundle throws before any file is produced).
 */
describe('ci bundle assembler', () => {
  const input = {
    agentSlug: 'pr-guardian',
    manifestYaml: 'name: PR Guardian\n',
    skillFiles: [
      { slug: 'security-rubric', body: '# Security' },
      { slug: 'pr-quality', body: '# Quality' },
    ],
    workflowYaml: 'name: DevDigest Review\n',
  };

  it('test_bundle_six_files: manifest + N skills + memory + runner + workflow', () => {
    const files = assembleBundle(input, () => 'RUNNER_BUNDLE_JS');
    const paths = files.map((f) => f.path);

    // 2 skills → 6 files.
    expect(files).toHaveLength(6);
    expect(paths).toEqual([
      '.devdigest/agents/pr-guardian.yaml',
      '.devdigest/skills/security-rubric.md',
      '.devdigest/skills/pr-quality.md',
      '.devdigest/memory.jsonl',
      '.devdigest/runner/index.js',
      '.github/workflows/devdigest-review.yml',
    ]);

    const memory = files.find((f) => f.path === '.devdigest/memory.jsonl')!;
    expect(memory.contents).toBe('');
    expect(memory.editable).toBe(false);

    const runner = files.find((f) => f.path === '.devdigest/runner/index.js')!;
    expect(runner.contents).toBe('RUNNER_BUNDLE_JS');
    expect(runner.editable).toBe(false);
  });

  it('test_missing_bundle: a missing runner bundle throws a clear, actionable error', () => {
    expect(() => readRunnerBundle('/no/such/devdigest-runner.js')).toThrow(
      /runner bundle not found[\s\S]*agent-runner/i,
    );

    // assembleBundle surfaces the same error and produces NO files (commit nothing).
    expect(() =>
      assembleBundle(input, () => readRunnerBundle('/no/such/devdigest-runner.js')),
    ).toThrow(/runner bundle not found/i);
  });
});
