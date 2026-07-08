import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Data access for reviews and their comments. `comments` has a `deletedAt`
 * timestamp column (soft delete).
 */
export class ReviewsRepository {
  constructor(private db: Db) {}

  // Every review together with its findings.
  async listWithFindings() {
    const reviews = await this.db.select().from(t.reviews);
    const out = [];
    for (const r of reviews) {
      const findings = await this.db
        .select()
        .from(t.findings)
        .where(eq(t.findings.reviewId, r.id));
      out.push({ ...r, findings });
    }
    return out;
  }

  // Comments on a pull request.
  async commentsForPr(prId: number) {
    return this.db.select().from(t.comments).where(eq(t.comments.prId, prId));
  }

  // Newest active comments on a pull request, for the activity panel.
  async recentActiveComments(prId: number, limit: number) {
    return this.db
      .select({ id: t.comments.id, body: t.comments.body, createdAt: t.comments.createdAt })
      .from(t.comments)
      .where(and(eq(t.comments.prId, prId), isNull(t.comments.deletedAt)))
      .orderBy(desc(t.comments.createdAt))
      .limit(limit);
  }

  // Find comments containing a search term.
  async searchComments(term: string) {
    const all = await this.db.select().from(t.comments);
    return all.filter((c) => c.body.includes(term));
  }
}
