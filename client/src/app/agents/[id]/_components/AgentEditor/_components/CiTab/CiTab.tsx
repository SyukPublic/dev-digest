"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Badge } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useCiInstallations, useAgentCiRuns } from "@/lib/hooks/ci";
import { FailOnControl } from "./_components/FailOnControl";
import { Installations } from "./_components/Installations";
import { CiRunHistory } from "./_components/CiRunHistory";
import { ExportWizard } from "./_components/ExportWizard";
import { s } from "./styles";

/**
 * CI tab — deploy this agent to a repo's CI, tune its gate, and see its CI runs.
 * Header actions open the 4-step Export wizard; the Fail-CI-on control writes the
 * same `ci_fail_on` field as the Config tab.
 */
export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const [wizardOpen, setWizardOpen] = React.useState(false);

  const { data: installations } = useCiInstallations(agent.id);
  const { data: runs } = useAgentCiRuns(agent.id);
  const installs = installations ?? [];
  const ciRuns = runs ?? [];

  return (
    <div style={s.wrap}>
      <div style={s.headerRow}>
        <div>
          <h2 style={s.h2}>{t("ciTab.heading")}</h2>
          <div style={s.subtitle}>{t("ciTab.subtitle")}</div>
        </div>
        <Badge dot color="var(--ok)">
          {t("ciTab.activeInRepos", { n: installs.length })}
        </Badge>
        <div style={s.headerActions}>
          <Button kind="secondary" size="sm" icon="Settings" onClick={() => setWizardOpen(true)}>
            {t("ciTab.updateConfig")}
          </Button>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => setWizardOpen(true)}>
            {t("ciTab.addToCi")}
          </Button>
        </div>
      </div>

      <FailOnControl agent={agent} />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Installations
          agentId={agent.id}
          agentName={agent.name}
          installations={installs}
          runs={ciRuns}
          onAdd={() => setWizardOpen(true)}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={s.sectionLabel}>{t("ciTab.runHistory")}</span>
        <CiRunHistory runs={ciRuns} emptyText={t("runs.emptyBody")} />
      </div>

      {wizardOpen && (
        <ExportWizard agentId={agent.id} agentName={agent.name} onClose={() => setWizardOpen(false)} />
      )}
    </div>
  );
}
