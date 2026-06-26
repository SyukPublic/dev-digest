import type { Container } from '../../platform/container.js';
import type { SmartDiff } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { composeSmartDiff } from './compose.js';

/**
 * Smart Diff service (Phase B) — orchestration only.
 *
 * Loads already-stored PR files + the latest review's findings via the shared
 * `reviewRepo` facade, then hands them to the pure `composeSmartDiff` helper.
 * Crucially there is NO LLM call anywhere: Smart Diff deterministically composes
 * data the Structured Reviewer already produced (see spec "THE KEY PRINCIPLE").
 *
 * Onion: this is an application service. It performs no Drizzle queries (DB
 * access stays in the reviews repository, reached via the published facade —
 * rule 7) and adds no repository of its own (reuses getPull/getPrFiles/
 * reviewsForPull). The classification/composition brain is the pure inner layer
 * (`classify.ts` / `compose.ts`).
 */
export class SmartDiffService {
  constructor(private container: Container) {}

  async getSmartDiff(workspaceId: string, prId: string): Promise<SmartDiff> {
    // Workspace-scope guard: getPull is scoped by workspace, so an unknown or
    // other-tenant PR id yields no row → 404 (prevents cross-tenant IDOR).
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.container.reviewRepo.getPrFiles(prId);
    const reviews = await this.container.reviewRepo.reviewsForPull(prId);

    // "Latest review" = the newest `kind:'review'` entry. reviewsForPull is
    // newest-first and summary-kind rows can interleave, so we must `find` the
    // first review-kind row, NOT take `[0]`.
    const latest = reviews.find((r) => r.review.kind === 'review');

    // Build the per-path finding line map from the latest review's findings:
    //  - skip dismissed findings (dismissedAt !== null),
    //  - expand each finding to the inclusive [startLine..endLine] range
    //    (fall back to [startLine] when endLine < startLine),
    //  - accumulate per `finding.file`. compose sorts + de-dupes.
    const findingsByPath = new Map<string, number[]>();
    for (const finding of latest?.findings ?? []) {
      if (finding.dismissedAt !== null) continue;

      const start = finding.startLine;
      const end = finding.endLine >= start ? finding.endLine : start;
      const lines = findingsByPath.get(finding.file) ?? [];
      for (let line = start; line <= end; line++) lines.push(line);
      findingsByPath.set(finding.file, lines);
    }

    return composeSmartDiff(
      files.map((f) => ({
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
      })),
      findingsByPath,
    );
  }
}
