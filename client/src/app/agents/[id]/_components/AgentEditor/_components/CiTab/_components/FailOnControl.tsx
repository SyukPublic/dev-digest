"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { Agent, CiFailOn } from "@devdigest/shared";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { useToast } from "@/lib/toast";
import { CI_FAIL_ON_VALUES } from "../constants";
import { s } from "../styles";

/**
 * Fail-CI-on control — a segmented control over the four `CiFailOn` values.
 * Writes the SAME `ci_fail_on` field as the Config tab (AC-23) via a narrow
 * single-key `useUpdateAgent` patch. The CI-tab-specific label + hint come from
 * the `ci` namespace (AC-47/49) so this gate reads independently of the Config
 * tab, while the four verbose option labels (AC-48) still reuse the `agents`
 * namespace so both tabs stay in lockstep. Layout is stacked (AC-50): label →
 * description → segmented control, all full-width.
 */
export function FailOnControl({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const tc = useTranslations("ci");
  const toast = useToast();
  const update = useUpdateAgent();
  const [failOn, setFailOn] = React.useState<CiFailOn>(agent.ci_fail_on);

  const pick = (v: CiFailOn) => {
    setFailOn(v);
    update.mutate(
      { id: agent.id, patch: { ci_fail_on: v } },
      { onSuccess: (data) => toast.success(t("config.savedToast", { version: data.version })) },
    );
  };

  return (
    <div style={s.panel}>
      <div style={s.failOnRow}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
          {tc("ciTab.failOn.label")}
        </div>
        <div style={s.hint}>{tc("ciTab.failOn.hint")}</div>
        <div style={s.segmented} role="group" aria-label={tc("ciTab.failOn.label")}>
          {CI_FAIL_ON_VALUES.map((v) => (
            <Button
              key={v}
              size="sm"
              kind="tertiary"
              active={failOn === v}
              aria-pressed={failOn === v}
              disabled={update.isPending}
              onClick={() => pick(v)}
            >
              {t(`config.ciFailOnOptions.${v}`)}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
