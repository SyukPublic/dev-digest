import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * project-context data-access layer — the DB seam for spec attachments.
 *
 * Constructed in the composition root as `container.projectContextRepo`
 * (CP-6), mirroring `agentsRepo`. Phase 1's discovery/preview half reads from
 * the git clone (see `ProjectContextService`), NOT the DB; Phase 4 adds the
 * ordered attachment link-table methods over `agent_specs`/`skill_specs`.
 *
 * These MIRROR `AgentsRepository.linkedSkills`/`setSkills` (CP-3): an ordered
 * read (`orderBy(asc(order))`) and a delete-all-then-insert setter that assigns
 * `order = index`. An attachment's identity is a repo-relative PATH (never the
 * doc text — AC-5), so the tables are keyed `(owner, path)`. Every query is
 * workspace-scoped (the AC-20 tenancy guard) — the caller resolves the
 * workspace from the agent/skill first, then passes it here.
 */

/** One persisted attachment: the repo-relative doc PATH + its 0-based order. */
export interface SpecAttachmentRow {
  path: string;
  order: number;
}

export class ProjectContextRepository {
  constructor(private db: Db) {}

  /**
   * Whether a skill exists in this workspace (AC-20 scope guard for the skill
   * attach endpoints). `container.skillsRepo` is not promoted (the skills
   * repository is module-private), and deep-importing it would breach the module
   * facade (server rule 7), so this thin existence check lives on the repo that
   * already owns a `db` handle — it never reads skill BODIES, only presence.
   */
  async skillExists(workspaceId: string, skillId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, skillId)))
      .limit(1);
    return rows.length > 0;
  }

  // ---- agent_specs (docs attached directly to an agent) -------------------

  /** Attachments for an agent, workspace-scoped, in `order` ascending. */
  async attachedSpecsForAgent(
    workspaceId: string,
    agentId: string,
  ): Promise<SpecAttachmentRow[]> {
    const rows = await this.db
      .select({ path: t.agentSpecs.path, order: t.agentSpecs.order })
      .from(t.agentSpecs)
      .where(
        and(
          eq(t.agentSpecs.workspaceId, workspaceId),
          eq(t.agentSpecs.agentId, agentId),
        ),
      )
      .orderBy(asc(t.agentSpecs.order));
    return rows;
  }

  /**
   * Replace the full ordered set of docs attached to an agent with `paths`,
   * assigning `order = index` (delete-all-then-insert, like `setSkills`). Paths
   * absent from the list are detached. Stores the PATH only — never doc text.
   *
   * The delete + insert run in ONE transaction so the replace-set stays atomic,
   * and the batch insert carries `.onConflictDoUpdate` on the (agentId, path) PK
   * so two concurrent identical writers converge instead of raising a `23505`
   * duplicate-key (the attach race). `order` is a reserved word → quoted; the
   * conflict target's values come from the `excluded` pseudo-row (a per-row `i`
   * is NOT in scope in a single batched `set`).
   */
  async setAgentSpecs(
    workspaceId: string,
    agentId: string,
    paths: string[],
  ): Promise<SpecAttachmentRow[]> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.agentSpecs)
        .where(
          and(
            eq(t.agentSpecs.workspaceId, workspaceId),
            eq(t.agentSpecs.agentId, agentId),
          ),
        );
      if (paths.length > 0) {
        await tx
          .insert(t.agentSpecs)
          .values(paths.map((path, i) => ({ workspaceId, agentId, path, order: i })))
          .onConflictDoUpdate({
            target: [t.agentSpecs.agentId, t.agentSpecs.path],
            set: {
              order: sql`excluded."order"`,
              workspaceId: sql`excluded.workspace_id`,
            },
          });
      }
    });
    return this.attachedSpecsForAgent(workspaceId, agentId);
  }

  // ---- skill_specs (docs attached to a skill, inherited by agents) --------

  /** Attachments for a skill, workspace-scoped, in `order` ascending. */
  async attachedSpecsForSkill(
    workspaceId: string,
    skillId: string,
  ): Promise<SpecAttachmentRow[]> {
    const rows = await this.db
      .select({ path: t.skillSpecs.path, order: t.skillSpecs.order })
      .from(t.skillSpecs)
      .where(
        and(
          eq(t.skillSpecs.workspaceId, workspaceId),
          eq(t.skillSpecs.skillId, skillId),
        ),
      )
      .orderBy(asc(t.skillSpecs.order));
    return rows;
  }

  /**
   * Attachments for MANY skills at once (used by the run-time merge resolver to
   * read every enabled skill's docs in one query). Returned grouped by skillId,
   * each group in `order` ascending. Empty map when `skillIds` is empty.
   */
  async attachedSpecsForSkills(
    workspaceId: string,
    skillIds: string[],
  ): Promise<Map<string, SpecAttachmentRow[]>> {
    const out = new Map<string, SpecAttachmentRow[]>();
    if (skillIds.length === 0) return out;
    const rows = await this.db
      .select({
        skillId: t.skillSpecs.skillId,
        path: t.skillSpecs.path,
        order: t.skillSpecs.order,
      })
      .from(t.skillSpecs)
      .where(
        and(
          eq(t.skillSpecs.workspaceId, workspaceId),
          inArray(t.skillSpecs.skillId, skillIds),
        ),
      )
      .orderBy(asc(t.skillSpecs.order));
    for (const r of rows) {
      const list = out.get(r.skillId) ?? [];
      list.push({ path: r.path, order: r.order });
      out.set(r.skillId, list);
    }
    return out;
  }

  /**
   * Replace the full ordered set of docs attached to a skill with `paths`,
   * assigning `order = index`. Paths absent from the list are detached. Stores
   * the PATH only — never doc text (AC-5).
   *
   * Same atomic transaction + `onConflictDoUpdate` upsert as `setAgentSpecs`
   * (targeting the (skillId, path) PK) so concurrent identical writers converge
   * instead of raising a `23505` duplicate-key. See `setAgentSpecs` for why the
   * `set` reads the `excluded` pseudo-row rather than a per-row `i`.
   */
  async setSkillSpecs(
    workspaceId: string,
    skillId: string,
    paths: string[],
  ): Promise<SpecAttachmentRow[]> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.skillSpecs)
        .where(
          and(
            eq(t.skillSpecs.workspaceId, workspaceId),
            eq(t.skillSpecs.skillId, skillId),
          ),
        );
      if (paths.length > 0) {
        await tx
          .insert(t.skillSpecs)
          .values(paths.map((path, i) => ({ workspaceId, skillId, path, order: i })))
          .onConflictDoUpdate({
            target: [t.skillSpecs.skillId, t.skillSpecs.path],
            set: {
              order: sql`excluded."order"`,
              workspaceId: sql`excluded.workspace_id`,
            },
          });
      }
    });
    return this.attachedSpecsForSkill(workspaceId, skillId);
  }
}
