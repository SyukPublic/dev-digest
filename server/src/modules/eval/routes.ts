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
}
