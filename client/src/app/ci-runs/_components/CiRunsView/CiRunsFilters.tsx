/* Filter bar for the CI Runs page: time window, agent, repo, status, source.
   Agent/repo/status/source are applied client-side by the parent view; the time
   window reflects the server's 7-day lookback. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SelectInput } from "@devdigest/ui";
import { ALL, CI_RUN_STATUSES } from "./constants";
import { s } from "./styles";

export interface CiRunFilterState {
  agent: string;
  repo: string;
  status: string;
  source: string;
}

export function CiRunsFilters({
  filters,
  onChange,
  agents,
  repos,
  sources,
}: {
  filters: CiRunFilterState;
  onChange: (patch: Partial<CiRunFilterState>) => void;
  agents: string[];
  repos: string[];
  /** Distinct source labels present in the data (already display-formatted). */
  sources: string[];
}) {
  const t = useTranslations("ci");

  const withAll = (allLabel: string, values: string[], label?: (v: string) => string) => [
    { value: ALL, label: allLabel },
    ...values.map((v) => ({ value: v, label: label ? label(v) : v })),
  ];

  return (
    <div style={s.filters} role="group" aria-label={t("runs.title")}>
      {/* Time window — server does a 7-day lookback; single option for now. */}
      <SelectInput
        value="7d"
        options={[{ value: "7d", label: t("runs.filters.last7Days") }]}
        mono={false}
      />
      <SelectInput
        value={filters.agent}
        onChange={(v) => onChange({ agent: v })}
        options={withAll(t("runs.filters.allAgents"), agents)}
        mono={false}
      />
      <SelectInput
        value={filters.repo}
        onChange={(v) => onChange({ repo: v })}
        options={withAll(t("runs.filters.allRepos"), repos)}
        mono={false}
      />
      <SelectInput
        value={filters.status}
        onChange={(v) => onChange({ status: v })}
        options={withAll(t("runs.filters.allStatuses"), [...CI_RUN_STATUSES], (v) =>
          t(`runs.status.${v}`),
        )}
        mono={false}
      />
      <SelectInput
        value={filters.source}
        onChange={(v) => onChange({ source: v })}
        options={withAll(t("runs.filters.allSources"), sources)}
        mono={false}
      />
    </div>
  );
}
