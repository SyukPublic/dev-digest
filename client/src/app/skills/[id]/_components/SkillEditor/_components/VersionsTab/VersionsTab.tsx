"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Skeleton, ErrorState, Badge } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions } from "@/lib/hooks/skills";

/** Versions tab — immutable body snapshots, newest first. */
export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);

  return (
    <div style={{ maxWidth: 820 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>{t("versions.title")}</h2>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 18px" }}>
        {t("versions.subtitle")}
      </p>
      {isLoading && <Skeleton height={120} />}
      {isError && <ErrorState body={t("versions.loadError")} onRetry={() => refetch()} />}
      {!isLoading && !isError && (versions?.length ?? 0) === 0 && (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("versions.empty")}</p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {(versions ?? []).map((v) => (
          <div
            key={v.version}
            style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-surface)" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <Badge color="var(--text-secondary)" mono>
                v{v.version}
              </Badge>
              {v.version === skill.version && <Badge color="var(--ok)">{t("versions.current")}</Badge>}
              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>
                {new Date(v.created_at).toLocaleString()}
              </span>
            </div>
            <pre
              className="mono"
              style={{
                margin: 0,
                padding: 14,
                fontSize: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 220,
                overflow: "auto",
                color: "var(--text-secondary)",
              }}
            >
              {v.body}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
