import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type ReviewRow = typeof t.reviews.$inferSelect;

/**
 * Share module — data access for review-share links.
 *
 * A share link is just a token that points at an existing review id, so this
 * layer only needs to "load this review". It reads the existing reviews table;
 * no new table is introduced.
 */
export class ShareRepository {
  constructor(private db: Db) {}

  /** The review behind a share token (used to render the public header). */
  async getReview(reviewId: string): Promise<ReviewRow | undefined> {
    const [row] = await this.db.select().from(t.reviews).where(eq(t.reviews.id, reviewId));
    return row;
  }
}
