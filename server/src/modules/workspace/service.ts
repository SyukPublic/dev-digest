import type { Container } from '../../platform/container.js';
import { toRepoSummary, type WorkspaceOverview } from './helpers.js';

/**
 * F1 — workspace service. Read-only overview: where clones live + a summary of
 * cloned repos. Cleanup/re-pull of individual repos is owned by the repos module
 * (refresh/delete); this surface just gives the UI an overview, reading the
 * repos table through the shared `container.reposRepo`.
 */
export class WorkspaceService {
  constructor(private container: Container) {}

  async getOverview(workspaceId: string): Promise<WorkspaceOverview> {
    const repos = await this.container.reposRepo.list(workspaceId);
    return {
      workspaceId,
      cloneDir: this.container.config.cloneDir,
      repos: repos.map(toRepoSummary),
    };
  }
}
