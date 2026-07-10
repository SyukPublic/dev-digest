/* /eval — the Skills-Lab Eval Dashboard (Mockups 2 & 3). Thin route: an
   ?agent=<id> search param switches between the all-agents overview and the
   per-agent dashboard. */
"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { AllAgentsView } from "./_components/AllAgentsView";
import { AgentDashboardView } from "./_components/AgentDashboardView";

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
  const search = useSearchParams();
  const agentId = search.get("agent");

  useDocumentTitle(`${t("dashboard.defaultTitle")} · DevDigest`);

  const crumb = [{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }];

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: 28, maxWidth: 1080, margin: "0 auto" }}>
        {agentId ? <AgentDashboardView agentId={agentId} /> : <AllAgentsView />}
      </div>
    </AppShell>
  );
}
