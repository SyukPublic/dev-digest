import type { Container } from '../../platform/container.js';
import type { Skill, SkillImportPreview, SkillSource, SkillType, SkillVersion } from '@devdigest/shared';
import { ExternalServiceError, ValidationError } from '../../platform/errors.js';
import { SkillsRepository } from './repository.js';
import { DEFAULT_SKILL_TYPE } from './constants.js';
import {
  deriveSkillDescription,
  deriveSkillName,
  isTrustedSource,
  toSkillDto,
  toSkillVersionDto,
} from './helpers.js';

/**
 * A1 — skills service. Business logic for the Skills tab + Skill Editor. A skill
 * is pure text (markdown body) + config (name/description/type/enabled); it can
 * NOT execute anything. Body changes are versioned via `skill_versions`.
 *
 * Import is two-step: `importPreview` parses an upload/URL into an unsaved
 * preview (no DB write); the client then calls `create` to persist it. Imported
 * skills are disabled-until-vetted (someone else's instructions in the prompt).
 */

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

/** A file or URL to parse into a preview (no persistence). */
export type ImportSkillInput =
  | { kind: 'url'; url: string }
  | { kind: 'file'; filename?: string; data: string; encoding: 'utf8' | 'base64' };

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const source = input.source ?? 'manual';
    // Imported/community skills are untrusted → default to disabled until the
    // user vets and enables them. Manual skills default enabled (schema default).
    const enabled = input.enabled ?? isTrustedSource(source);
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description ?? '',
      type: input.type,
      source,
      body: input.body,
      enabled,
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    return row ? toSkillDto(row) : undefined;
  }

  /** Body version history, newest first. Undefined when the skill isn't in this
   *  workspace (route → 404), so snapshots can't be read across tenants. */
  async listVersions(workspaceId: string, skillId: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(skillId);
    return rows.map(toSkillVersionDto);
  }

  async getVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<SkillVersion | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const row = await this.repo.getVersion(skillId, version);
    return row ? toSkillVersionDto(row) : undefined;
  }

  /**
   * Parse an upload/URL into an UNSAVED preview. Only the markdown core is read;
   * executable parts of an archive are never processed. Nothing is persisted —
   * the client confirms, then calls `create`.
   */
  async importPreview(input: ImportSkillInput): Promise<SkillImportPreview> {
    let body: string;
    let origin: string | undefined;

    if (input.kind === 'url') {
      body = await this.fetchOrThrow(() => this.container.skillImporter.fetchUrl(input.url));
      origin = input.url;
    } else if (input.encoding === 'base64') {
      const bytes = Buffer.from(input.data, 'base64');
      if (looksLikeZip(input.filename, bytes)) {
        const r = await this.fetchOrThrow(() =>
          this.container.skillImporter.extractFromArchive(bytes),
        );
        body = r.body;
        origin = r.entry;
      } else {
        body = bytes.toString('utf8');
        origin = input.filename;
      }
    } else {
      body = input.data;
      origin = input.filename;
    }

    if (body.trim().length === 0) {
      throw new ValidationError('Import produced an empty skill body');
    }

    // All imports land in the generic "imported" bucket — untrusted, displayed
    // as "Imported", disabled-until-vetted when saved.
    return {
      name: deriveSkillName(body),
      description: deriveSkillDescription(body),
      type: DEFAULT_SKILL_TYPE,
      source: 'imported_url',
      body,
      origin: origin ?? null,
    };
  }

  /** Run an import adapter call, mapping its failures to a clean 502. */
  private async fetchOrThrow<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw new ExternalServiceError(`Import failed: ${(err as Error).message}`);
    }
  }
}

/** Zip magic bytes ("PK\x03\x04") or a .zip filename. */
function looksLikeZip(filename: string | undefined, bytes: Buffer): boolean {
  if (filename && /\.zip$/i.test(filename)) return true;
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
