import type { Container } from '../../platform/container.js';
import type {
  CreateMemory,
  Memory,
  MemoryList,
  MemoryListQuery,
  UpdateMemory,
} from '@devdigest/shared';
import type { MemoryPulled } from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { MemoryRepository, type MemoryRow } from './repository.js';
import { firstSourcePr, toMemoryDto } from './helpers.js';
import { INJECTION_TOP_N, SEARCH_TOP_N, SIMILARITY_THRESHOLD, STALE_DAYS } from './constants.js';

/**
 * Semantic search requested (`q` supplied) but embeddings are disabled. The
 * route lets this propagate so the client's SEARCH query surfaces the AC-20
 * error state, while its (separate) non-semantic list query stays usable.
 */
export class SemanticUnavailableError extends AppError {
  constructor() {
    super(
      'embeddings_disabled',
      'Semantic search is unavailable because embeddings are disabled.',
      503,
    );
  }
}

/**
 * Review Memory — service / use cases (Onion rule 6: routes stay thin). Owns its
 * own module-private `MemoryRepository(container.db)`. Embeddings run through
 * `container.embedder()` (gated by EMBEDDINGS_ENABLED; throws ConfigError when
 * off) and are ALWAYS best-effort: create/update persist the row even when
 * embeddings are unavailable (AC-11 edge); retrieval degrades to no-op.
 */
export class MemoryService {
  private repo: MemoryRepository;

  constructor(private container: Container) {
    this.repo = new MemoryRepository(container.db);
  }

  /**
   * List (+ facet counts + total). When `q` is supplied the items come from a
   * semantic cosine search (throws SemanticUnavailableError when embeddings are
   * off); otherwise from the filtered list. Facets/total always reflect the full
   * visible set, independent of `q`.
   */
  async list(workspaceId: string, query: MemoryListQuery): Promise<MemoryList> {
    const repoId = query.repo_id ?? null;
    const facets = await this.repo.countFacets(workspaceId, repoId);
    const total = Object.values(facets.scope).reduce((a, b) => a + b, 0);

    const q = query.q?.trim();
    let rows: MemoryRow[];
    if (q) {
      rows = await this.searchRows(workspaceId, repoId, q);
    } else {
      rows = await this.repo.list(workspaceId, {
        repoId,
        ...(query.scope ? { scope: query.scope } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.stale ? { stale: true, staleBefore: this.staleCutoff() } : {}),
      });
    }
    return { items: rows.map(toMemoryDto), facets, total };
  }

  async getById(workspaceId: string, id: string): Promise<Memory | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toMemoryDto(row) : undefined;
  }

  /** Create — persists workspace-scoped, embeds content best-effort (AC-4/11). */
  async create(workspaceId: string, dto: CreateMemory): Promise<Memory> {
    const repoId = dto.scope === 'repo' ? (dto.repo_id ?? null) : null;
    const embedding = await this.embedContent(dto.content);
    const row = await this.repo.insert({
      workspaceId,
      repoId,
      scope: dto.scope,
      kind: dto.kind,
      content: dto.content,
      confidence: dto.confidence,
      sources: dto.sources ?? [],
      embedding,
    });
    return toMemoryDto(row);
  }

  /**
   * Update — known fields only. Re-embeds ONLY when content actually changed
   * (AC-5). Returns undefined when the entry isn't in the workspace (AC-8).
   */
  async update(workspaceId: string, id: string, dto: UpdateMemory): Promise<Memory | undefined> {
    const existing = await this.repo.getById(workspaceId, id);
    if (!existing) return undefined;

    const patch: Parameters<MemoryRepository['update']>[2] = { updatedAt: new Date() };
    if (dto.content !== undefined) patch.content = dto.content;
    if (dto.kind !== undefined) patch.kind = dto.kind;
    if (dto.confidence !== undefined) patch.confidence = dto.confidence;
    if (dto.sources !== undefined) patch.sources = dto.sources;
    if (dto.scope !== undefined) {
      patch.scope = dto.scope;
      patch.repoId = dto.scope === 'repo' ? (dto.repo_id ?? existing.repoId) : null;
    } else if (dto.repo_id !== undefined) {
      patch.repoId = dto.repo_id;
    }
    // Re-embed only when the content text changed (AC-5). Best-effort: a failed
    // embed still persists the new content (embedding stays as-is).
    if (dto.content !== undefined && dto.content !== existing.content) {
      const embedding = await this.embedContent(dto.content);
      if (embedding) patch.embedding = embedding;
    }

    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toMemoryDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.delete(workspaceId, id);
  }

  /**
   * Retrieve the most relevant memory for a review (AC-9/10/11). Best-effort:
   * embeddings off / retrieval failure → `{ items: [], pulled: [] }` so the
   * review never fails. Stamps `last_used_at` ONCE on the matched ids (AC-10).
   */
  async retrieveRelevant(
    workspaceId: string,
    repoId: string | null,
    queryText: string,
  ): Promise<{ items: string[]; pulled: MemoryPulled[] }> {
    const text = queryText.trim();
    if (!text) return { items: [], pulled: [] };
    try {
      const embedder = await this.container.embedder();
      const [vector] = await embedder.embed([text]);
      if (!vector) return { items: [], pulled: [] };
      const rows = await this.repo.searchByCosine(workspaceId, {
        repoId,
        queryVector: vector,
        limit: INJECTION_TOP_N,
        threshold: SIMILARITY_THRESHOLD,
      });
      if (rows.length === 0) return { items: [], pulled: [] };
      await this.repo.touchLastUsed(workspaceId, rows.map((r) => r.id));
      const items = rows.map((r) => r.content);
      const pulled: MemoryPulled[] = rows.map((r) => {
        const pr = firstSourcePr(r.sources);
        return { text: r.content, ...(pr != null ? { pr } : {}) };
      });
      return { items, pulled };
    } catch {
      // ConfigError (embeddings off) or any retrieval failure → degrade (AC-11).
      return { items: [], pulled: [] };
    }
  }

  // ---- internals ----------------------------------------------------------

  /** Cosine search for the studio list `q`. Throws when embeddings are off. */
  private async searchRows(
    workspaceId: string,
    repoId: string | null,
    q: string,
  ): Promise<MemoryRow[]> {
    let vector: number[] | undefined;
    try {
      const embedder = await this.container.embedder();
      [vector] = await embedder.embed([q]);
    } catch {
      throw new SemanticUnavailableError();
    }
    if (!vector) return [];
    return this.repo.searchByCosine(workspaceId, {
      repoId,
      queryVector: vector,
      limit: SEARCH_TOP_N,
      threshold: SIMILARITY_THRESHOLD,
    });
  }

  /** Embed content best-effort; null when embeddings are disabled/failed. */
  private async embedContent(content: string): Promise<number[] | null> {
    try {
      const embedder = await this.container.embedder();
      const [vector] = await embedder.embed([content]);
      return vector ?? null;
    } catch {
      return null;
    }
  }

  private staleCutoff(): Date {
    return new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
  }
}
