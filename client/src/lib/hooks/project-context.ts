/* hooks/project-context.ts — React Query hooks for the Project Context Folder:
   discover repo markdown docs, read a doc's raw content, and attach/reorder the
   ordered document set on an agent or skill. Mirrors the agent⇄skill binding
   hooks (see hooks/skills.ts). The attach POST sends the FULL ordered path set;
   the server persists and returns the authoritative ordered attachments. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { DiscoveredDocument, DocumentContent, SpecAttachment } from "@devdigest/shared";

/** The owner kind an attachment set belongs to (drives the endpoint prefix). */
export type SpecOwner = "agents" | "skills";

// ---- Discover / read (Project Context page + Preview drawer) --------------

/** All markdown docs discovered under the configured roots on the active repo. */
export function useProjectContextDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["project-context-docs", repoId],
    queryFn: () => api.get<DiscoveredDocument[]>(`/repos/${repoId}/project-context`),
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
