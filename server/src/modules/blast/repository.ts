import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Blast-radius summary cache repository (L04).
 *
 * The ONLY DB access in the blast module. It owns reads/writes of the
 * `pr_blast_summary` table — the cheap-LLM prose summary keyed by
 * `(prId, headSha)`. PR meta + changed files are NOT queried here; the service
 * reaches those through the cross-cutting `container.reviewRepo` facade (onion
 * rule 4/7 — DB stays in repositories, shared entities behind their facade).
 *
 * The blast MAP itself is recomputed from the repo-intel index on every request
 * and is never cached; only the one-paragraph summary lives here.
 *
 * `pr_blast_summary` is intentionally absent from the relational `schema` object
 * (see `db/schema.ts`), so it is reached via the query-builder path
 * (`t.prBlastSummary`) exactly like `pull.repo.ts` reaches `t.prBrief` — no
 * `db.query.*` and no edit to the schema object.
 */
export class BlastRepository {
  constructor(private db: Db) {}

  /**
   * The cached summary for this PR, but ONLY when it was generated against the
   * same head SHA. A head move makes `headSha` mismatch, so the cached prose is
   * treated as stale and the caller recomputes.
   */
  async getSummary(prId: string, headSha: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ headSha: t.prBlastSummary.headSha, summary: t.prBlastSummary.summary })
      .from(t.prBlastSummary)
      .where(eq(t.prBlastSummary.prId, prId));
    // Staleness gate keyed on headSha: a row from a previous head is a miss.
    return row?.headSha === headSha ? row.summary : undefined;
  }

  /** Insert or overwrite the cached summary for a PR (PK `prId`). */
  async upsertSummary(prId: string, headSha: string, summary: string): Promise<void> {
    await this.db
      .insert(t.prBlastSummary)
      .values({ prId, headSha, summary, createdAt: new Date() })
      .onConflictDoUpdate({
        target: t.prBlastSummary.prId,
        set: { headSha, summary, createdAt: new Date() },
      });
  }
}
