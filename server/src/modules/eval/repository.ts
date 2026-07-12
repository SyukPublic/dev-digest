import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  EvalCaseRow,
  EvalRunRow,
  EvalSuiteRunRow,
  EvalSkillSuiteRunRow,
  SkillRow,
} from '../../db/rows.js';

import * as caseRepo from './repository/eval-case.repo.js';
import * as suiteRepo from './repository/eval-suite.repo.js';
import * as skillSuiteRepo from './repository/eval-skill-suite.repo.js';
import * as runRepo from './repository/eval-run.repo.js';

export type { EvalCaseRow, EvalRunRow, EvalSuiteRunRow, EvalSkillSuiteRunRow };

/**
 * L06 Agent Eval Pipeline data-access facade. The ONLY layer touching the DB for
 * the eval domain (onion rule 4). Mirrors `reviews/repository.ts`: a thin class
 * composing per-aggregate query modules so the public API stays stable while the
 * queries stay colocated by aggregate under `./repository/`.
 */
export class EvalRepository {
  constructor(private db: Db) {}

  // ---- cases --------------------------------------------------------------
  insertCase(values: caseRepo.InsertCaseValues): Promise<EvalCaseRow> {
    return caseRepo.insertCase(this.db, values);
  }
  getCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    return caseRepo.getCase(this.db, workspaceId, id);
  }
  listCasesByOwner(workspaceId: string, ownerId: string): Promise<EvalCaseRow[]> {
    return caseRepo.listByOwner(this.db, workspaceId, ownerId);
  }
  updateCase(
    workspaceId: string,
    id: string,
    patch: caseRepo.UpdateCaseValues,
  ): Promise<EvalCaseRow | undefined> {
    return caseRepo.updateCase(this.db, workspaceId, id, patch);
  }
  deleteCase(workspaceId: string, id: string): Promise<boolean> {
    return caseRepo.deleteCase(this.db, workspaceId, id);
  }
  deleteCasesByOwner(workspaceId: string, ownerId: string): Promise<number> {
    return caseRepo.deleteCasesByOwner(this.db, workspaceId, ownerId);
  }

  // ---- suite runs ---------------------------------------------------------
  insertSuite(values: {
    workspaceId: string;
    agentId: string;
    agentVersion: number;
  }): Promise<EvalSuiteRunRow> {
    return suiteRepo.insertSuite(this.db, values);
  }
  oneRunningForAgent(workspaceId: string, agentId: string): Promise<EvalSuiteRunRow | undefined> {
    return suiteRepo.oneRunningForAgent(this.db, workspaceId, agentId);
  }
  setSuiteTerminal(suiteId: string, values: suiteRepo.SuiteTerminalValues): Promise<void> {
    return suiteRepo.setTerminal(this.db, suiteId, values);
  }
  getSuite(workspaceId: string, id: string): Promise<EvalSuiteRunRow | undefined> {
    return suiteRepo.getSuite(this.db, workspaceId, id);
  }
  listSuitesByAgent(workspaceId: string, agentId: string, limit: number): Promise<EvalSuiteRunRow[]> {
    return suiteRepo.listByAgent(this.db, workspaceId, agentId, limit);
  }
  listRecentSuites(workspaceId: string, limit: number): Promise<EvalSuiteRunRow[]> {
    return suiteRepo.listRecentByWorkspace(this.db, workspaceId, limit);
  }
  reapStaleRunningSuites(): Promise<number> {
    return suiteRepo.reapStaleRunningSuites(this.db);
  }
  deleteSuitesByAgent(workspaceId: string, agentId: string): Promise<number> {
    return suiteRepo.deleteByAgent(this.db, workspaceId, agentId);
  }

  // ---- skill (differential) suite runs ------------------------------------
  insertSkillSuite(values: {
    workspaceId: string;
    skillId: string;
    skillVersion: number;
    hostAgentId: string;
    hostAgentVersion: number;
  }): Promise<EvalSkillSuiteRunRow> {
    return skillSuiteRepo.insertSuite(this.db, values);
  }
  oneRunningForSkill(
    workspaceId: string,
    skillId: string,
  ): Promise<EvalSkillSuiteRunRow | undefined> {
    return skillSuiteRepo.oneRunningForSkill(this.db, workspaceId, skillId);
  }
  setSkillSuiteTerminal(
    suiteId: string,
    values: skillSuiteRepo.SkillSuiteTerminalValues,
  ): Promise<void> {
    return skillSuiteRepo.setTerminal(this.db, suiteId, values);
  }
  getSkillSuite(workspaceId: string, id: string): Promise<EvalSkillSuiteRunRow | undefined> {
    return skillSuiteRepo.getSuite(this.db, workspaceId, id);
  }
  listSkillSuitesBySkill(
    workspaceId: string,
    skillId: string,
    limit: number,
  ): Promise<EvalSkillSuiteRunRow[]> {
    return skillSuiteRepo.listBySkill(this.db, workspaceId, skillId, limit);
  }
  listRecentSkillSuites(workspaceId: string, limit: number): Promise<EvalSkillSuiteRunRow[]> {
    return skillSuiteRepo.listRecentByWorkspace(this.db, workspaceId, limit);
  }
  reapStaleRunningSkillSuites(): Promise<number> {
    return skillSuiteRepo.reapStaleRunningSkillSuites(this.db);
  }
  deleteSkillSuitesBySkill(workspaceId: string, skillId: string): Promise<number> {
    return skillSuiteRepo.deleteBySkill(this.db, workspaceId, skillId);
  }

  // ---- per-case runs ------------------------------------------------------
  insertRun(values: runRepo.InsertRunValues): Promise<EvalRunRow> {
    return runRepo.insertRun(this.db, values);
  }
  listRunsBySuite(suiteRunId: string): Promise<EvalRunRow[]> {
    return runRepo.listBySuite(this.db, suiteRunId);
  }
  listRunsBySkillSuite(skillSuiteRunId: string): Promise<EvalRunRow[]> {
    return runRepo.listBySkillSuite(this.db, skillSuiteRunId);
  }
  listRunsByCases(caseIds: string[]): Promise<EvalRunRow[]> {
    return runRepo.listByCases(this.db, caseIds);
  }

  // ---- skill reads (thin, on this module's OWN db) ------------------------
  // The skills repo is module-private (server/INSIGHTS 2026-07-04:
  // `container.skillsRepo` does NOT exist), so the differential path reads the
  // skill body + `skill_versions.body` via these thin reads on the eval
  // module's own `db` rather than constructing/deep-importing SkillsRepository.

  /** A single skill row, workspace-scoped (existence + body/version for a delta run). */
  async getSkill(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /**
   * All skills in a workspace (for the all-skills dashboard — AC-24). Same
   * sanctioned "thin read on the eval module's OWN db" pattern as `getSkill`:
   * the skills repo is module-private (server/INSIGHTS 2026-07-04), so the
   * differential path lists skills here rather than constructing/deep-importing
   * `SkillsRepository`. Insertion order is stable so the dashboard doesn't
   * reshuffle on edit.
   */
  async listSkills(workspaceId: string): Promise<SkillRow[]> {
    return this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId))
      .orderBy(asc(t.skills.createdAt));
  }

  /**
   * The immutable body of a specific skill version (for compare — AC-28). Returns
   * `undefined` when that version was never snapshotted (→ "body unavailable").
   */
  async getSkillVersionBody(skillId: string, version: number): Promise<string | undefined> {
    const [row] = await this.db
      .select({ body: t.skillVersions.body })
      .from(t.skillVersions)
      .where(
        and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)),
      );
    return row?.body;
  }
}
