/* BlastCard — the "BLAST RADIUS" block: the downstream-impact map for a PR.
   Changed symbols → their callers → the endpoints/crons those callers sit on,
   shown either as an expandable Tree or a Mermaid flowchart (Graph). Deterministic
   + read-only (data from usePrBlast); rendered in the Overview tab.

   SECURITY: every string here (symbol/file/endpoint/cron names + the summary)
   is repo-/LLM-derived untrusted text. It is rendered as plain TEXT — React
   auto-escapes — and the Mermaid node labels are explicitly escaped before being
   embedded in the diagram source. No dangerouslySetInnerHTML anywhere. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Button, Badge, Icon, MonoLink, type IconName } from "@devdigest/ui";
import type { BlastRadius, DownstreamImpact, ChangedSymbol } from "@devdigest/shared";
import { MermaidDiagram } from "@/components/mermaid-diagram/MermaidDiagram";
import { usePrBlast } from "@/lib/hooks/reviews";
import { usePullDetail } from "@/lib/hooks/core";
import { useActiveRepo } from "@/lib/repo-context";
import { githubBlobUrl } from "@/lib/github-urls";

interface BlastCardProps {
  prId: string;
}

/* Mermaid grows illegible past a few dozen nodes; beyond this we fall back to the
   Tree view and show the graph.empty hint rather than an unreadable hairball. */
const MAX_GRAPH_NODES = 40;

/* Non-`full` index states → the badge copy key + an icon (state is conveyed by
   icon + text, never color alone — WCAG). `failed` reads as "no index". */
const STATUS_META: Record<
  "partial" | "degraded" | "failed",
  { key: "partial" | "degraded" | "empty"; icon: IconName }
> = {
  partial: { key: "partial", icon: "AlertTriangle" },
  degraded: { key: "degraded", icon: "AlertTriangle" },
  failed: { key: "empty", icon: "AlertTriangle" },
};

export function BlastCard({ prId }: BlastCardProps) {
  const t = useTranslations("blast");
  const { data, isLoading } = usePrBlast(prId);
  // Repo + head SHA come from the same client sources the diff/findings use
  // (repo-context + pull detail), NOT the blast contract — enough to deep-link
  // each file to github.com/{repo}/blob/{headSha}/{file}. Absent either ⇒ text.
  const { activeRepo } = useActiveRepo();
  const pull = usePullDetail(prId);
  const [view, setView] = React.useState<"tree" | "graph">("tree");

  // Loading / not-yet-available → render nothing (mirror IntentCard's loading
  // branch; the map is best-effort and never blocks the Overview).
  if (isLoading || !data) return null;

  const repoFullName = activeRepo?.full_name ?? null;
  const headSha = pull.data?.head_sha ?? null;
  const blast = data.blast;
  const statusMeta = data.status !== "full" ? STATUS_META[data.status] : null;

  /* Counts derived straight from the query data (derive, don't store). Callers
     are counted as total per-symbol caller entries (the per-symbol list is "top
     callers", not necessarily exhaustive — the facade rank-caps upstream).
     Endpoints/crons are de-duplicated across downstream groups. */
  const symbolCount = blast.changed_symbols.length;
  const callerCount = blast.downstream.reduce((n, d) => n + d.callers.length, 0);
  const endpointCount = uniq(blast.downstream.flatMap((d) => d.endpoints_affected)).length;
  const cronCount = uniq(blast.downstream.flatMap((d) => d.crons_affected)).length;

  const statusBadge = statusMeta ? (
    <span title={data.degraded_reason ?? undefined}>
      <Badge color="var(--warn)" bg="var(--warn-bg)" icon={statusMeta.icon}>
        {t(`status.${statusMeta.key}`)}
      </Badge>
    </span>
  ) : null;

  /* Tree | Graph toggle — the only local UI state besides per-row expand. */
  const viewToggle = (
    <div role="group" style={{ display: "inline-flex", gap: 4 }}>
      <Button kind="ghost" size="sm" active={view === "tree"} onClick={() => setView("tree")}>
        {t("view.tree")}
      </Button>
      <Button kind="ghost" size="sm" active={view === "graph"} onClick={() => setView("graph")}>
        {t("view.graph")}
      </Button>
    </div>
  );

  return (
    <Card>
      <SectionLabel
        icon="Boxes"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {statusBadge}
            {viewToggle}
          </div>
        }
      >
        {t("title")}
      </SectionLabel>

      {/* Summary — untrusted LLM prose; plain text, React auto-escapes. */}
      {blast.summary && (
        <p
          style={{
            fontSize: 14,
            color: "var(--text-secondary)",
            marginTop: 0,
            marginBottom: 16,
            lineHeight: 1.55,
          }}
        >
          {blast.summary}
        </p>
      )}

      <StatRow
        symbols={symbolCount}
        callers={callerCount}
        endpoints={endpointCount}
        crons={cronCount}
      />

      {view === "tree" ? (
        <BlastTree blast={blast} repoFullName={repoFullName} headSha={headSha} />
      ) : (
        <BlastGraph blast={blast} />
      )}
    </Card>
  );
}

// ---- Private sub-components ----

const STAT_META: Record<
  "symbols" | "callers" | "endpoints" | "crons",
  IconName
> = {
  symbols: "Code",
  callers: "Users",
  endpoints: "Globe",
  crons: "Clock",
};

function StatRow({
  symbols,
  callers,
  endpoints,
  crons,
}: {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
}) {
  const t = useTranslations("blast");
  const stats: { key: keyof typeof STAT_META; value: number }[] = [
    { key: "symbols", value: symbols },
    { key: "callers", value: callers },
    { key: "endpoints", value: endpoints },
    { key: "crons", value: crons },
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 16 }}>
      {stats.map(({ key, value }) => {
        const StatIcon = Icon[STAT_META[key]];
        return (
          <span
            key={key}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}
          >
            <StatIcon size={14} style={{ color: "var(--text-muted)" }} />
            <span className="tnum" style={{ fontWeight: 700, color: "var(--text-primary)" }}>
              {value}
            </span>
            <span style={{ color: "var(--text-muted)" }}>{t(`stat.${key}`)}</span>
          </span>
        );
      })}
    </div>
  );
}

/* TREE — leveled, expandable rows: changed symbol → its callers → the
   endpoints/crons those callers sit on. Per-row expand state is local UI state
   keyed by the symbol name (server data stays in the query, never mirrored). */
function BlastTree({
  blast,
  repoFullName,
  headSha,
}: {
  blast: BlastRadius;
  repoFullName: string | null;
  headSha: string | null;
}) {
  const t = useTranslations("blast");

  // downstream is keyed by symbol; pair each changed symbol with its impact (if
  // any) so the tree is anchored on the changed set, not just the impacted subset.
  const bySymbol = new Map<string, DownstreamImpact>();
  for (const d of blast.downstream) bySymbol.set(d.symbol, d);

  if (blast.downstream.length === 0) {
    return (
      <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
        {t("noDownstream", { count: blast.changed_symbols.length })}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {blast.changed_symbols.map((sym) => (
        <SymbolRow
          key={`${sym.file}:${sym.name}`}
          symbol={sym}
          impact={bySymbol.get(sym.name)}
          repoFullName={repoFullName}
          headSha={headSha}
        />
      ))}
    </div>
  );
}

function SymbolRow({
  symbol,
  impact,
  repoFullName,
  headSha,
}: {
  symbol: ChangedSymbol;
  impact: DownstreamImpact | undefined;
  repoFullName: string | null;
  headSha: string | null;
}) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(false);
  const callers = impact?.callers ?? [];
  const endpoints = impact?.endpoints_affected ?? [];
  const crons = impact?.crons_affected ?? [];
  const hasChildren = callers.length > 0 || endpoints.length > 0 || crons.length > 0;
  const Chevron = open ? Icon.ChevronDown : Icon.ChevronRight;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={symbol.name}
          disabled={!hasChildren}
          onClick={() => setOpen((o) => !o)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
            background: "none",
            border: "none",
            padding: "3px 0",
            cursor: hasChildren ? "pointer" : "default",
            color: "var(--text-primary)",
            fontSize: 13,
          }}
        >
          <Chevron
            size={13}
            style={{ color: "var(--text-muted)", opacity: hasChildren ? 1 : 0.25 }}
          />
          <Icon.Code size={13} strokeWidth={2.5} style={{ color: "var(--accent)" }} />
          <span style={{ fontWeight: 600 }}>{symbol.name}</span>
        </button>
        {/* Click-to-code: open the file on github.com at the PR head (new tab).
            No symbol line in the contract → file-level link (no #L). The path can
            be long, so truncate with ellipsis (full path in the title) to keep the
            row inside the 50%-width card. */}
        <span
          title={symbol.file}
          style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          <MonoLink href={blobHref(repoFullName, headSha, symbol.file)}>{symbol.file}</MonoLink>
        </span>
        {callers.length > 0 && (
          <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: 12, color: "var(--text-muted)" }}>
            {t("callerCount", { count: callers.length })}
          </span>
        )}
      </div>

      {open && hasChildren && (
        <div
          style={{
            marginLeft: 20,
            marginTop: 2,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 3,
          }}
        >
          {callers.map((c) => (
            <div
              key={`${c.file}:${c.name}:${c.line}`}
              style={{
                display: "flex",
                width: "100%",
                minWidth: 0,
                alignItems: "center",
                gap: 6,
                fontSize: 12.5,
                color: "var(--text-secondary)",
              }}
            >
              {/* ↳ leader — the caller hangs off its changed symbol. */}
              <Icon.CornerDownRight size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span style={{ flexShrink: 0 }}>{c.name}</span>
              {/* Caller files are usually OUTSIDE the PR diff → no in-app view;
                  a github.com blob link at the caller's ref line is the target.
                  Truncate the long file:line with ellipsis (full value in title). */}
              <span
                title={`${c.file}:${c.line}`}
                style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                <MonoLink href={blobHref(repoFullName, headSha, c.file, c.line)}>
                  {c.file}:{c.line}
                </MonoLink>
              </span>
            </div>
          ))}
          {/* Endpoints/crons render as colored pills (one per line — the column's
              flex-start keeps each inline-flex Badge at content width). */}
          {endpoints.map((e) => (
            <Badge key={`ep:${e}`} color="var(--accent-text)" bg="var(--accent-bg)" icon="Globe">
              {e}
            </Badge>
          ))}
          {crons.map((c) => (
            <Badge key={`cron:${c}`} color="var(--warn)" bg="var(--warn-bg)" icon="Clock">
              {c}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

/* GRAPH — a Mermaid flowchart derived from the same data (derive, don't store).
   Node labels are repo-derived, so they are escaped before being embedded in the
   diagram source. Node count is capped for legibility; over the cap (or empty)
   we show the graph.empty hint and let the user switch to the Tree. */
function BlastGraph({ blast }: { blast: BlastRadius }) {
  const t = useTranslations("blast");
  const src = React.useMemo(() => buildMermaid(blast), [blast]);

  if (!src) {
    return <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("graph.empty")}</div>;
  }

  return (
    <div role="img" aria-label={t("graph.ariaLabel")}>
      <MermaidDiagram chart={src} />
      {/* Legend rendered in React (NOT in Mermaid): the dots live outside the
          sanitized SVG, so CSS theme vars are safe here — mirror the buildMermaid
          classDef palette (changed/callers/endpoint/cron). */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 10, fontSize: 12 }}>
        <LegendDot color="var(--accent)" label={t("legend.changed")} />
        <LegendDot color="var(--text-muted)" label={t("legend.callers")} />
        <LegendDot color="var(--ok)" label={t("legend.endpoints")} />
        <LegendDot color="var(--warn)" label={t("legend.crons")} />
      </div>
    </div>
  );
}

/* A single legend swatch: a colored dot + its label. Color is a CSS var (the
   legend is React-rendered, outside the Mermaid SVG). */
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)" }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: color }} />
      {label}
    </span>
  );
}

// ---- Helpers ----

function uniq(items: string[]): string[] {
  return Array.from(new Set(items));
}

/** github.com blob deep-link for a repo file at the PR head, or undefined when
    the repo/sha isn't known yet (→ MonoLink falls back to plain text). The head
    SHA pins line numbers (github-urls convention); a changed-symbol call omits
    the line (none in the contract), a caller passes its ref line. */
function blobHref(
  repoFullName: string | null,
  headSha: string | null,
  file: string,
  line?: number,
): string | undefined {
  return repoFullName && headSha ? githubBlobUrl(repoFullName, headSha, file, line) : undefined;
}

/* Escape a repo-derived label for safe embedding inside a Mermaid node. Mermaid
   treats `"` as the quoted-label delimiter and `[]{}()<>` / `|` as structural, so
   we strip/replace those and quote the label. */
function escapeMermaidLabel(raw: string): string {
  return raw
    .replace(/"/g, "'")
    .replace(/[[\]{}()<>|]/g, " ")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/* Build a Mermaid `flowchart` from the blast data: changed-symbol nodes →
   caller nodes → endpoint/cron nodes. Returns null when there is nothing to graph
   or the node count exceeds MAX_GRAPH_NODES (caller falls back to graph.empty). */
function buildMermaid(blast: BlastRadius): string | null {
  if (blast.downstream.length === 0) return null;

  /* classDef palette (decision #3) — LITERAL HEX, not CSS vars: vars are
     unreliable inside the strict-mode sanitized SVG, and the graph is always
     theme:"dark", so the dark-token hex is correct and theme-stable. */
  const lines: string[] = [
    "flowchart LR",
    "  classDef changed  fill:#1c1c1c,stroke:#3b82f6,color:#ededed,stroke-width:2px",
    "  classDef callers  fill:#1c1c1c,stroke:#6a6a6a,color:#ededed,stroke-width:1.5px",
    "  classDef endpoint fill:#1c1c1c,stroke:#10b981,color:#ededed,stroke-width:1.5px",
    "  classDef cron     fill:#1c1c1c,stroke:#f59e0b,color:#ededed,stroke-width:1.5px",
  ];
  const declared = new Set<string>();
  let nodeSeq = 0;
  const idFor = new Map<string, string>();

  // group → classDef name; the inline `:::class` is applied as a node is first
  // declared (decision #3: sym→changed, caller→callers, ep→endpoint, cron→cron).
  const node = (
    groupKey: "sym" | "caller" | "ep" | "cron",
    cls: string,
    label: string,
  ): string | null => {
    const cacheKey = `${groupKey} ${label}`;
    const existing = idFor.get(cacheKey);
    if (existing) return existing;
    if (declared.size >= MAX_GRAPH_NODES) return null;
    const id = `n${nodeSeq++}`;
    idFor.set(cacheKey, id);
    declared.add(id);
    lines.push(`  ${id}["${escapeMermaidLabel(label)}"]:::${cls}`);
    return id;
  };

  let edges = 0;
  for (const d of blast.downstream) {
    const symId = node("sym", "changed", d.symbol);
    if (!symId) break;
    for (const c of d.callers) {
      const callerId = node("caller", "callers", c.name);
      if (!callerId) break;
      lines.push(`  ${symId} --> ${callerId}`);
      edges++;
      for (const ep of d.endpoints_affected) {
        const epId = node("ep", "endpoint", ep);
        if (!epId) break;
        lines.push(`  ${callerId} --> ${epId}`);
        edges++;
      }
      for (const cr of d.crons_affected) {
        const crId = node("cron", "cron", cr);
        if (!crId) break;
        lines.push(`  ${callerId} --> ${crId}`);
        edges++;
      }
    }
  }

  if (edges === 0) return null;
  return lines.join("\n");
}
