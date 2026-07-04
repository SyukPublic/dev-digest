import { resolve, sep } from 'node:path';
import type { Container } from '../../platform/container.js';
import type {
  DiscoveredDocument,
  DocumentContent,
  RepoRef,
  SpecAttachment,
} from '@devdigest/shared';
import { FolderType, RepoRelativePath } from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { walkMarkdown } from './walk.js';

/**
 * project-context service — the producer side of the Project Context Folder.
 *
 * Orchestration only (onion): reaches external systems via the container
 * (`container.git` for the read-only clone, `container.tokenizer` for counts,
 * repos/agents repos + `container.projectContextRepo` for the DB). Zero
 * LLM/embedding calls (AC-23).
 *
 * Phase 1 = discovery/preview (`discover`/`content`); Phase 4 adds attach
 * persistence (`agentSpecs`/`setAgentSpecs`/…), the run-time MERGE resolver
 * (`resolveSpecPathsForAgent`, the AC-6/AC-7 ordering authority), and the
 * best-effort run-time read (`readSpecsForRun`).
 *
 * SECURITY (AC-22): the git adapter's `readFile` does a bare
 * `join(clonePathFor, path)` with NO traversal check, so the path-traversal
 * guard lives HERE — every content read (and every attach write) resolves the
 * path and asserts it is a descendant of `clonePathFor(repo)` / rejects `..`.
 */

/** Raw content + token count for a single discovered doc (service-internal). */
export interface DocumentContentResult extends DocumentContent {}

/**
 * A doc read at run time for injection, with its skip disposition. `ok` docs
 * carry `content`; skipped docs carry a `reason` (dangling/non-UTF-8/oversized)
 * for the trace/log (AC-11/12/13).
 */
export interface SpecReadResult {
  path: string;
  ok: boolean;
  content?: string;
  reason?: 'dangling' | 'non_utf8' | 'over_cap';
}

export class ProjectContextService {
  constructor(private container: Container) {}

  /** Configured discovery roots (env override or the sensible default). */
  private get roots(): readonly string[] {
    return this.container.config.projectContextRoots;
  }

  /** Per-file hard cap in bytes (env override or the sensible default). */
  private get fileHardCapBytes(): number {
    return this.container.config.projectContextFileHardCapBytes;
  }

  private get repo() {
    return this.container.projectContextRepo;
  }

  /**
   * Resolve a workspace-scoped repo into a `RepoRef` for git ops, or throw 404.
   * The workspace scope is the AC-20 tenancy guard: a repo in another workspace
   * is invisible here.
   */
  private async repoRef(workspaceId: string, repoId: string): Promise<RepoRef> {
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');
    return { owner: repo.owner, name: repo.name };
  }

  /**
   * Discover every markdown doc under the configured roots in the repo's clone,
   * each with its repo-relative path, `folder_type` badge, and token count.
   *
   * Degrades to an EMPTY list (never throws) when the clone or roots are absent
   * (AC-16). Zero LLM/embedding calls (AC-23). `used_by_agents` is populated
   * deterministically from the enabled agents' merged context (AC-17).
   */
  async discover(workspaceId: string, repoId: string): Promise<DiscoveredDocument[]> {
    const ref = await this.repoRef(workspaceId, repoId);
    const cloneRoot = this.container.git.clonePathFor(ref);
    const docs = await walkMarkdown(cloneRoot, this.roots, this.fileHardCapBytes);

    // Deterministic "used by N agents" per path (AC-17): count enabled agents
    // whose MERGED context (agent-attached ∪ skill-inherited, deduped) includes
    // the path. Best-effort — a failure degrades to 0, never aborts discovery.
    const usedBy = await this.usedByAgentCounts(workspaceId).catch(
      () => new Map<string, number>(),
    );

    const out: DiscoveredDocument[] = [];
    for (const doc of docs) {
      // Best-effort token count: a read failure on a just-walked file must not
      // abort discovery — degrade that doc to 0 tokens rather than throw.
      let tokens = 0;
      try {
        const content = await this.readWithinClone(ref, doc.path);
        tokens = content.length === 0 ? 0 : this.container.tokenizer.count(content);
      } catch {
        tokens = 0;
      }
      out.push({
        path: doc.path,
        folder_type: folderTypeOf(doc.path),
        tokens,
        used_by_agents: usedBy.get(doc.path) ?? 0,
      });
    }
    return out;
  }

  /**
   * Read a single discovered doc's raw UTF-8 content + token count.
   *
   * Enforces the path-traversal guard (AC-22): a path escaping the clone root
   * (`../`, absolute) is rejected BEFORE any filesystem read. A path that does
   * not resolve to an existing file 404s. Tokens are `0` for an empty file
   * (AC-8). Zero LLM/embedding calls (AC-23).
   */
  async content(
    workspaceId: string,
    repoId: string,
    path: string,
  ): Promise<DocumentContentResult> {
    const ref = await this.repoRef(workspaceId, repoId);

    let content: string;
    try {
      content = await this.readWithinClone(ref, path);
    } catch (err) {
      if (err instanceof ValidationError) throw err; // traversal → 422
      throw new NotFoundError('Document not found'); // dangling/unreadable → 404
    }

    return {
      path,
      folder_type: folderTypeOf(path),
      content,
      tokens: content.length === 0 ? 0 : this.container.tokenizer.count(content),
    };
  }

  // ---- Attach persistence (CP-3/CP-4) -------------------------------------

  /** Docs attached to an agent, ordered (AC-5). Throws 404 for a foreign/absent agent. */
  async agentSpecs(workspaceId: string, agentId: string): Promise<SpecAttachment[]> {
    await this.assertAgent(workspaceId, agentId);
    return this.repo.attachedSpecsForAgent(workspaceId, agentId);
  }

  /**
   * Replace the full ordered set of docs attached to an agent with `paths`.
   * Validates every path (AC-22: reject `..`/absolute) BEFORE persisting, and
   * stores the PATH only — never doc text (AC-5). Returns the persisted set.
   */
  async setAgentSpecs(
    workspaceId: string,
    agentId: string,
    paths: string[],
  ): Promise<SpecAttachment[]> {
    await this.assertAgent(workspaceId, agentId);
    const clean = validatePaths(paths);
    return this.repo.setAgentSpecs(workspaceId, agentId, clean);
  }

  /** Docs attached to a skill, ordered. Throws 404 for a foreign/absent skill. */
  async skillSpecs(workspaceId: string, skillId: string): Promise<SpecAttachment[]> {
    await this.assertSkill(workspaceId, skillId);
    return this.repo.attachedSpecsForSkill(workspaceId, skillId);
  }

  /** Replace the full ordered set of docs attached to a skill with `paths`. */
  async setSkillSpecs(
    workspaceId: string,
    skillId: string,
    paths: string[],
  ): Promise<SpecAttachment[]> {
    await this.assertSkill(workspaceId, skillId);
    const clean = validatePaths(paths);
    return this.repo.setSkillSpecs(workspaceId, skillId, clean);
  }

  // ---- Run-time merge resolver + best-effort read -------------------------

  /**
   * Resolve the ordered, deduped list of spec PATHS to inject for one agent on
   * a run — the AC-6/AC-7 ordering authority. Agent-attached docs come FIRST (in
   * their stored order), then skill-inherited docs (in the agent's enabled-skill
   * order, then each skill's own doc order). Deduped by NORMALIZED repo-relative
   * path, FIRST occurrence wins. Pure ordering lives in `mergeSpecPaths`; this
   * method only gathers the DB inputs (workspace-scoped).
   */
  async resolveSpecPathsForAgent(
    workspaceId: string,
    agentId: string,
    enabledSkillIds: string[],
  ): Promise<string[]> {
    const agentAttached = await this.repo.attachedSpecsForAgent(workspaceId, agentId);
    const bySkill = await this.repo.attachedSpecsForSkills(workspaceId, enabledSkillIds);
    return mergeSpecPaths(
      agentAttached.map((s) => s.path),
      enabledSkillIds.map((id) => (bySkill.get(id) ?? []).map((s) => s.path)),
    );
  }

  /**
   * Read each merged path from the clone for injection — BEST-EFFORT: a
   * dangling (AC-11), non-UTF-8 (AC-12), or over-the-hard-cap (AC-13) file is
   * SKIPPED (never truncated), not thrown, so a bad doc can never abort a run.
   * The traversal guard (AC-22) still applies. Returns one result per path in
   * order, each flagged ok/skipped-with-reason for the caller's trace/log.
   */
  async readSpecsForRun(
    workspaceId: string,
    repoId: string,
    paths: string[],
  ): Promise<SpecReadResult[]> {
    const ref = await this.repoRef(workspaceId, repoId);
    const cap = this.fileHardCapBytes;
    const out: SpecReadResult[] = [];
    for (const path of paths) {
      let content: string;
      try {
        content = await this.readWithinClone(ref, path);
      } catch {
        // Dangling / unreadable / traversal-rejected → skip, continue (AC-11).
        out.push({ path, ok: false, reason: 'dangling' });
        continue;
      }
      // Non-UTF-8 (AC-12): the git adapter decodes with 'utf8', replacing an
      // invalid byte with U+FFFD rather than throwing — the replacement char is
      // our signal that the file was not valid UTF-8. Skip-with-warning.
      if (content.includes('�')) {
        out.push({ path, ok: false, reason: 'non_utf8' });
        continue;
      }
      // Per-file HARD cap (AC-13): a single file over the cap is skipped, never
      // truncated. Measured over the decoded UTF-8 bytes (no fs stat via the
      // string-returning adapter).
      if (Buffer.byteLength(content, 'utf8') > cap) {
        out.push({ path, ok: false, reason: 'over_cap' });
        continue;
      }
      out.push({ path, ok: true, content });
    }
    return out;
  }

  // ---- helpers ------------------------------------------------------------

  /**
   * Path-traversal guard (AC-22) + read. Resolve the requested repo-relative
   * path against the clone root and assert the result stays INSIDE the clone
   * before delegating to the git adapter (whose `readFile` has no such check).
   * Throws `ValidationError` on an escaping/absolute path.
   */
  private async readWithinClone(ref: RepoRef, path: string): Promise<string> {
    const cloneRoot = this.container.git.clonePathFor(ref);
    assertWithinClone(cloneRoot, path);
    return this.container.git.readFile(ref, path);
  }

  /** Assert the agent exists in this workspace (AC-20), else 404. */
  private async assertAgent(workspaceId: string, agentId: string): Promise<void> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
  }

  /** Assert the skill exists in this workspace (AC-20), else 404. */
  private async assertSkill(workspaceId: string, skillId: string): Promise<void> {
    const exists = await this.repo.skillExists(workspaceId, skillId);
    if (!exists) throw new NotFoundError('Skill not found');
  }

  /**
   * Deterministic count of enabled agents whose MERGED context includes each
   * path (AC-17 `used_by_agents`). Computed over the same resolver the run uses,
   * so the count matches what a run would actually inject.
   */
  private async usedByAgentCounts(workspaceId: string): Promise<Map<string, number>> {
    const agents = await this.container.agentsRepo.listEnabled(workspaceId);
    const counts = new Map<string, number>();
    for (const agent of agents) {
      const enabledSkillIds = (await this.container.agentsRepo.linkedSkills(agent.id))
        .filter((l) => l.skill.enabled)
        .map((l) => l.skill.id);
      const paths = await this.resolveSpecPathsForAgent(
        workspaceId,
        agent.id,
        enabledSkillIds,
      );
      for (const p of paths) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return counts;
  }
}

/**
 * PURE merge/dedup resolver — the AC-6/AC-7 ordering authority, extracted for
 * direct unit testing. Agent-attached paths come FIRST (in the given order),
 * then skill-inherited paths (each skill's list in order, skills in the given
 * order). Deduped by NORMALIZED repo-relative path, FIRST occurrence wins; the
 * ORIGINAL (first-seen) path string is preserved in the output.
 *
 * @param agentPaths  paths attached directly to the agent, in stored order
 * @param skillPaths  per-enabled-skill path lists, skills already in order
 */
export function mergeSpecPaths(
  agentPaths: readonly string[],
  skillPaths: readonly (readonly string[])[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (path: string) => {
    const key = normalizeRepoPath(path);
    if (key.length === 0 || seen.has(key)) return;
    seen.add(key);
    out.push(path);
  };
  for (const p of agentPaths) push(p);
  for (const list of skillPaths) for (const p of list) push(p);
  return out;
}

/**
 * Normalize a repo-relative path for dedup: collapse `\` → `/`, drop a leading
 * `./` and any leading slash, collapse duplicate slashes, and trim. Case is
 * preserved (repo paths are case-sensitive on the clone). This is a DEDUP key
 * only — the original path string is what gets injected/read.
 */
export function normalizeRepoPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .trim();
}

/**
 * Validate a full ordered set of attach paths at the boundary (AC-22): reject
 * any `..`/absolute path via the shared `RepoRelativePath` contract, then dedup
 * by normalized path (first-occurrence-wins) so the persisted set is clean and
 * the `(owner, path)` PK never collides on a client-sent duplicate.
 */
function validatePaths(paths: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of paths) {
    const parsed = RepoRelativePath.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(`Invalid attachment path: ${raw}`);
    }
    const key = normalizeRepoPath(parsed.data);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(parsed.data);
  }
  return out;
}

/**
 * Assert `relPath` resolves to a descendant of `cloneRoot`. Rejects absolute
 * paths and any `..` escape (AC-22). Exported for direct unit testing.
 */
export function assertWithinClone(cloneRoot: string, relPath: string): void {
  const rootResolved = resolve(cloneRoot);
  const target = resolve(rootResolved, relPath);
  // A descendant either IS the root or starts with `<root>/` (`<root><sep>`).
  const prefix = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;
  if (target !== rootResolved && !target.startsWith(prefix)) {
    throw new ValidationError('Path escapes the repository clone');
  }
}

/**
 * Derive the `folder_type` badge (owning root) from a repo-relative path — the
 * first path segment (e.g. `docs/specs/foo.md` → `docs`). Narrows to the
 * `FolderType` contract enum; a segment outside the enum (a non-default
 * configured root) falls back to `'docs'` so serialization never rejects a
 * discovered doc. Discovery only ever walks the configured roots, and the
 * default roots ARE the enum, so the fallback is a defensive edge only.
 */
function folderTypeOf(path: string): FolderType {
  const seg = path.split('/')[0] ?? '';
  const parsed = FolderType.safeParse(seg);
  return parsed.success ? parsed.data : 'docs';
}
