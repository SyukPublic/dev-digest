import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { FindingRow } from '../../db/rows.js';

export type ReviewRow = typeof t.reviews.$inferSelect;

/**
 * Share module — data access for public review-share links.
 *
 * A share link is just a token that points at an existing review id, so this
 * layer only needs to "load this review and its findings" plus a free-text
 * search across finding titles for the public viewer's filter box. It reads the
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
   * All findings for a shared review, highest-confidence first. The share link
   * is public — being handed the token is what authorizes the read — so we look
   * the findings up by review id alone.
   */
  async findingsForReview(reviewId: string): Promise<FindingRow[]> {
    return this.db
      .select()
      .from(t.findings)
      .where(eq(t.findings.reviewId, reviewId))
      .orderBy(desc(t.findings.confidence));
  }

  /**
   * Free-text filter for the public viewer's search box: match the query
   * against finding titles within one shared review.
   */
  async searchFindings(reviewId: string, q: string): Promise<FindingRow[]> {
    const rows = await this.db.execute(
      sql.raw(
        `SELECT * FROM findings
           WHERE review_id = '${reviewId}'
             AND title ILIKE '%${q}%'
         ORDER BY confidence DESC`,
      ),
    );
    return rows as unknown as FindingRow[];
  }
}
