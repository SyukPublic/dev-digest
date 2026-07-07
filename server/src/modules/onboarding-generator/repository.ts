import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Onboarding } from '@devdigest/shared';

/**
 * onboarding-generator data-access layer — the DB seam for the per-repo
 * Onboarding Tour.
 *
 * Constructed in the composition root as `container.onboardingRepo` (CP-6),
 * mirroring `projectContextRepo`. All Drizzle lives HERE (onion rule 4): the
 * service and routes call these methods and never build a query.
 *
 * The `onboarding` table is one row per repo (PK is `repoId`, cascade-delete
 * from `repos`), so there is no `workspace_id` column — tenancy scoping happens
 * in the service via `reposRepo.getById(workspaceId, repoId)` BEFORE any read
 * or write reaches here (AC-20). `upsert` overwrites any prior tour (AC-2).
 */

/** A stored tour row: the validated `Onboarding` document + when it was generated. */
export interface OnboardingRow {
  json: Onboarding;
  generatedAt: Date;
}

export class OnboardingRepository {
  constructor(private db: Db) {}

  /**
   * The stored tour for a repo, or `undefined` when none has been generated yet
   * (the AC-6 empty state). `json` is the persisted `Onboarding` document; it is
   * stored as validated JSON and returned as-is (parsed at the generation gate).
   */
  async getByRepo(repoId: string): Promise<OnboardingRow | undefined> {
    const [row] = await this.db
      .select({ json: t.onboarding.json, generatedAt: t.onboarding.generatedAt })
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId))
      .limit(1);
    if (!row) return undefined;
    return { json: row.json as Onboarding, generatedAt: row.generatedAt };
  }

  /**
   * Insert or overwrite the tour for a repo (AC-2). Keyed by `repoId` (the PK),
   * so a second generation replaces the prior document and re-stamps
   * `generatedAt` — there is only ever one tour per repo. Returns the persisted
   * row so the service can build its response meta from the stored timestamp.
   */
  async upsert(repoId: string, json: Onboarding): Promise<OnboardingRow> {
    const now = new Date();
    const [row] = await this.db
      .insert(t.onboarding)
      .values({ repoId, json, generatedAt: now })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: { json, generatedAt: now },
      })
      .returning({ json: t.onboarding.json, generatedAt: t.onboarding.generatedAt });
    return { json: row!.json as Onboarding, generatedAt: row!.generatedAt };
  }
}
