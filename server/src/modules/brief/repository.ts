import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Brief } from '@devdigest/shared';

/**
 * brief data-access layer — the DB seam for the per-PR Why+Risk Brief cache
 * (CP-7). ALL Drizzle lives HERE (onion rule 4): the service and routes call
 * these methods and never build a query.
 *
 * The `pr_why_risk_brief` table is ONE row per PR (PK `pr_id`, cascade-delete
 * from `pull_requests`). It carries `workspace_id` for tenancy, but the tenancy
 * GUARD runs in the service via `reviewRepo.getPull(workspaceId, prId)` BEFORE
 * any read/write reaches here (AC-16). `upsert` overwrites any prior brief so
 * two concurrent writes can't violate the PK (AC-11).
 */

/** A stored brief row: the validated `Brief` JSON + provenance. */
export interface WhyRiskBriefRow {
  json: Brief;
  generatedAt: Date;
  freshnessKey: string | null;
}

export class BriefRepository {
  constructor(private db: Db) {}

  /**
   * The stored brief for a PR, or `undefined` when none has been generated yet
   * (the AC-8 empty state). `json` is the persisted `Brief`; it is stored as
   * validated JSON and returned as-is (validated at the generation gate).
   */
  async getByPr(prId: string): Promise<WhyRiskBriefRow | undefined> {
    const [row] = await this.db
      .select({
        json: t.prWhyRiskBrief.json,
        generatedAt: t.prWhyRiskBrief.generatedAt,
        freshnessKey: t.prWhyRiskBrief.freshnessKey,
      })
      .from(t.prWhyRiskBrief)
      .where(eq(t.prWhyRiskBrief.prId, prId))
      .limit(1);
    if (!row) return undefined;
    return {
      json: row.json as Brief,
      generatedAt: row.generatedAt,
      freshnessKey: row.freshnessKey ?? null,
    };
  }

  /**
   * Insert or overwrite the brief for a PR (CP-7, AC-1/AC-11). Keyed on `pr_id`
   * (the PK), so a second generation replaces the prior document and re-stamps
   * `generated_at` — an idempotent upsert, so two concurrent writes can't
   * violate the PK. Returns the persisted row so the service can build its read
   * record from the stored timestamp.
   */
  async upsert(
    prId: string,
    workspaceId: string,
    json: Brief,
    freshnessKey: string | null,
  ): Promise<WhyRiskBriefRow> {
    const now = new Date();
    const [row] = await this.db
      .insert(t.prWhyRiskBrief)
      .values({ prId, workspaceId, json, generatedAt: now, freshnessKey })
      .onConflictDoUpdate({
        target: t.prWhyRiskBrief.prId,
        set: { json, generatedAt: now, freshnessKey },
      })
      .returning({
        json: t.prWhyRiskBrief.json,
        generatedAt: t.prWhyRiskBrief.generatedAt,
        freshnessKey: t.prWhyRiskBrief.freshnessKey,
      });
    return {
      json: row!.json as Brief,
      generatedAt: row!.generatedAt,
      freshnessKey: row!.freshnessKey ?? null,
    };
  }
}
