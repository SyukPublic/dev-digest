import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillSource, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { SkillsService } from './service.js';

/** `/skills/:id/versions/:version` — id is a uuid, version a positive integer. */
const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

/**
 * A1 — skills module (owner A1). A skill is reusable text + config shared across
 * agents; agents link skills via the agents module (`POST /agents/:id/skills`).
 *   GET    /skills                        → list (workspace-scoped)
 *   GET    /skills/:id                    → one skill
 *   POST   /skills                        → create (manual) / save an import preview
 *   PUT    /skills/:id                    → update / toggle enabled (versions body)
 *   DELETE /skills/:id                    → delete
 *   GET    /skills/:id/versions           → body history (newest first)
 *   GET    /skills/:id/versions/:version  → one body snapshot
 *   POST   /skills/import                 → parse a file/URL into a PREVIEW (no save)
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: SkillType,
  source: SkillSource.optional(),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string()).optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

/** Import from a URL, or from an uploaded file (utf8 markdown, or base64 bytes
 *  for a .zip archive). */
const ImportSkillBody = z
  .object({
    kind: z.enum(['url', 'file']),
    url: z.string().url().optional(),
    filename: z.string().optional(),
    data: z.string().optional(),
    encoding: z.enum(['utf8', 'base64']).default('utf8'),
  })
  .refine((b) => (b.kind === 'url' ? !!b.url : b.data !== undefined), {
    message: 'Provide `url` for kind=url, or `data` for kind=file',
  });

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = req.body;
    const skill = await service.create(workspaceId, {
      name: body.name,
      type: body.type,
      body: body.body,
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.evidence_files !== undefined ? { evidenceFiles: body.evidence_files } : {}),
    });
    reply.status(201);
    return skill;
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: UpdateSkillBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.update(workspaceId, req.params.id, req.body);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.get(
    '/skills/:id/versions/:version',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const version = await service.getVersion(workspaceId, req.params.id, req.params.version);
      if (!version) throw new NotFoundError('Skill version not found');
      return version;
    },
  );

  app.post('/skills/import', { schema: { body: ImportSkillBody } }, async (req) => {
    await getContext(app.container, req);
    const b = req.body;
    return b.kind === 'url'
      ? service.importPreview({ kind: 'url', url: b.url! })
      : service.importPreview({
          kind: 'file',
          data: b.data!,
          encoding: b.encoding,
          ...(b.filename !== undefined ? { filename: b.filename } : {}),
        });
  });
}
