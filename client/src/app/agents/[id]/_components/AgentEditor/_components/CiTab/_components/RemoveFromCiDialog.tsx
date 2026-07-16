"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import type { CiInstallation } from "@devdigest/shared";
import { useDeleteCiInstallation } from "@/lib/hooks/ci";
import { useToast } from "@/lib/toast";

/**
 * Destructive "Remove from CI" confirmation (AC-75). Names the repo + agent,
 * warns about the last-agent teardown, and drives the uninstall mutation. Focus
 * management / Escape / focus-restore come from `Modal` (→ `useDialogA11y`); the
 * async in-flight / error state is announced via an `aria-live` region and the
 * server's error message is surfaced verbatim (AC-74).
 */
export function RemoveFromCiDialog({
  agentId,
  agentName,
  installation,
  onClose,
  onRemoved,
}: {
  agentId: string;
  agentName: string;
  installation: CiInstallation;
  onClose: () => void;
  /** Called after a SUCCESSFUL removal (distinct from cancel) so the parent can
   *  move focus to a sensible sibling now that this row is gone (AC-75 a11y). */
  onRemoved?: () => void;
}) {
  const t = useTranslations("ci");
  const toast = useToast();
  const del = useDeleteCiInstallation(agentId);
  const [error, setError] = React.useState<string | null>(null);
  const vars = { agent: agentName, repo: installation.repo };

  const onConfirm = () => {
    setError(null);
    del.mutate(installation.id, {
      onSuccess: () => {
        toast.success(t("remove.success", vars));
        onRemoved?.();
        onClose();
      },
      onError: (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      },
    });
  };

  return (
    <Modal width={460} title={t("remove.title")} onClose={del.isPending ? undefined : onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5, lineHeight: 1.5 }}>
        <p style={{ margin: 0 }}>{t("remove.body", vars)}</p>
        <p style={{ margin: 0, color: "var(--text-secondary)" }}>{t("remove.lastAgentWarning", vars)}</p>

        {/* Async status / error — announced to assistive tech. */}
        <div role="status" aria-live="polite" style={{ minHeight: 0 }}>
          {del.isPending && <span style={{ color: "var(--text-secondary)" }}>{t("remove.inFlight", vars)}</span>}
          {error && (
            <span role="alert" style={{ color: "var(--crit)" }}>
              {t("remove.error", { message: error })}
            </span>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <Button kind="secondary" size="sm" onClick={onClose} disabled={del.isPending}>
            {t("remove.cancel")}
          </Button>
          <Button kind="danger" size="sm" onClick={onConfirm} loading={del.isPending}>
            {del.isPending ? t("remove.removing") : t("remove.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
