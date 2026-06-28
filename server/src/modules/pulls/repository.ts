import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PrMeta, PrFile, PrCommit } from '@devdigest/shared';
import type { PullRow, PrFileRow, PrCommitRow } from '../../db/rows.js';

export type { PullRow, PrFileRow, PrCommitRow };

/**
 * F1 — pulls data-access layer. The ONLY place that touches `pull_requests`,
 * `pr_files`, and `pr_commits`. Promoted to a cross-cutting repository on the
 * container (`container.pullsRepo`) because PR persistence is shared by the
 * `pulls` (import + detail) and `polling` (manual sync) modules.
 *
 * Workspace scoping: `getPull` is workspace-scoped; the by-repo / by-pr reads
 * are reached only after the caller has already resolved a workspace-scoped repo
 * or PR, so they key on the (workspace-owned) repo_id / pr_id.
 */
export class PullsRepository {
  constructor(private db: Db) {}

  // ---- reads --------------------------------------------------------------

  listByRepo(repoId: string): Promise<PullRow[]> {
    return this.db.select().from(t.pullRequests).where(eq(t.pullRequests.repoId, repoId));
  }

  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  getPrFiles(prId: string): Promise<PrFileRow[]> {
    return this.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
  }

  getPrCommits(prId: string): Promise<PrCommitRow[]> {
    return this.db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
  }

  // ---- writes -------------------------------------------------------------

  /**
   * Idempotently upsert a GitHub PR-list page (unique on repo_id+number).
   * On conflict we refresh only the volatile metadata (title/head/status/updated)
   * and DELIBERATELY leave additions/deletions/files_count untouched — the list
   * payload zeroes them, and they're backfilled from the detail endpoint
   * (`updateStats`). Returns the number of PRs processed.
   */
  async upsertImportedPulls(
    workspaceId: string,
    repoId: string,
    pulls: PrMeta[],
  ): Promise<number> {
    for (const pr of pulls) {
      await this.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: pr.number,
          title: pr.title,
          author: pr.author,
          branch: pr.branch,
          base: pr.base,
          headSha: pr.head_sha,
          additions: pr.additions,
          deletions: pr.deletions,
          filesCount: pr.files_count,
          status: pr.status,
          openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
          updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
        })
        .onConflictDoUpdate({
          target: [t.pullRequests.repoId, t.pullRequests.number],
          set: {
            title: pr.title,
            headSha: pr.head_sha,
            status: pr.status,
            updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
          },
        });
    }
    return pulls.length;
  }

  /** Backfill diff stats (the PR-list payload doesn't carry them). */
  async updateStats(
    prId: string,
    stats: { additions: number; deletions: number; filesCount: number },
  ): Promise<void> {
    await this.db
      .update(t.pullRequests)
      .set({
        additions: stats.additions,
        deletions: stats.deletions,
        filesCount: stats.filesCount,
      })
      .where(eq(t.pullRequests.id, prId));
  }

  /**
   * Refresh PR detail (head_sha + body + diff stats) from the GitHub detail
   * fetch. Persisting `headSha` here is deliberate: `pr_files` and `head_sha`
   * must advance TOGETHER so `reviewsForPull` derives `anchor_status` from a
   * consistent snapshot (otherwise the diff moves on detail load while head_sha
   * only moves on list-sync `upsertImportedPulls`, and finding statuses converge
   * in steps). See INSIGHTS 2026-06-27 (getDetail did not persist head_sha).
   */
  async updateDetail(
    prId: string,
    detail: {
      body: string | null;
      additions: number;
      deletions: number;
      filesCount: number;
      headSha: string;
    },
  ): Promise<void> {
    await this.db
      .update(t.pullRequests)
      .set({
        headSha: detail.headSha,
        body: detail.body,
        additions: detail.additions,
        deletions: detail.deletions,
        filesCount: detail.filesCount,
      })
      .where(eq(t.pullRequests.id, prId));
  }

  /** Replace the stored file list for a PR (atomic delete + insert). */
  async replacePrFiles(prId: string, files: PrFile[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
      if (files.length > 0) {
        await tx.insert(t.prFiles).values(
          files.map((f) => ({
            prId,
            path: f.path,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ?? null,
          })),
        );
      }
    });
  }

  /** Replace the stored commit list for a PR (atomic delete + insert). */
  async replacePrCommits(prId: string, commits: PrCommit[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.prCommits).where(eq(t.prCommits.prId, prId));
      if (commits.length > 0) {
        await tx.insert(t.prCommits).values(
          commits.map((c) => ({
            prId,
            sha: c.sha,
            message: c.message,
            author: c.author,
            committedAt: c.committed_at ? new Date(c.committed_at) : null,
          })),
        );
      }
    });
  }
}
