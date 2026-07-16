import { describe, it, expect, vi, afterEach } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { OctokitGitHubClient } from './octokit.js';
import type { RepoRef } from '@devdigest/shared';

/**
 * Unit tests for the TWO new `GitHubClient` port methods this plan adds to the
 * real Octokit adapter (T2/T3, AC-64/AC-71): `deleteFiles` (Git Data API tree-
 * on-`base_tree` deletion) and `downloadWorkflowRunArtifactFiles` (multi-file
 * artifact unzip). No real network — `globalThis.fetch` is stubbed with a tiny
 * router matching Octokit's REST call shapes (verified against the installed
 * `@octokit/plugin-rest-endpoint-methods` route table + `@octokit/request`'s
 * content-type-driven body parsing), mirroring the mock-policy for adapter
 * tests: mock ONLY the external HTTP boundary, never the unit under test.
 *
 * Unit under test: `OctokitGitHubClient.deleteFiles` / `.downloadWorkflowRunArtifactFiles`.
 */

const REPO: RepoRef = { owner: 'acme', name: 'webapp' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A minimal fetch router keyed on (method, a literal — never templated — URL
 *  substring), so it stays correct regardless of how Octokit encodes the
 *  dynamic `{ref}`/`{artifact_id}` path segments. */
function makeRouter(handlers: { test: (method: string, url: string) => boolean; respond: () => Response }[]) {
  return vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const match = handlers.find((h) => h.test(method, url));
    if (!match) throw new Error(`Unhandled fetch: ${method} ${url}`);
    return match.respond();
  });
}

describe('OctokitGitHubClient.deleteFiles (T2, AC-71)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deletes exactly the given paths via a tree with sha:null, leaving other files untouched, and force-updates the branch ref', async () => {
    const fetchImpl = makeRouter([
      // getRef: GET /repos/{owner}/{repo}/git/ref/{ref}  (singular "ref")
      {
        test: (m, u) => m === 'GET' && u.includes('/git/ref/'),
        respond: () => jsonResponse({ object: { sha: 'branch-tip-sha' } }),
      },
      // getCommit: GET /repos/{owner}/{repo}/git/commits/{sha}
      {
        test: (m, u) => m === 'GET' && u.includes('/git/commits/'),
        respond: () => jsonResponse({ tree: { sha: 'parent-tree-sha' } }),
      },
      // createTree: POST /repos/{owner}/{repo}/git/trees
      {
        test: (m, u) => m === 'POST' && u.endsWith('/git/trees'),
        respond: () => jsonResponse({ sha: 'new-tree-sha' }),
      },
      // createCommit: POST /repos/{owner}/{repo}/git/commits
      {
        test: (m, u) => m === 'POST' && u.endsWith('/git/commits'),
        respond: () => jsonResponse({ sha: 'new-commit-sha' }),
      },
      // updateRef: PATCH /repos/{owner}/{repo}/git/refs/{ref}
      {
        test: (m, u) => m === 'PATCH' && u.includes('/git/refs/'),
        respond: () => jsonResponse({ object: { sha: 'new-commit-sha' } }),
      },
    ]);
    vi.stubGlobal('fetch', fetchImpl);

    const client = new OctokitGitHubClient('ghp_test_token');
    const result = await client.deleteFiles(REPO, {
      branch: 'devdigest/ci',
      base: 'devdigest/ci',
      message: 'Remove Alpha Guardian from CI',
      paths: ['.devdigest/agents/alpha-guardian-11111111.yaml', '.devdigest/skills/alpha-rubric.md'],
    });

    expect(result).toEqual({ branch: 'devdigest/ci' });

    // Assert on the ACTUAL request bodies sent, not just call counts.
    const treePostCall = fetchImpl.mock.calls.find(
      ([url, init]) => String(url).endsWith('/git/trees') && (init?.method ?? '') === 'POST',
    )!;
    const treeBody = JSON.parse((treePostCall[1] as RequestInit).body as string) as {
      base_tree: string;
      tree: { path: string; sha: unknown }[];
    };
    expect(treeBody.base_tree).toBe('parent-tree-sha');
    // Every requested path is marked for deletion (sha: null)…
    expect(treeBody.tree).toEqual([
      { path: '.devdigest/agents/alpha-guardian-11111111.yaml', mode: '100644', type: 'blob', sha: null },
      { path: '.devdigest/skills/alpha-rubric.md', mode: '100644', type: 'blob', sha: null },
    ]);

    const updateRefCall = fetchImpl.mock.calls.find(
      ([url, init]) => String(url).includes('/git/refs/') && (init?.method ?? '') === 'PATCH',
    )!;
    const refBody = JSON.parse((updateRefCall[1] as RequestInit).body as string) as { sha: string; force: boolean };
    expect(refBody.sha).toBe('new-commit-sha');
    expect(refBody.force).toBe(true);
  });

  it('propagates a GitHub API error (e.g. branch not found) instead of silently no-oping', async () => {
    const fetchImpl = makeRouter([
      {
        test: (m, u) => m === 'GET' && u.includes('/git/ref/'),
        respond: () => jsonResponse({ message: 'Not Found' }, 404),
      },
    ]);
    vi.stubGlobal('fetch', fetchImpl);

    const client = new OctokitGitHubClient('ghp_test_token');
    await expect(
      client.deleteFiles(REPO, {
        branch: 'devdigest/ci',
        base: 'devdigest/ci',
        message: 'x',
        paths: ['.devdigest/agents/ghost.yaml'],
      }),
    ).rejects.toThrow();
  });
});

describe('OctokitGitHubClient.downloadWorkflowRunArtifactFiles (T3, AC-64)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unzips every *.json entry in the named artifact and returns their decompressed text', async () => {
    const zipBytes = zipSync({
      'devdigest-result-security-aaaa1111.json': strToU8(
        JSON.stringify({ agent: 'security-aaaa1111', findings_count: 1 }),
      ),
      'devdigest-result-perf-bbbb2222.json': strToU8(
        JSON.stringify({ agent: 'perf-bbbb2222', findings_count: 0 }),
      ),
      // A non-JSON entry (e.g. a stray log file) must be IGNORED, never decompressed/returned.
      'ignored.log': strToU8('should not appear'),
    });

    const fetchImpl = makeRouter([
      // listWorkflowRunArtifacts: GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts
      {
        test: (m, u) => m === 'GET' && u.includes('/actions/runs/') && u.includes('/artifacts'),
        respond: () =>
          jsonResponse({
            artifacts: [{ id: 555, name: 'devdigest-result' }],
          }),
      },
      // downloadArtifact: GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}
      {
        test: (m, u) => m === 'GET' && u.includes('/actions/artifacts/'),
        respond: () =>
          new Response(zipBytes, { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
      },
    ]);
    vi.stubGlobal('fetch', fetchImpl);

    const client = new OctokitGitHubClient('ghp_test_token');
    const files = await client.downloadWorkflowRunArtifactFiles(REPO, 101, 'devdigest-result');

    expect(files.map((f) => f.name).sort()).toEqual([
      'devdigest-result-perf-bbbb2222.json',
      'devdigest-result-security-aaaa1111.json',
    ]);
    expect(files.find((f) => f.name.includes('security'))?.text).toContain('"security-aaaa1111"');
    expect(files.some((f) => f.name === 'ignored.log')).toBe(false);
  });

  it('returns an empty array when no artifact with the given name exists on the run (no crash)', async () => {
    const fetchImpl = makeRouter([
      {
        test: (m, u) => m === 'GET' && u.includes('/actions/runs/') && u.includes('/artifacts'),
        respond: () => jsonResponse({ artifacts: [] }),
      },
    ]);
    vi.stubGlobal('fetch', fetchImpl);

    const client = new OctokitGitHubClient('ghp_test_token');
    const files = await client.downloadWorkflowRunArtifactFiles(REPO, 999, 'devdigest-result');
    expect(files).toEqual([]);
  });
});
