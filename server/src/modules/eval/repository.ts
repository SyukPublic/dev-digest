import type { Db } from '../../db/client.js';
import type { EvalCaseRow, EvalRunRow, EvalSuiteRunRow } from '../../db/rows.js';

import * as caseRepo from './repository/eval-case.repo.js';
import * as suiteRepo from './repository/eval-suite.repo.js';
import * as runRepo from './repository/eval-run.repo.js';

export type { EvalCaseRow, EvalRunRow, EvalSuiteRunRow };

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

  // ---- per-case runs ------------------------------------------------------
  insertRun(values: runRepo.InsertRunValues): Promise<EvalRunRow> {
    return runRepo.insertRun(this.db, values);
  }
  listRunsBySuite(suiteRunId: string): Promise<EvalRunRow[]> {
    return runRepo.listBySuite(this.db, suiteRunId);
  }
  listRunsByCases(caseIds: string[]): Promise<EvalRunRow[]> {
    return runRepo.listByCases(this.db, caseIds);
  }
}
