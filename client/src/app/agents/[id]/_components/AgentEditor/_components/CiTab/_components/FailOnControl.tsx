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
 * single-key `useUpdateAgent` patch. Labels reuse the `agents` namespace so the
 * two tabs stay in lockstep without a cross-`_components` import.
 */
export function FailOnControl({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
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
        <div style={s.hint}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
            {t("config.ciFailOn")}
          </div>
          {t("config.ciFailOnHint")}
        </div>
        <div style={s.segmented} role="group" aria-label={t("config.ciFailOn")}>
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
