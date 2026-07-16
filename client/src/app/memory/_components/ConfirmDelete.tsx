/* ConfirmDelete — a confirmation step before a memory entry is removed (AC-22). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";

export function ConfirmDelete({
  busy,
  onConfirm,
  onCancel,
}: {
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("memory");
  return (
    <Modal
      width={440}
      title={t("confirmDelete.title")}
      onClose={onCancel}
      footer={
        <>
          <Button kind="ghost" size="sm" onClick={onCancel}>
            {t("confirmDelete.cancel")}
          </Button>
          <Button kind="danger" size="sm" icon="Trash" onClick={onConfirm} disabled={busy}>
            {t("confirmDelete.confirm")}
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 }}>
        {t("confirmDelete.body")}
      </p>
    </Modal>
  );
}
