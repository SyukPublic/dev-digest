import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Container } from '../../platform/container.js';
import type { ConventionCandidate } from '@devdigest/shared';
import { extractConventions } from '@devdigest/reviewer-core';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsRepository, type InsertConvention, type UpdateConvention } from './repository.js';
import { extractConfigConventions } from './config-extractor.js';
import { toConventionDto, verifyAndCorroborate, dedupeDrafts, type ConventionDraft } from './helpers.js';
import {
  CONFIG_FILES,
  DEFAULT_EXTRACTION_MODEL,
  DEFAULT_EXTRACTION_PROVIDER,
  EXTRACT_CONVENTIONS_JOB_KIND,
  EXTRACTION_MAX_RETRIES,
  EXTRACTION_TIMEOUT_MS,
  MIN_CONFIDENCE,
  SAMPLE_FILE_COUNT,
} from './constants.js';

/**
 * Conventions Extractor — service / use cases.
 *
 * The scan runs as a background job (mirrors clone/index): config files are
 * parsed deterministically (no LLM); source samples go through a cheap LLM whose
 * every claim is VERIFIED against disk before it's trusted; results are merged,
 * deduped, and snapshotted via `replaceAll`. No HTTP, no raw SQL here.
 */

export interface ExtractJobPayload {
  workspaceId: string;
  repoId: string;
}

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  /** Register the extract/re-scan job handler once (called from routes at boot). */
  registerExtractJobHandler(): void {
    this.container.jobs.register(EXTRACT_CONVENTIONS_JOB_KIND, async (payload) => {
      await this.runExtractJob(payload as ExtractJobPayload);
    });
  }

  /** Enqueue a scan for a repo. Throws NotFound if the repo isn't in the workspace. */
  async enqueueExtract(workspaceId: string, repoId: string): Promise<string> {
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    const job = await this.container.jobs.enqueue(workspaceId, EXTRACT_CONVENTIONS_JOB_KIND, {
      workspaceId,
      repoId,
    } satisfies ExtractJobPayload);
    return job.id;
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toConventionDto);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toConventionDto(row) : undefined;
  }

  /**
   * The scan body. Best-effort by design: the deterministic config rules are
   * always produced; the LLM pass is additive and swallowed on failure (e.g. no
   * OPENROUTER_API_KEY), so a key-less workspace still gets config conventions.
   */
  async runExtractJob(payload: ExtractJobPayload): Promise<void> {
    const { workspaceId, repoId } = payload;
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo || !repo.clonePath) return; // not cloned yet → nothing to scan
    const clonePath = repo.clonePath;

    // 1. Deterministic config-derived rules (no LLM).
    const configContents: Record<string, string | null> = {};
    await Promise.all(
      CONFIG_FILES.map(async (f) => {
        configContents[f] = await readClone(clonePath, f);
      }),
    );
    const configDrafts = extractConfigConventions(configContents);

    // 2. Source samples (top-ranked, tests/configs excluded) → read contents.
    const samplePaths = await this.container.repoIntel.getConventionSamples(repoId, SAMPLE_FILE_COUNT);
    const contents = new Map<string, string>();
    await Promise.all(
      samplePaths.map(async (p) => {
        const c = await readClone(clonePath, p);
        if (c !== null) contents.set(p, c);
      }),
    );

    // 3. LLM extraction → verify every claim against disk → corroborate.
    let llmDrafts: ConventionDraft[] = [];
    if (contents.size > 0) {
      try {
        const llm = await this.container.llm(DEFAULT_EXTRACTION_PROVIDER);
        const outcome = await extractConventions({
          llm,
          model: DEFAULT_EXTRACTION_MODEL,
          repoName: repo.fullName,
          samples: [...contents].map(([path, content]) => ({ path, content })),
          minConfidence: MIN_CONFIDENCE,
          maxRetries: EXTRACTION_MAX_RETRIES,
          timeoutMs: EXTRACTION_TIMEOUT_MS,
          sessionId: `conventions:${repo.fullName}`,
        });
        llmDrafts = outcome.candidates
          .map((c) => verifyAndCorroborate(c, contents))
          .filter((d): d is ConventionDraft => d !== null)
          .filter((d) => d.confidence >= MIN_CONFIDENCE);
      } catch {
        // No key / model / network error — keep the deterministic config rules.
      }
    }

    // 4. Merge + dedup (config wins), then snapshot.
    const drafts = dedupeDrafts(configDrafts, llmDrafts);
    const extractedAt = new Date();
    const rows: InsertConvention[] = drafts.map((d) => ({
      workspaceId,
      repoId,
      rule: d.rule,
      evidencePath: d.evidencePath,
      evidenceSnippet: d.evidenceSnippet,
      confidence: d.confidence,
      category: d.category,
      source: d.source,
      occurrences: d.occurrences,
      extractedAt,
    }));
    await this.repo.replaceAll(workspaceId, repoId, rows);
  }
}

/** Read a file from the clone, returning null if it doesn't exist / can't be read. */
async function readClone(clonePath: string, file: string): Promise<string | null> {
  return readFile(join(clonePath, file), 'utf8').catch(() => null);
}
