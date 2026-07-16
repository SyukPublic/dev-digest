/**
 * Phase 1 (L07 Export-to-CI) — shared CI contracts.
 *
 * Covers:
 *  - test_ci_run_summary_contract: `CiRunSummary` = `RunSummary` + the four CI
 *    columns; `CiExportRequest` = `CiExportInput` + optional `files`, defaults
 *    preserved, frozen bases untouched.
 *  - test_no_ci_runs_refs (AC-41 / T3): the new contract file reads CI runs from
 *    `agent_runs` and never re-introduces the retired `ciRuns` table / `CiRun`
 *    schema (the `ci_runs` course table stays physically present but unused).
 *    Also scans the whole new `modules/ci/**` producer/ingest module (not just
 *    the Phase-1 contract/schema files) — the original test was scoped only to
 *    Phase 1, leaving Phase 2's new module unchecked.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  CiRunSummary,
  CiExportRequest,
  CiExportInput,
  AgentManifest,
  RunSummary,
} from '@devdigest/shared';

describe('CiRunSummary contract (test_ci_run_summary_contract)', () => {
  const base = {
    run_id: 'r1',
    agent_id: 'a1',
    agent_name: 'Security Reviewer',
    provider: 'openrouter',
    model: 'gpt-4.1',
    status: 'succeeded',
    error: null,
    duration_ms: 4200,
    tokens_in: 1000,
    tokens_out: 500,
    cost_usd: 0.012,
    findings_count: 3,
    grounding: 'grounded',
    ran_at: '2026-07-14T00:00:00.000Z',
    score: 88,
    blockers: 1,
    suggestions: 1,
  };

  it('extends RunSummary with the four CI columns', () => {
    const parsed = CiRunSummary.parse({
      ...base,
      source: 'ci',
      repo: 'acme/payments-api',
      pr_number: 123,
      github_url: 'https://github.com/acme/payments-api/actions/runs/42',
      ci_installation_id: 'inst-1',
    });
    expect(parsed.source).toBe('ci');
    expect(parsed.repo).toBe('acme/payments-api');
    expect(parsed.pr_number).toBe(123);
    expect(parsed.github_url).toContain('/actions/runs/42');
    expect(parsed.ci_installation_id).toBe('inst-1');
    // still carries every RunSummary field
    expect(parsed.run_id).toBe('r1');
    expect(parsed.cost_usd).toBe(0.012);
  });

  it('keeps the CI columns nullable (local-run compatibility)', () => {
    const parsed = CiRunSummary.parse({
      ...base,
      source: null,
      repo: null,
      pr_number: null,
      github_url: null,
      ci_installation_id: null,
    });
    expect(parsed.repo).toBeNull();
    expect(parsed.pr_number).toBeNull();
  });

  it('is a strict superset of RunSummary (base keys all present)', () => {
    const baseKeys = Object.keys(RunSummary.shape);
    const ciKeys = Object.keys(CiRunSummary.shape);
    for (const k of baseKeys) expect(ciKeys).toContain(k);
    for (const extra of ['suggestions', 'source', 'repo', 'pr_number', 'github_url', 'ci_installation_id']) {
      expect(ciKeys).toContain(extra);
    }
  });
});

describe('CiExportRequest contract (AC-6 carry)', () => {
  it('extends CiExportInput with optional files and preserves defaults', () => {
    const parsed = CiExportRequest.parse({ repo: 'acme/api' });
    // CiExportInput defaults survive the extend
    expect(parsed.target).toBe('gha');
    expect(parsed.action).toBe('open_pr');
    expect(parsed.post_as).toBe('github_review');
    expect(parsed.base).toBe('main');
    expect(parsed.triggers).toEqual(['opened', 'synchronize', 'reopened']);
    // files is optional
    expect(parsed.files == null).toBe(true);
  });

  it('carries edited files verbatim when provided', () => {
    const parsed = CiExportRequest.parse({
      repo: 'acme/api',
      files: [{ path: '.github/workflows/devdigest-review.yml', contents: 'on: pull_request' }],
    });
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files![0]!.path).toBe('.github/workflows/devdigest-review.yml');
    // CiFile.editable defaults to true
    expect(parsed.files![0]!.editable).toBe(true);
  });

  it('does NOT mutate the frozen CiExportInput (no files key on the base)', () => {
    expect('files' in CiExportInput.shape).toBe(false);
  });

  it('leaves AgentManifest frozen (no post_as; skills null → [])', () => {
    expect('post_as' in AgentManifest.shape).toBe(false);
    const m = AgentManifest.parse({ name: 'x', model: 'gpt-4.1', system_prompt: 'p', skills: null });
    expect(m.skills).toEqual([]);
    expect(m.provider).toBe('openrouter');
    expect(m.ci_fail_on).toBe('critical');
  });
});

describe('ci_runs retirement (test_no_ci_runs_refs / AC-41)', () => {
  it('the new contract file references agent_runs, never the ci_runs table or CiRun schema', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/vendor/shared/contracts/ci-runs.ts', import.meta.url)),
      'utf8',
    );
    // CiRunSummary is the only "CiRun*" token allowed; the retired `CiRun`
    // schema and the `ciRuns` Drizzle table must not be referenced by new code.
    expect(/\bciRuns\b/.test(src)).toBe(false);
    expect(/\bCiRun\b(?!Summary)/.test(src)).toBe(false);
    expect(src).toMatch(/agent_runs/);
  });

  it('agent_runs schema carries the four CI columns (source of CI runs)', () => {
    const runsSchema = readFileSync(
      fileURLToPath(new URL('../src/db/schema/runs.ts', import.meta.url)),
      'utf8',
    );
    expect(runsSchema).toMatch(/prNumber:\s*integer\('pr_number'\)/);
    expect(runsSchema).toMatch(/repo:\s*text\('repo'\)/);
    expect(runsSchema).toMatch(/githubUrl:\s*text\('github_url'\)/);
    expect(runsSchema).toMatch(/ciInstallationId:\s*uuid\('ci_installation_id'\)/);
  });

  it('the whole modules/ci/** producer+ingest module never references ciRuns or CiRun either', () => {
    const dir = fileURLToPath(new URL('../src/modules/ci', import.meta.url));
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' } as never) as string[];
    const tsFiles = files.filter((f) => f.endsWith('.ts'));
    expect(tsFiles.length).toBeGreaterThan(0); // sanity: the scan actually found files

    for (const rel of tsFiles) {
      const src = readFileSync(`${dir}/${rel}`, 'utf8');
      // The retired Drizzle table symbol (`import { ciRuns } from ...`) — CI
      // runs are read/written through `agent_runs` (`source='ci'`) instead.
      expect(src, `${rel} must not import the retired ciRuns table`).not.toMatch(/\bciRuns\b/);
      // The retired Zod schema (`CiRun`), distinct from the new `CiRunSummary` /
      // local repository types like `CiRunUpsert` which legitimately start with
      // "CiRun" but are NOT the retired symbol — word-boundary the exact name.
      expect(src, `${rel} must not reference the retired CiRun schema`).not.toMatch(
        /\bCiRun\b(?!Summary|Upsert)/,
      );
    }
  });
});
