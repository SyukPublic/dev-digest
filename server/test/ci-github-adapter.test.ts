/**
 * Phase 1 (L07 Export-to-CI) — GitHub Actions port methods (test_mock_github_actions).
 *
 * AC-42 coverage = interface parity + typecheck. The real `OctokitGitHubClient`
 * makes network calls, so (per R6, matching the existing dormant write methods)
 * it is exercised only through `MockGitHubClient` + a typecheck that the real
 * impl satisfies the widened `GitHubClient` interface. The end-to-end ingest is
 * driven via `MockGitHubClient` fixtures in Phase 2's integration test.
 */
import { describe, it, expect } from 'vitest';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import { OctokitGitHubClient } from '../src/adapters/github/octokit.js';
import type { GitHubClient, WorkflowRunSummary } from '@devdigest/shared';

const repo = { owner: 'acme', name: 'payments-api' };

describe('MockGitHubClient.listWorkflowRuns', () => {
  it('returns the configured fixtures and records the workflow queried', async () => {
    const runs: WorkflowRunSummary[] = [
      {
        runId: 42,
        status: 'completed',
        conclusion: 'success',
        prNumber: 123,
        htmlUrl: 'https://github.com/acme/payments-api/actions/runs/42',
        displayTitle: 'Add rate limiting',
        createdAt: '2026-07-14T00:00:00Z',
      },
    ];
    const gh = new MockGitHubClient({ workflowRuns: runs });
    const out = await gh.listWorkflowRuns(repo, 'devdigest-review.yml');
    expect(out).toEqual(runs);
    expect(gh.workflowRunQueries).toEqual(['devdigest-review.yml']);
  });

  it('defaults to an empty list when no fixture is set', async () => {
    const gh = new MockGitHubClient();
    expect(await gh.listWorkflowRuns(repo, 'devdigest-review.yml')).toEqual([]);
  });
});

describe('MockGitHubClient.downloadWorkflowRunArtifact', () => {
  it('returns the per-run devdigest-result.json text and records the query', async () => {
    const artifactJson = JSON.stringify({ findings_count: 2, cost_usd: 0.01, agent: 'sec' });
    const gh = new MockGitHubClient({ artifacts: { 42: artifactJson } });
    const out = await gh.downloadWorkflowRunArtifact(repo, 42, 'devdigest-result');
    expect(out).toBe(artifactJson);
    expect(gh.artifactQueries).toEqual([{ runId: 42, artifactName: 'devdigest-result' }]);
  });

  it('returns null for a run whose artifact is not present yet (in-progress)', async () => {
    const gh = new MockGitHubClient({ artifacts: { 42: '{}' } });
    expect(await gh.downloadWorkflowRunArtifact(repo, 99, 'devdigest-result')).toBeNull();
  });
});

describe('OctokitGitHubClient satisfies the widened GitHubClient interface', () => {
  it('implements listWorkflowRuns + downloadWorkflowRunArtifact', () => {
    const client: GitHubClient = new OctokitGitHubClient('token');
    expect(typeof client.listWorkflowRuns).toBe('function');
    expect(typeof client.downloadWorkflowRunArtifact).toBe('function');
  });
});
