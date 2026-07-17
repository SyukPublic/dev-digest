/* PeriodControl — the unified period selector shared by all three stats surfaces
   (Agent Stats tab, Skill Stats tab, Agent Performance dashboard). Offers "30
   days" (default), "1 day", and a custom date range. Keyboard-operable and
   labeled (native <button>/<input> + aria) per AC-10/AC-36. Emits a StatsPeriod;
   the parent derives period-scoped labels from it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { StatsPeriod } from "@/lib/period";
import { s } from "./styles";

export function PeriodControl({
  value,
  onChange,
}: {
  value: StatsPeriod;
  onChange: (p: StatsPeriod) => void;
}) {
  const t = useTranslations("common");
  const [showRange, setShowRange] = React.useState(value.kind === "range");
  const [from, setFrom] = React.useState(value.kind === "range" ? value.from : "");
  const [to, setTo] = React.useState(value.kind === "range" ? value.to : "");

  const is30 = value.kind === "days" && value.days === 30;
  const is1 = value.kind === "days" && value.days === 1;
  const isRange = value.kind === "range";

  const applyRange = () => {
    if (from && to) onChange({ kind: "range", from, to });
  };

  return (
    <div role="group" aria-label={t("period.label")} style={s.group}>
      <div style={s.buttons}>
        <button
          type="button"
          aria-pressed={is30}
          onClick={() => {
            setShowRange(false);
            onChange({ kind: "days", days: 30 });
          }}
          style={is30 ? s.btnActive : s.btn}
        >
          {t("period.days30")}
        </button>
        <button
          type="button"
          aria-pressed={is1}
          onClick={() => {
            setShowRange(false);
            onChange({ kind: "days", days: 1 });
          }}
          style={is1 ? s.btnActive : s.btn}
        >
          {t("period.days1")}
        </button>
        <button
          type="button"
          aria-pressed={isRange}
          aria-expanded={showRange}
          onClick={() => setShowRange((v) => !v)}
          style={isRange ? s.btnActive : s.btn}
        >
          {t("period.custom")}
        </button>
      </div>

      {showRange && (
        <div style={s.range}>
          <label style={s.field}>
            <span style={s.fieldLabel}>{t("period.from")}</span>
            <input
              type="date"
              aria-label={t("period.from")}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              style={s.input}
            />
          </label>
          <label style={s.field}>
            <span style={s.fieldLabel}>{t("period.to")}</span>
            <input
              type="date"
              aria-label={t("period.to")}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              style={s.input}
            />
          </label>
          <button
            type="button"
            onClick={applyRange}
            disabled={!from || !to}
            style={s.btn}
          >
            {t("period.apply")}
          </button>
        </div>
      )}
    </div>
  );
}
