import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { FindingRow } from '../../db/rows.js';

export type ReviewRow = typeof t.reviews.$inferSelect;

/**
 * Share module — data access for review-share links.
 *
 * A share link is just a token that points at an existing review id, so this
 * layer only needs to "load this review and its findings". It reads the
 * existing reviews/findings tables; no new table is introduced.
 */
export class ShareRepository {
  constructor(private db: Db) {}

  /** The review behind a share token (used to render the public header). */
  async getReview(reviewId: string): Promise<ReviewRow | undefined> {
    const [row] = await this.db.select().from(t.reviews).where(eq(t.reviews.id, reviewId));
    return row;
  }

  /**
   * All findings for a review, highest-confidence first. Callers resolve and
   * authorize the review (workspace check) before calling this; findings carry
   * no workspace_id of their own, so they are scoped via their parent review.
   */
  async findingsForReview(reviewId: string): Promise<FindingRow[]> {
    return this.db
      .select()
      .from(t.findings)
      .where(eq(t.findings.reviewId, reviewId))
      .orderBy(desc(t.findings.confidence));
  }
}
