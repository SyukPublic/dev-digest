import { z } from 'zod';

/**
 * Project Context Folder — boundary shapes for turning a repo's markdown docs
 * (specs / design notes / insights) into deterministic review context.
 *
 * Kept in a NEW file so stable contracts are not edited (the `@devdigest/shared`
 * barrel is extended with new files, never edited in place). These are the
 * producer-side shapes: what the server discovers/reads from the read-only
 * clone, and how an attachment is stored (a repo-relative PATH, never the doc
 * text — the text is read fresh at run time).
 *
 * `spec_tokens` (the per-doc token attribution recorded on a completed trace)
 * lives alongside the trace contract in `./trace-spec-tokens.js`.
 */

/**
 * The configured root folders a markdown doc can live under. Doubles as the
 * folder-type badge shown in the UI. Mirrors the default
 * `PROJECT_CONTEXT_ROOTS` (`specs,docs,insights`).
 */
export const FolderType = z.enum(['specs', 'docs', 'insights']);
export type FolderType = z.infer<typeof FolderType>;

/**
 * The owner kind an attachment set belongs to (drives the `/{owner}/:id/specs`
 * endpoint prefix and the owner-aware discover selector). Single source of truth
 * for the shape that was previously declared ad-hoc in the service signature, the
 * `DiscoverQuery` route schema, and the client hook.
 */
export const SpecOwner = z.enum(['agents', 'skills']);
export type SpecOwner = z.infer<typeof SpecOwner>;

/**
 * Selects one attachment owner (agent/skill) by kind + uuid — the owner-aware
 * discovery selector (AC-15) and the shared shape the service consumes. `ownerId`
 * is the owner's uuid; the workspace scope is applied by the caller (AC-20).
 */
export const OwnerSelector = z.object({
  owner: SpecOwner,
  ownerId: z.string().uuid(),
});
export type OwnerSelector = z.infer<typeof OwnerSelector>;

/**
 * A repo-relative markdown path. Invariants (AC-22): forward-slash separated,
 * non-empty, and never containing a `..` traversal segment. The service still
 * resolves + asserts descendant-of-clone before any read; this is the contract
 * gate at the boundary.
 */
export const RepoRelativePath = z
  .string()
  .min(1)
  .refine((p) => !p.split('/').includes('..'), {
    message: 'path must not contain a ".." traversal segment',
  });
export type RepoRelativePath = z.infer<typeof RepoRelativePath>;

/** A non-negative integer token count (`tokens >= 0`). */
export const TokenCount = z.number().int().min(0);

/**
 * A markdown document discovered under one of the configured roots on the
 * read-only clone. `tokens` is an attach-time estimate over the raw text (the
 * real per-run count is recorded separately as `spec_tokens`). `missing` marks
 * an attached path that no longer resolves on the clone (AC-15); `used_by_agents`
 * is an optional server-computed count of enabled agents whose merged context
 * includes this path (AC-17).
 */
export const DiscoveredDocument = z.object({
  path: RepoRelativePath,
  folder_type: FolderType,
  tokens: TokenCount,
  /** True when an attached path no longer exists on the clone. */
  missing: z.boolean().nullish(),
  /** Count of enabled agents whose merged context includes this path. */
  used_by_agents: z.number().int().min(0).nullish(),
});
export type DiscoveredDocument = z.infer<typeof DiscoveredDocument>;

/**
 * The raw content + token count of a single discovered document, returned by
 * the content/preview endpoint. `content` is the raw UTF-8 markdown; `tokens`
 * is `0` for an empty file (AC-2, AC-8).
 */
export const DocumentContent = z.object({
  path: RepoRelativePath,
  content: z.string(),
  tokens: TokenCount,
  folder_type: FolderType,
});
export type DocumentContent = z.infer<typeof DocumentContent>;

/**
 * The per-workspace/repo Project Context config the UI needs to drive its
 * client-side affordances. Currently only the SOFT total-token budget (AC-14):
 * a single scalar (from `PROJECT_CONTEXT_TOKEN_BUDGET`) the attach UI compares
 * against total attached tokens to show a warn-only indicator — never a per-doc
 * property, so it lives on its own tiny DTO rather than on `DiscoveredDocument`.
 */
export const ProjectContextConfig = z.object({
  token_budget: TokenCount,
});
export type ProjectContextConfig = z.infer<typeof ProjectContextConfig>;

/**
 * A single attachment as persisted on an agent or skill: the repo-relative
 * document PATH plus its injection order (0-based). The doc text is never
 * copied into the attachment metadata (AC-5) — only the path + order.
 */
export const SpecAttachment = z.object({
  path: RepoRelativePath,
  order: z.number().int().min(0),
});
export type SpecAttachment = z.infer<typeof SpecAttachment>;
