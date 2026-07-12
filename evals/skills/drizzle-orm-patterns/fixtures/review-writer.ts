import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { NewComment } from '../../db/schema.js';

export class ReviewWriter {
  constructor(private db: Db) {}

  // Persist a finished review and flip the PR to 'reviewed'.
  async recordResult(prId: number, review: { score: number; verdict: string }) {
    await this.db.insert(t.reviews).values({ prId, score: review.score, verdict: review.verdict });
    await this.db.update(t.pullRequests).set({ status: 'reviewed' }).where(eq(t.pullRequests.id, prId));
  }

  // Import comments discovered on the PR.
  async importComments(prId: number, rows: NewComment[]) {
    for (const row of rows) {
      await this.db.insert(t.comments).values({ ...row, prId });
    }
  }

  // Archive a review and its pull request together.
  async archiveReview(reviewId: number, prId: number) {
    await this.db.transaction(async (tx) => {
      await tx.update(t.reviews).set({ archived: true }).where(eq(t.reviews.id, reviewId));
      await tx.update(t.pullRequests).set({ status: 'archived' }).where(eq(t.pullRequests.id, prId));
    });
  }

  // Mark a single review as seen.
  async markSeen(reviewId: number) {
    await this.db.update(t.reviews).set({ seen: true }).where(eq(t.reviews.id, reviewId));
  }
}
