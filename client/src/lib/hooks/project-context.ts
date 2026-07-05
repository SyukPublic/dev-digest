/* hooks/project-context.ts — React Query hooks for the Project Context Folder:
   discover repo markdown docs, read a doc's raw content, and attach/reorder the
   ordered document set on an agent or skill. Mirrors the agent⇄skill binding
   hooks (see hooks/skills.ts). The attach POST sends the FULL ordered path set;
   the server persists and returns the authoritative ordered attachments. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  DiscoveredDocument,
  DocumentContent,
  ProjectContextConfig,
  SpecAttachment,
  SpecOwner,
} from "@devdigest/shared";

/** The owner kind an attachment set belongs to (drives the endpoint prefix).
 *  Re-exported from `@devdigest/shared` (the single source of truth) so existing
 *  consumers keep importing it from here; TYPE-only so no zod value reaches the
 *  client bundle. */
export type { SpecOwner };

// ---- Discover / read (Project Context page + Preview drawer) --------------

/** All markdown docs discovered under the configured roots on the active repo.
 *
 *  With an optional `owner` selector ({ owner, ownerId }) the server ALSO returns
 *  synthesized `missing: true` rows for that owner's attached-but-absent paths
 *  (FIX 3b / AC-15) — the Context tabs pass it so the SERVER supplies `missing`.
 *  Called WITHOUT an owner (the Project Context page), the query key + URL are
 *  byte-identical to before: present docs only. */
export function useProjectContextDocs(
  repoId: string | null | undefined,
  owner?: { owner: SpecOwner; ownerId: string },
) {
  return useQuery({
    queryKey: owner
      ? ["project-context-docs", repoId, owner.owner, owner.ownerId]
      : ["project-context-docs", repoId],
    queryFn: () => {
      const suffix = owner
        ? `?owner=${owner.owner}&ownerId=${encodeURIComponent(owner.ownerId)}`
        : "";
      return api.get<DiscoveredDocument[]>(`/repos/${repoId}/project-context${suffix}`);
    },
    enabled: !!repoId,
  });
}

/** Project Context config for the active repo — currently the SOFT token budget
 *  (AC-14) the attach UI warns against. Server-driven, so the warn threshold
 *  tracks `PROJECT_CONTEXT_TOKEN_BUDGET` instead of a client literal. */
export function useProjectContextConfig(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["project-context-config", repoId],
    queryFn: () => api.get<ProjectContextConfig>(`/repos/${repoId}/project-context/config`),
    enabled: !!repoId,
  });
}

/** Raw content + token count of a single doc (Preview / Edit panes). */
export function useDocumentContent(repoId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: ["project-context-content", repoId, path],
    queryFn: () =>
      api.get<DocumentContent>(
        `/repos/${repoId}/project-context/content?path=${encodeURIComponent(path!)}`,
      ),
    enabled: !!repoId && !!path,
  });
}

// ---- Attach / reorder (agent + skill Context tabs) ------------------------

/** Ordered attachments for an agent or skill (paths + order). */
export function useAttachedSpecs(owner: SpecOwner, id: string | null | undefined) {
  return useQuery({
    queryKey: ["attached-specs", owner, id],
    queryFn: () => api.get<SpecAttachment[]>(`/${owner}/${id}/specs`),
    enabled: !!id,
  });
}

/** Replace the owner's ordered attached-doc set (order defines injection order).
 *  Sends the FULL ordered path set; caches the authoritative result so the order
 *  survives even when leaving the page cancels a background refetch. */
export function useSetAttachedSpecs(owner: SpecOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, paths }: { id: string; paths: string[] }) =>
      api.post<SpecAttachment[]>(`/${owner}/${id}/specs`, { paths }),
    onSuccess: (attachments, { id }) => qc.setQueryData(["attached-specs", owner, id], attachments),
  });
}
