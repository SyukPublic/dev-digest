/* /eval — the Skills-Lab Eval Dashboard (Mockups 2 & 3). Thin route: a top
   Agents|Skills tab strip (default Agents) plus URL search params that drill in.
   Agents tab: ?agent=<id> switches between the all-agents overview and the
   per-agent dashboard (rendered VERBATIM). Skills tab: ?tab=skills switches to
   the all-skills overview and ?skill=<id> to the per-skill differential
   dashboard. A present ?skill= implies the Skills tab. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { AllAgentsView } from "./_components/AllAgentsView";
import { AgentDashboardView } from "./_components/AgentDashboardView";
import { AllSkillsView } from "./_components/AllSkillsView";
import { SkillDashboardView } from "./_components/SkillDashboardView";

type EvalTab = "agents" | "skills";

export default function EvalDashboardPage() {
  // useSearchParams needs a Suspense boundary for the CSR bailout (Next 15).
  return (
    <React.Suspense fallback={null}>
      <EvalDashboardInner />
    </React.Suspense>
  );
}

function EvalDashboardInner() {
  const t = useTranslations("eval");
  const router = useRouter();
  const search = useSearchParams();
  const agentId = search.get("agent");
  const skillId = search.get("skill");
  // Skills tab is selected by an explicit ?tab=skills OR the presence of ?skill=
  // (a per-skill deep link); everything else defaults to Agents.
  const tab: EvalTab = search.get("tab") === "skills" || skillId ? "skills" : "agents";

  useDocumentTitle(`${t("dashboard.defaultTitle")} · DevDigest`);

  const crumb = [{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }];

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: 28, maxWidth: 1080, margin: "0 auto" }}>
        <TabStrip
          tab={tab}
          onSelect={(next) => router.push(next === "skills" ? "/eval?tab=skills" : "/eval")}
        />
        {tab === "skills" ? (
          skillId ? <SkillDashboardView skillId={skillId} /> : <AllSkillsView />
        ) : agentId ? (
          <AgentDashboardView agentId={agentId} />
        ) : (
          <AllAgentsView />
        )}
      </div>
    </AppShell>
  );
}

function TabStrip({ tab, onSelect }: { tab: EvalTab; onSelect: (tab: EvalTab) => void }) {
  const t = useTranslations("eval");
  return (
    <div
      role="tablist"
      aria-label={t("dashboard.defaultTitle")}
      style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--border)" }}
    >
      <TabButton active={tab === "agents"} onClick={() => onSelect("agents")}>
        {t("tabs.agents")}
      </TabButton>
      <TabButton active={tab === "skills"} onClick={() => onSelect("skills")}>
        {t("tabs.skills")}
      </TabButton>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: "10px 16px",
        marginBottom: -1,
        border: "none",
        borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
        background: "transparent",
        color: active ? "var(--text-primary)" : "var(--text-muted)",
        fontSize: 14,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
