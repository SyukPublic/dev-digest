"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, Badge, Icon } from "@devdigest/ui";
import { POST_AS_VALUES, TRIGGER_EVENTS, type PostAsValue, type TriggerEvent } from "../../../constants";
import { s } from "../../../styles";

/** Step 3 — pick PR triggers, how results are posted, and read the merge hint. */
export function ConfigureStep({
  triggers,
  onToggleTrigger,
  postAs,
  onPostAs,
}: {
  triggers: Record<TriggerEvent, boolean>;
  onToggleTrigger: (ev: TriggerEvent) => void;
  postAs: PostAsValue;
  onPostAs: (v: PostAsValue) => void;
}) {
  const t = useTranslations("ci");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <div style={{ ...s.sectionLabel, marginBottom: 8 }}>{t("exportWizard.triggerLabel")}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TRIGGER_EVENTS.map((ev) => (
            <Chip
              key={ev}
              active={triggers[ev]}
              onClick={() => onToggleTrigger(ev)}
              ariaLabel={`pull_request:${ev}`}
            >
              pull_request:{ev}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <div style={{ ...s.sectionLabel, marginBottom: 8 }}>{t("exportWizard.postResultsLabel")}</div>
        <div role="radiogroup" aria-label={t("exportWizard.postResultsLabel")}>
          {POST_AS_VALUES.map((v) => {
            const key = v === "github_review" ? "githubReview" : v === "pr_comment" ? "prComment" : "none";
            return (
              <label key={v} style={s.radioRow}>
                <input
                  type="radio"
                  name="post-as"
                  checked={postAs === v}
                  onChange={() => onPostAs(v)}
                />
                <span>{t(`exportWizard.postAs.${key}`)}</span>
                {v === "github_review" && (
                  <Badge color="var(--accent-text)" bg="var(--accent-bg)">
                    {t("exportWizard.recommended")}
                  </Badge>
                )}
              </label>
            );
          })}
        </div>
      </div>

      <div style={s.callout}>
        <Icon.Info size={15} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 3 }}>
            {t("exportWizard.blockMergeTitle")}
          </div>
          {t("exportWizard.blockMergeDesc")}
        </div>
      </div>
    </div>
  );
}
