import { describe, it, expect } from 'vitest';
import { generateWorkflow } from '../src/modules/ci/workflow.js';

/**
 * Workflow generator unit tests (T13) — the security-critical properties of the
 * generated GitHub Actions YAML (AC-12..AC-17).
 */
describe('ci workflow generator', () => {
  const wf = generateWorkflow({
    triggers: ['opened', 'synchronize', 'reopened'],
    postAs: 'github_review',
  });

  it('test_workflow_runner_cmd: runs the committed runner, NO marketplace action', () => {
    expect(wf).toContain('run: node .devdigest/runner/index.js');
    // Every `uses:` is a first-party actions/* action — no third-party action
    // executes the review (AC-12).
    const uses = [...wf.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u.startsWith('actions/')).toBe(true);
  });

  it('test_workflow_trigger: on pull_request with the chosen types (AC-13)', () => {
    expect(wf).toMatch(/on:\s*\n\s*pull_request:/);
    expect(wf).toContain('- opened');
    expect(wf).toContain('- synchronize');
    expect(wf).toContain('- reopened');
  });

  it('test_workflow_permissions: least privilege only (AC-14)', () => {
    expect(wf).toContain('permissions:');
    expect(wf).toContain('contents: read');
    expect(wf).toContain('pull-requests: write');
    expect(wf).not.toContain('write-all');
    expect(wf).not.toMatch(/contents:\s*write/);
  });

  it('test_workflow_secret: references the secret, never inlines a key (AC-15)', () => {
    expect(wf).toContain('${{ secrets.OPENROUTER_API_KEY }}');
    // No inlined provider key shapes.
    expect(wf).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(wf).not.toMatch(/sk-or-/);
  });

  it('test_workflow_postas: passes DEVDIGEST_POST_AS via env (AC-16)', () => {
    expect(wf).toContain('DEVDIGEST_POST_AS: github_review');
    expect(generateWorkflow({ triggers: ['opened'], postAs: 'pr_comment' })).toContain(
      'DEVDIGEST_POST_AS: pr_comment',
    );
  });

  it('test_workflow_fork: never uses pull_request_target (AC-17)', () => {
    expect(wf).not.toContain('pull_request_target');
  });

  it('sanitizes injection-shaped triggers (defense-in-depth)', () => {
    const evil = generateWorkflow({
      triggers: ['opened', 'x\n      - pull_request_target'],
      postAs: 'none',
    });
    expect(evil).not.toContain('pull_request_target');
    expect(evil).toContain('- opened');
  });

  it('falls back to safe default triggers when none are valid', () => {
    const wf2 = generateWorkflow({ triggers: ['@@@'], postAs: 'none' });
    expect(wf2).toContain('- opened');
    expect(wf2).toContain('- synchronize');
    expect(wf2).toContain('- reopened');
  });

  it('test_workflow_multi_agent: uploads ALL per-agent result files while keeping every security property for N agents (AC-58/AC-69/AC-77/AC-78)', () => {
    // The single generated workflow drives the multi-agent run (one job, one
    // runner invocation, one aggregate status check) — the upload step must glob
    // every per-agent result file, not just a single fixed filename.
    expect(wf).toContain('devdigest-result*.json');
    expect(wf).not.toMatch(/path:\s*devdigest-result\.json\s*$/m);
    // One job / one runner invocation (aggregate check across agents — decision a/#3).
    expect([...wf.matchAll(/run: node \.devdigest\/runner\/index\.js/g)]).toHaveLength(1);
    // Fork-safety preserved for the multi-agent run (never the privileged variant).
    expect(wf).toMatch(/on:\s*\n\s*pull_request:/);
    expect(wf).not.toContain('pull_request_target');
    // Least privilege preserved — enough to read the diff and post reviews for all N.
    expect(wf).toContain('contents: read');
    expect(wf).toContain('pull-requests: write');
    expect(wf).not.toContain('write-all');
    // The OpenRouter key stays referenced, never inlined, regardless of N.
    expect(wf).toContain('${{ secrets.OPENROUTER_API_KEY }}');
    expect(wf).not.toMatch(/sk-or-/);
  });
});
