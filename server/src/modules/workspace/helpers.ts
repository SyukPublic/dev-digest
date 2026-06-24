import type { RepoRow } from '../../db/rows.js';

/**
 * Workspace overview DTOs + pure mapping (no DB / `this`, so it unit-tests
 * cleanly). The workspace surface is a read-only overview of cloned repos.
 */

export interface RepoSummary {
  id: string;
  full_name: string;
  clone_path: string | null;
  last_polled_at: string | null;
  cloned: boolean;
}

export interface WorkspaceOverview {
  workspaceId: string;
  cloneDir: string;
  repos: RepoSummary[];
}

export function toRepoSummary(r: RepoRow): RepoSummary {
  return {
    id: r.id,
    full_name: r.fullName,
    clone_path: r.clonePath,
    last_polled_at: r.lastPolledAt?.toISOString() ?? null,
    cloned: Boolean(r.clonePath),
  };
}
