import type { Container } from '../../platform/container.js';
import type {
  BriefBlastFile,
  BriefInputBundle,
  BriefSmartDiffGroup,
  BriefLinkedIssue,
  BriefSpec,
  BlastResponse,
  SmartDiff,
} from '@devdigest/shared';
import { formatIntentForPrompt } from '@devdigest/reviewer-core';
import type { PullRow } from '../../db/rows.js';
import { parseLinkedIssueRef } from '../../lib/linked-issue.js';
import { BlastService } from '../blast/service.js';
import { SmartDiffService } from '../smart-diff/service.js';
import { ProjectContextService } from '../project-context/service.js';

/**
 * assembler.ts — the PURE-ish builder of the `BriefInputBundle` from ALREADY
 * COMPUTED artifacts (CP-4, AC-1).
 *
 * "Pure-ish": the shaping logic is pure, but gathering the inputs reaches the
 * derived artifacts ONLY through the container facades (blast, smart-diff,
 * intent, GitHub, project-context) — never the DB or an SDK directly (onion).
 * There is NO diff parsing here and NO raw patch / hunks / file bodies in the
 * bundle (AC-1): only the derived intent, the deterministic blast map's REAL
 * file/caller/endpoint lists, the smart-diff per-group STATS, the linked issue
 * digest, and the attached specs.
 *
 * ZERO LLM / embedding calls of its own (AC-19): the blast summary is a cheap
 * cached read on the blast facade (its OWN concern), and the assembler makes no
 * `completeStructured`/`embed` call. It is the SERVICE that makes the single
 * brief LLM call over the assembled bundle.
 *
 * BEST-EFFORT discipline (AC-12): EVERY source is wrapped so an absent/degraded/
 * erroring input is DROPPED, never thrown — a missing intent, a degraded blast,
 * an empty smart-diff, no linked issue, or unreadable specs all leave their slot
 * empty and assembly continues over the rest.
 */

/**
 * Assemble the brief input bundle for a PR. `pull` is the already-resolved,
 * workspace-scoped PR row (the caller asserts tenancy BEFORE calling this).
 */
export async function assembleBriefBundle(
  container: Container,
  workspaceId: string,
  pull: PullRow,
): Promise<BriefInputBundle> {
  // Each source is gathered independently and best-effort; one failing source
  // never aborts the others (AC-12). Run them concurrently.
  const [intent, blast, smartDiff, linkedIssue, specs] = await Promise.all([
    safe(() => loadIntent(container, pull.id), null),
    safe(() => loadBlast(container, workspaceId, pull.id), null),
    safe(() => loadSmartDiff(container, workspaceId, pull.id), null),
    safe(() => loadLinkedIssue(container, pull), null),
    safe(() => loadSpecs(container, workspaceId, pull.repoId), [] as BriefSpec[]),
  ]);

  const blast_files = blast ? toBlastFiles(blast) : [];
  const smart_diff_groups = smartDiff ? toSmartDiffGroups(smartDiff) : [];

  return {
    intent: intent ?? null,
    blast_summary: blast?.blast.summary ?? null,
    blast_files,
    smart_diff_groups,
    linked_issue: linkedIssue ?? null,
    specs,
  };
}

// ---------------------------------------------------------------------------
// Source loaders (each reached via a facade; each best-effort at the call site).
// ---------------------------------------------------------------------------

/** Render the stored intent for the prompt, or null when none exists. */
async function loadIntent(container: Container, prId: string): Promise<string | null> {
  const stored = await container.reviewRepo.getIntent(prId);
  if (!stored) return null;
  return formatIntentForPrompt({
    intent: stored.intent,
    in_scope: stored.in_scope,
    out_of_scope: stored.out_of_scope,
  });
}

/** Read the deterministic blast map (+ cheap cached prose summary) via the facade. */
async function loadBlast(
  container: Container,
  workspaceId: string,
  prId: string,
): Promise<BlastResponse> {
  return new BlastService(container).getBlast(workspaceId, prId);
}

/** Read the per-group smart-diff stats via the facade (deterministic, no LLM). */
async function loadSmartDiff(
  container: Container,
  workspaceId: string,
  prId: string,
): Promise<SmartDiff> {
  return new SmartDiffService(container).getSmartDiff(workspaceId, prId);
}

/**
 * Best-effort linked-issue digest: parse the PR body for a `#123` ref, then
 * fetch the issue via the GitHub facade. Any step failing (no ref, no token,
 * network) drops the issue (server INSIGHTS 2026-06-25).
 */
async function loadLinkedIssue(
  container: Container,
  pull: PullRow,
): Promise<BriefLinkedIssue | null> {
  const number = pull.body ? parseLinkedIssueRef(pull.body) : null;
  if (number === null) return null;
  const repo = await container.reviewRepo.getRepo(pull.repoId);
  if (!repo) return null;
  const gh = await container.github();
  const issue = await gh.getIssue({ owner: repo.owner, name: repo.name }, number);
  return { number: issue.number, title: issue.title, body: issue.body ?? null };
}

/**
 * Best-effort attached specs: the union of the specs on the workspace's ENABLED
 * reviewer agents (each merged with its enabled skills' inherited specs), read
 * from the repo clone. Reuses the project-context resolver + best-effort reader
 * so a dangling / non-UTF-8 / oversized spec is skipped, never thrown.
 */
async function loadSpecs(
  container: Container,
  workspaceId: string,
  repoId: string,
): Promise<BriefSpec[]> {
  const pc = new ProjectContextService(container);

  // Resolve the deduped, ordered path set across every enabled agent's merged
  // context (agent-attached ∪ enabled-skill-inherited), first-occurrence wins.
  const agents = await container.agentsRepo.listEnabled(workspaceId);
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const agent of agents) {
    const enabledSkillIds = (await container.agentsRepo.linkedSkills(agent.id))
      .filter((l) => l.skill.enabled)
      .map((l) => l.skill.id);
    const agentPaths = await pc.resolveSpecPathsForAgent(
      workspaceId,
      agent.id,
      enabledSkillIds,
    );
    for (const p of agentPaths) {
      if (seen.has(p)) continue;
      seen.add(p);
      paths.push(p);
    }
  }
  if (paths.length === 0) return [];

  // Read each path from the clone best-effort; keep only the docs that read ok.
  const reads = await pc.readSpecsForRun(workspaceId, repoId, paths);
  return reads
    .filter((r) => r.ok && r.content !== undefined)
    .map((r) => ({ path: r.path, content: r.content as string }));
}

// ---------------------------------------------------------------------------
// Pure shapers (facade responses → bundle slots; NO diff bodies, AC-1).
// ---------------------------------------------------------------------------

/**
 * Real-path source (AC-4): union the blast map's changed-symbol files and every
 * downstream caller file into a deduped `BriefBlastFile[]`, carrying that file's
 * callers (symbol names) + affected endpoints. A bare changed file with no
 * downstream still contributes its path so grounding accepts it.
 */
export function toBlastFiles(blast: BlastResponse): BriefBlastFile[] {
  const byPath = new Map<string, { callers: Set<string>; endpoints: Set<string> }>();
  const ensure = (path: string) => {
    let entry = byPath.get(path);
    if (!entry) {
      entry = { callers: new Set(), endpoints: new Set() };
      byPath.set(path, entry);
    }
    return entry;
  };

  for (const sym of blast.blast.changed_symbols) {
    ensure(sym.file);
  }
  for (const down of blast.blast.downstream) {
    for (const caller of down.callers) {
      const entry = ensure(caller.file);
      entry.callers.add(caller.name);
      for (const ep of down.endpoints_affected) entry.endpoints.add(ep);
    }
  }

  return [...byPath.entries()].map(([path, { callers, endpoints }]) => ({
    path,
    callers: callers.size > 0 ? [...callers] : null,
    endpoints: endpoints.size > 0 ? [...endpoints] : null,
  }));
}

/**
 * Smart-diff per-group STATS only (AC-1): map each group's files to their
 * path + additions/deletions + `finding_count` (= `finding_lines.length`). NO
 * `patch`/hunks/`pseudocode_summary` ride along.
 */
export function toSmartDiffGroups(smartDiff: SmartDiff): BriefSmartDiffGroup[] {
  return smartDiff.groups.map((g) => ({
    role: g.role,
    files: g.files.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      finding_count: f.finding_lines.length,
    })),
  }));
}

// ---------------------------------------------------------------------------
// Best-effort wrapper.
// ---------------------------------------------------------------------------

/**
 * Run `fn`, returning its value or `fallback` on ANY throw (AC-12). Keeps each
 * source drop-on-error without leaking the failure past the assembler.
 */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
