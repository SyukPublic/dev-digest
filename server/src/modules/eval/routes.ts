import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EvalCaseInput,
  EvalCase,
  EvalCaseListItem,
  EvalSuiteRunAccepted,
  RunAllResult,
  EvalRunResult,
  EvalSuiteDetail,
  EvalAgentDashboard,
  EvalWorkspaceDashboard,
  EvalCompareResult,
  EvalCaseDraft,
  EvalSkillRunRequest,
  EvalSkillSuiteRunAccepted,
  RunAllSkillsResult,
  EvalSkillSuiteDetail,
  EvalSkillsWorkspaceDashboard,
  EvalSkillCompareResult,
  EvalSkillHostCandidates,
  EvalSkillStabilityRequest,
  EvalSkillStabilityGroupAccepted,
  EvalSkillStabilityDetail,
  EvalSkillDashboardWithStability,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EvalService } from './service.js';
import { EVAL_RUN_RATE_LIMIT } from './constants.js';

/**
 * L06 Agent Eval Pipeline routes — a thin edge (onion rule 6): read context +
 * auth, parse with the contract, call one service method, return its result.
 *
 *   POST   /findings/:id/eval-case      → create a case from a decided finding
 *   GET    /findings/:id/eval-case/preview → derive (don't persist) a case draft from a finding
 *   POST   /eval-cases                  → create a manual case
 *   PUT    /eval-cases/:id              → update a manual case
 *   DELETE /eval-cases/:id              → delete a case
 *   GET    /eval-cases/:id              → one case (Case Editor)
 *   GET    /agents/:id/eval-cases       → an agent's eval-case list items
 *   POST   /agents/:id/eval-runs        → start a suite (rate-limited)
 *   POST   /eval-runs/all               → run all enabled agents (rate-limited)
 *   POST   /eval-cases/:id/run          → run a single case (rate-limited)
 *   GET    /eval-runs/:id               → a suite + its per-case rows
 *   GET    /agents/:id/eval-dashboard   → per-agent dashboard aggregate
 *   GET    /eval-dashboard              → all-agents dashboard aggregate
 *   GET    /eval-compare?a=&b=          → compare two suite runs
 *
 *   ── Differential (skill) surface ──
 *   GET    /skills/:id/eval-cases       → a skill's eval-case list items
 *   GET    /skills/:id/eval-hosts       → candidate host agents (+ default)
 *   POST   /skills/:id/eval-runs        → start a differential suite (rate-limited)
 *   POST   /skill-eval-runs/all         → run every runnable skill (rate-limited)
 *   POST   /eval-cases/:id/skill-run    → run a single skill case (rate-limited)
 *   GET    /skill-eval-runs/:id         → a skill suite + its per-case delta rows
 *   GET    /skills/:id/eval-dashboard   → per-skill dashboard aggregate (+ stability)
 *   GET    /skill-eval-dashboard        → all-skills dashboard aggregate
 *   GET    /skill-eval-compare?a=&b=    → compare two skill suite runs
 *
 *   ── Stability layer (N-repeat + variance + noise-aware alert) ──
 *   POST   /skills/:id/stability-runs   → start a stability group (rate-limited)
 *   GET    /skill-stability-runs/:id    → a group + variance summary + per-case flags
 */
const CompareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new EvalService(container);

  // ---- Case creation ------------------------------------------------------
  app.post(
    '/findings/:id/eval-case',
    { schema: { params: IdParams, response: { 201: EvalCase } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const created = await service.createCaseFromFinding(workspaceId, req.params.id);
      reply.status(201);
      return created;
    },
  );

  // Derive a case draft from a finding WITHOUT persisting — the PR "Turn into
  // eval case" flow opens the Case Editor on this draft; Save then creates the
  // case via POST /eval-cases. Same AC-3/AC-4 guards as the create path.
  app.get(
    '/findings/:id/eval-case/preview',
    { schema: { params: IdParams, response: { 200: EvalCaseDraft } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.previewCaseFromFinding(workspaceId, req.params.id);
    },
  );

  app.post(
    '/eval-cases',
    { schema: { body: EvalCaseInput, response: { 201: EvalCase } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const created = await service.createCase(workspaceId, req.body);
      reply.status(201);
      return created;
    },
  );

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: EvalCaseInput, response: { 200: EvalCase } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.updateCase(workspaceId, req.params.id, req.body);
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteCase(workspaceId, req.params.id);
    return { ok };
  });

  app.get(
    '/eval-cases/:id',
    { schema: { params: IdParams, response: { 200: EvalCase } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getCase(workspaceId, req.params.id);
    },
  );

  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: z.array(EvalCaseListItem) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listAgentCases(workspaceId, req.params.id);
    },
  );

  // ---- Suite / run execution (rate-limited: fans out to LLM runs) ---------
  app.post(
    '/agents/:id/eval-runs',
    {
      schema: { params: IdParams, response: { 200: EvalSuiteRunAccepted } },
      config: { rateLimit: EVAL_RUN_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.startSuite(workspaceId, req.params.id, req.log);
    },
  );

  app.post(
    '/eval-runs/all',
    {
      schema: { response: { 200: RunAllResult } },
      config: { rateLimit: EVAL_RUN_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.runAllAgents(workspaceId, req.log);
    },
  );

  app.post(
    '/eval-cases/:id/run',
    {
      schema: { params: IdParams, response: { 200: EvalRunResult } },
      config: { rateLimit: EVAL_RUN_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.runSingleCase(workspaceId, req.params.id);
    },
  );

  app.get(
    '/eval-runs/:id',
    { schema: { params: IdParams, response: { 200: EvalSuiteDetail } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getSuiteDetail(workspaceId, req.params.id);
    },
  );

  // ---- Dashboards + compare ----------------------------------------------
  app.get(
    '/agents/:id/eval-dashboard',
    { schema: { params: IdParams, response: { 200: EvalAgentDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.buildAgentDashboard(workspaceId, req.params.id);
    },
  );

  app.get(
    '/eval-dashboard',
    { schema: { response: { 200: EvalWorkspaceDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.buildWorkspaceDashboard(workspaceId);
    },
  );

  app.get(
    '/eval-compare',
    { schema: { querystring: CompareQuery, response: { 200: EvalCompareResult } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.compareRuns(workspaceId, req.query.a, req.query.b);
    },
  );

  // ---- Differential (skill) surface --------------------------------------
  app.get(
    '/skills/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: z.array(EvalCaseListItem) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listSkillCases(workspaceId, req.params.id);
    },
  );

  app.get(
    '/skills/:id/eval-hosts',
    { schema: { params: IdParams, response: { 200: EvalSkillHostCandidates } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.resolveSkillHosts(workspaceId, req.params.id);
    },
  );

  // Rate-limited: a differential run is a 2×-per-case LLM fan-out.
  app.post(
    '/skills/:id/eval-runs',
    {
      schema: { params: IdParams, body: EvalSkillRunRequest, response: { 200: EvalSkillSuiteRunAccepted } },
      config: { rateLimit: EVAL_RUN_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.startSkillSuite(workspaceId, req.params.id, req.body.host_agent_id, req.log);
    },
  );

  app.post(
    '/skill-eval-runs/all',
    {
      schema: { response: { 200: RunAllSkillsResult } },
      config: { rateLimit: EVAL_RUN_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.runAllSkills(workspaceId, req.log);
    },
  );

  app.post(
    '/eval-cases/:id/skill-run',
    {
      schema: { params: IdParams, body: EvalSkillRunRequest, response: { 200: EvalRunResult } },
      config: { rateLimit: EVAL_RUN_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.runSingleSkillCase(workspaceId, req.params.id, req.body.host_agent_id);
    },
  );

  app.get(
    '/skill-eval-runs/:id',
    { schema: { params: IdParams, response: { 200: EvalSkillSuiteDetail } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getSkillSuiteDetail(workspaceId, req.params.id);
    },
  );

  app.get(
    '/skills/:id/eval-dashboard',
    { schema: { params: IdParams, response: { 200: EvalSkillDashboardWithStability } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.buildSkillDashboard(workspaceId, req.params.id);
    },
  );

  // ---- Stability layer (N-repeat + variance + noise-aware alert) ----------
  // Rate-limited: a stability group is a `2 × N × cases` LLM fan-out.
  app.post(
    '/skills/:id/stability-runs',
    {
      schema: {
        params: IdParams,
        body: EvalSkillStabilityRequest,
        response: { 200: EvalSkillStabilityGroupAccepted },
      },
      config: { rateLimit: EVAL_RUN_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.startSkillStabilityGroup(
        workspaceId,
        req.params.id,
        req.body.host_agent_id,
        req.body.n,
        req.log,
      );
    },
  );

  app.get(
    '/skill-stability-runs/:id',
    { schema: { params: IdParams, response: { 200: EvalSkillStabilityDetail } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getSkillStabilityDetail(workspaceId, req.params.id);
    },
  );

  app.get(
    '/skill-eval-dashboard',
    { schema: { response: { 200: EvalSkillsWorkspaceDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.buildSkillsWorkspaceDashboard(workspaceId);
    },
  );

  app.get(
    '/skill-eval-compare',
    { schema: { querystring: CompareQuery, response: { 200: EvalSkillCompareResult } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.compareSkillRuns(workspaceId, req.query.a, req.query.b);
    },
  );
}
