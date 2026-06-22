import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';

/**
 * F1 — polling service. MANUAL refresh that ONLY syncs the PR list (new/updated
 * PRs appear, head_sha updates) and bumps `last_polled_at`. It does NOT trigger
 * any review — review is manual (owned by A2).
 *
 * Unlike the pulls LIST endpoint, polling requires a GitHub token: a missing
 * token surfaces (ConfigError from `container.github()`) rather than silently
 * serving stale data, because the user explicitly asked to sync.
 */
export class PollingService {
  constructor(private container: Container) {}

  async poll(
    workspaceId: string,
    repoId: string,
  ): Promise<{ synced: number; reviewTriggered: false }> {
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const gh = await this.container.github();
    const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
    const synced = await this.container.pullsRepo.upsertImportedPulls(workspaceId, repo.id, pulls);
    await this.container.reposRepo.markPolled(repo.id);

    // NOTE: no review is triggered here — manual trigger only.
    return { synced, reviewTriggered: false };
  }
}
