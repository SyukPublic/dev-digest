/**
 * Workspace overview mapping (`modules/workspace/helpers.ts`) — the pure
 * repo-row → summary transform behind GET /workspace.
 */
import { describe, it, expect } from 'vitest';
import { toRepoSummary } from '../src/modules/workspace/helpers.js';
import type { RepoRow } from '../src/db/rows.js';

function repo(overrides: Partial<RepoRow> = {}): RepoRow {
  return {
    id: 'repo-1',
    workspaceId: 'ws-1',
    owner: 'acme',
    name: 'widgets',
    fullName: 'acme/widgets',
    defaultBranch: 'main',
    clonePath: null,
    lastPolledAt: null,
    createdBy: null,
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    ...overrides,
  };
}

describe('toRepoSummary', () => {
  it('marks a repo cloned once it has a clone path and serializes the poll time', () => {
    const polled = new Date(Date.UTC(2026, 5, 11));
    expect(toRepoSummary(repo({ clonePath: '/clones/acme/widgets', lastPolledAt: polled }))).toEqual({
      id: 'repo-1',
      full_name: 'acme/widgets',
      clone_path: '/clones/acme/widgets',
      last_polled_at: polled.toISOString(),
      cloned: true,
    });
  });

  it('is not cloned and has a null poll time before the first clone', () => {
    expect(toRepoSummary(repo())).toMatchObject({ cloned: false, clone_path: null, last_polled_at: null });
  });
});
