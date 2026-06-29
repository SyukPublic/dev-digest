/* SkillsTab — attach/detach + reorder the agent's skills. Order defines the
   block order in the assembled prompt. Persists on every toggle/reorder. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useSkills, useAgentSkillLinks, useSetAgentSkills } from "@/lib/hooks/skills";
import { typeColor } from "@/lib/skills";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { data: skills, isLoading } = useSkills();
  const { data: links } = useAgentSkillLinks(agent.id);
  const setSkills = useSetAgentSkills();

  const [filter, setFilter] = React.useState("");
  const [order, setOrder] = React.useState<string[] | null>(null);
  const [linked, setLinked] = React.useState<Set<string>>(new Set());
  const [dragId, setDragId] = React.useState<string | null>(null);

  // Seed local order/linked once both queries resolve (linked first, in order).
  React.useEffect(() => {
    if (!skills || !links || order !== null) return;
    const linkedIds = [...links].sort((a, b) => a.order - b.order).map((l) => l.skill_id);
    const rest = skills.map((sk) => sk.id).filter((id) => !linkedIds.includes(id));
    setOrder([...linkedIds, ...rest]);
    setLinked(new Set(linkedIds));
  }, [skills, links, order]);

  const persist = (nextOrder: string[], nextLinked: Set<string>) =>
    setSkills.mutate({ agentId: agent.id, skillIds: nextOrder.filter((id) => nextLinked.has(id)) });

  const toggle = (id: string) => {
    const next = new Set(linked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setLinked(next);
    if (order) persist(order, next);
  };

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId || !order) return;
    // Remove the dragged id first, THEN find the target's index in the reduced
    // list (avoids an off-by-one when dragging downward) and insert before it.
    const cur = order.filter((id) => id !== dragId);
    cur.splice(cur.indexOf(targetId), 0, dragId);
    setOrder(cur);
    setDragId(null);
    persist(cur, linked);
  };

  if (isLoading || order === null) return <Skeleton height={240} />;

  const byId = new Map((skills ?? []).map((sk) => [sk.id, sk]));
  const q = filter.trim().toLowerCase();
  const rows = order
    .map((id) => byId.get(id))
    .filter((sk): sk is NonNullable<typeof sk> => !!sk && (!q || sk.name.toLowerCase().includes(q)));

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--accent)">
          {t("skills.enabledCount", { linked: linked.size, total: skills?.length ?? 0 })}
        </Badge>
        <div style={s.search}>
          <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>
      <p style={s.hint}>{t("skills.orderHint")}</p>

      <div>
        {rows.map((sk) => {
          const on = linked.has(sk.id);
          // A globally-disabled skill can't be ATTACHED (it would never reach the
          // prompt) — show it greyed and lock the checkbox. Reordering is still
          // allowed (a separate action), so drag stays enabled for every row.
          const disabled = !sk.enabled;
          return (
            <div
              key={sk.id}
              draggable
              onDragStart={() => setDragId(sk.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(sk.id)}
              style={s.row(on, dragId === sk.id, disabled)}
              title={disabled ? t("skills.disabledHint") : undefined}
            >
              <Icon.Menu size={15} style={{ color: "var(--text-muted)", cursor: "grab" }} />
              <input
                type="checkbox"
                checked={on}
                disabled={disabled}
                onChange={() => toggle(sk.id)}
                style={{ cursor: disabled ? "not-allowed" : "pointer" }}
              />
              <Icon.Sparkles size={14} style={{ color: "var(--accent)" }} />
              <span className="mono" style={s.name}>
                {sk.name}
              </span>
              {disabled && <Badge color="var(--text-muted)">{t("editor.disabled")}</Badge>}
              <Badge color={typeColor(sk.type)} mono>
                {sk.type}
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}
