import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  SettingsUpdate,
  ConnTestRequest,
  ConnTestResult,
  SecretsStatus,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { SettingsService } from './service.js';

/**
 * F1 — settings module. Transport layer only: parses requests and delegates to
 * SettingsService.
 *   GET  /settings                 → current non-secret prefs
 *   GET  /settings/secrets-status  → which provider keys are configured (booleans)
 *   PUT  /settings                 → upsert prefs (key/value rows)
 *   POST /settings/test-connection → test a provider key (OpenAI/Anthropic/GitHub)
 *
 * Secrets are NOT stored here — only non-secret prefs. test-connection reads the
 * key via SecretsProvider and does a cheap live call (listModels / GET user).
 *
 * NOTE: GET/PUT /settings have no response schema on purpose — the `Settings`
 * contract carries Zod defaults, and serializing through it would inject those
 * defaults into the response (a behavior change). The two endpoints whose
 * contracts have no defaults are serialized through their schema.
 */
export default async function settingsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SettingsService(app.container);

  app.get('/settings', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getSettings(workspaceId);
  });

  app.get(
    '/settings/secrets-status',
    { schema: { response: { 200: SecretsStatus } } },
    async (req) => {
      await getContext(app.container, req);
      return service.secretsStatus();
    },
  );

  app.put('/settings', { schema: { body: SettingsUpdate } }, async (req) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    return service.updateSettings(workspaceId, userId, req.body);
  });

  app.post(
    '/settings/test-connection',
    {
      schema: { body: ConnTestRequest, response: { 200: ConnTestResult } },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      return service.testConnection(req.body);
    },
  );
}
