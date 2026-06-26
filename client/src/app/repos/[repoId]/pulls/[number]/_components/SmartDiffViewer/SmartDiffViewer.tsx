/* SmartDiffViewer — deterministic, risk-ordered file layout for a PR.

   Groups changed files into core → wiring → boilerplate (boilerplate collapsed
   by default), overlays the latest review's findings (line tint, finding dot,
   "N findings" badge, click-to-jump), and renders each file's patch read-only by
   reusing the diff-viewer primitives. NO LLM, NO network here — it composes three
   already-fetched sources (see helpers.joinSmartDiff). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Card,
  SectionLabel,
  SeverityBadge,
  Icon,
  SEV,
  type IconName,
  type Severity,
} from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { usePrSmartDiff, usePrReviews, useFindingAction } from "@/lib/hooks/reviews";
import { usePullDetail } from "@/lib/hooks/core";
import { useActiveRepo } from "@/lib/repo-context";
import { parsePatch } from "@/components/diff-viewer/helpers";
import { CodeLine } from "@/components/diff-viewer/CodeLine";
import { FindingsFilterPopover } from "@/components/findings/FindingsFilterPopover";
import { countBySeverity } from "@/components/findings/helpers";
import { FindingCard } from "../FindingCard";
import {
  joinSmartDiff,
  jumpTargetId,
  tagSeverityByLine,
  findingsByStartLine,
  DEFAULT_OPEN_ROLES,
  type JoinedFile,
  type JoinedGroup,
  type SeverityTally,
} from "./helpers";

type Role = JoinedGroup["role"];

/** Severities rendered in the badge, worst-first. */
const BADGE_SEVERITIES: readonly Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

/** Card-stack ordering: lower rank = worse = rendered first (and the primary
    card that opens auto-expanded/focused). Matches the inline tag, which shows
    the line's worst severity. */
const SEV_RANK: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2, INFO: 3 };

/**
 * Inline per-line tag vocabulary (the design's words, lowercase) — distinct from
 * `SEV.label` ("Critical"/…). i18n keys live under `diffViewer` in shell.json.
 */
const SEV_TAG_KEY: Record<Severity, string> = {
  CRITICAL: "sevBlocker",
  WARNING: "sevWarning",
  SUGGESTION: "sevSuggestion",
  INFO: "sevSuggestion",
};

/** Per-role header copy + icon. Copy keys live in messages/en/shell.json. */
const ROLE_META: Record<Role, { icon: IconName; nameKey: string; descKey: string; dot: string }> = {
  core: { icon: "Cpu", nameKey: "coreGroup", descKey: "coreGroupDesc", dot: "var(--crit)" },
  wiring: { icon: "Wrench", nameKey: "wiringGroup", descKey: "wiringGroupDesc", dot: "var(--warn)" },
  boilerplate: {
    icon: "Boxes",
    nameKey: "boilerplateGroup",
    descKey: "boilerplateGroupDesc",
    dot: "var(--text-muted)",
  },
};

export function SmartDiffViewer({ prId }: { prId: string }) {
  const t = useTranslations("shell");
  const smartDiff = usePrSmartDiff(prId);
  const pull = usePullDetail(prId);
  const reviews = usePrReviews(prId);
  const { activeRepo } = useActiveRepo();

  // Sourced once at the top (single hook calls) and threaded down into FileRow
  // so the inline-tag FindingCards keep the GitHub deep-link (degrades to plain
  // text when either is null — see FindingCard). Not on PrDetail, so repoFullName
  // comes from repo-context like page.tsx does.
  const repoFullName = activeRepo?.full_name ?? null;
  const headSha = pull.data?.head_sha ?? null;

  // Refs to each finding line so the badge can scroll its first finding into view.
  const lineRefs = React.useRef(new Map<string, HTMLDivElement | null>());

  const groups = React.useMemo(
    () => joinSmartDiff(smartDiff.data, pull.data?.files, reviews.data),
    [smartDiff.data, pull.data?.files, reviews.data],
  );

  const scrollToLine = React.useCallback((path: string, lineNo: number) => {
    const node = lineRefs.current.get(jumpTargetId(path, lineNo));
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  if (smartDiff.isLoading) return null;

  if (groups.length === 0) {
    return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("diffViewer.noSmartDiff")}</div>;
  }

  const split = smartDiff.data?.split_suggestion;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {split?.too_big && (
        <Card style={{ borderColor: "var(--warn)", background: "var(--warn-bg)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
            <Icon.AlertTriangle size={15} style={{ color: "var(--warn)" }} />
            {t("diffViewer.splitSuggestion")}
          </div>
          {split.proposed_splits.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--text-secondary)" }}>
              {split.proposed_splits.map((s) => (
                <li key={s.name}>
                  <span className="mono">{s.name}</span> · {s.files.length}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {groups.map((group) => (
        <GroupCard
          key={group.role}
          group={group}
          scrollToLine={scrollToLine}
          lineRefs={lineRefs}
          prId={prId}
          repoFullName={repoFullName}
          headSha={headSha}
        />
      ))}
    </div>
  );
}

function GroupCard({
  group,
  scrollToLine,
  lineRefs,
  prId,
  repoFullName,
  headSha,
}: {
  group: JoinedGroup;
  scrollToLine: (path: string, lineNo: number) => void;
  lineRefs: React.MutableRefObject<Map<string, HTMLDivElement | null>>;
  prId: string;
  repoFullName: string | null;
  headSha: string | null;
}) {
  const t = useTranslations("shell");
  const meta = ROLE_META[group.role];
  const [open, setOpen] = React.useState(DEFAULT_OPEN_ROLES.has(group.role));

  return (
    <Card pad={false}>
      {/* Padding lives on this wrapper (not the inner span) so SectionLabel's
          alignItems:center keeps the icon, name, description and chevron on one
          centered baseline (R2.3). */}
      <div style={{ padding: "12px 16px 0" }}>
        <SectionLabel
          icon={meta.icon}
          right={
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={t(`diffViewer.${meta.nameKey}`)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}
            >
              <Icon.ChevronRight
                size={14}
                style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" }}
              />
            </button>
          }
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span>{t(`diffViewer.${meta.nameKey}`)}</span>
            <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "var(--text-muted)" }}>
              {t(`diffViewer.${meta.descKey}`)} · {t("diffViewer.fileCount", { count: group.files.length })}
            </span>
          </span>
        </SectionLabel>
      </div>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 12px 12px" }}>
          {group.files.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              scrollToLine={scrollToLine}
              lineRefs={lineRefs}
              prId={prId}
              repoFullName={repoFullName}
              headSha={headSha}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function totalFindings(tally: SeverityTally): number {
  return BADGE_SEVERITIES.reduce((sum, sev) => sum + tally[sev], 0);
}

/**
 * Card-mode body of the inline-tag popover: the line's findings as full
 * FindingCards, worst-severity-first. Only the primary (worst / tag-matching)
 * card opens expanded + focused; the rest start collapsed (chevron still
 * toggles each). `pending` is per-finding so only the acted-on card disables.
 * Source list is the LIVE findingsAtLine (passed by FileRow), not a snapshot.
 */
function FindingCardStack({
  findings,
  prId,
  repoFullName,
  headSha,
  action,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName: string | null;
  headSha: string | null;
  action: ReturnType<typeof useFindingAction>;
}) {
  const ordered = [...findings].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const primaryId = ordered[0]?.id;
  return (
    <>
      {ordered.map((f) => (
        <FindingCard
          key={f.id}
          f={f}
          defaultExpanded={f.id === primaryId}
          focused={f.id === primaryId}
          pending={action.isPending && action.variables?.findingId === f.id}
          repoFullName={repoFullName}
          headSha={headSha}
          onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
        />
      ))}
    </>
  );
}

function FileRow({
  file,
  scrollToLine,
  lineRefs,
  prId,
  repoFullName,
  headSha,
}: {
  file: JoinedFile;
  scrollToLine: (path: string, lineNo: number) => void;
  lineRefs: React.MutableRefObject<Map<string, HTMLDivElement | null>>;
  prId: string;
  repoFullName: string | null;
  headSha: string | null;
}) {
  const t = useTranslations("shell");
  const action = useFindingAction();
  const [open, setOpen] = React.useState(false);
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);
  const findingLineSet = React.useMemo(() => new Set(file.finding_lines), [file.finding_lines]);
  // start_line → worst severity for the inline per-line tag (one tag per finding,
  // on its start line — distinct from the whole-range tint in severityByLine).
  const tagByLine = React.useMemo(() => tagSeverityByLine(file.findings), [file.findings]);
  // start_line → that line's non-dismissed findings, so a tag click can scope the
  // shared popover to exactly that line's finding(s) (R3.2).
  const findingsAtLine = React.useMemo(() => findingsByStartLine(file.findings), [file.findings]);

  // ONE popover per file, shared by the header badge and every inline tag (R3.3).
  // `key` identifies the active trigger so re-clicking it toggles closed and a
  // different trigger replaces the content; `findings` scopes what the popover shows.
  // null ⇒ closed (the popover unmounts, resetting its severity filter on next open).
  const [popover, setPopover] = React.useState<
    { anchor: DOMRect; findings: FindingRecord[]; key: string } | null
  >(null);
  const togglePopover = React.useCallback(
    (key: string, findings: FindingRecord[], el: HTMLElement) =>
      setPopover((cur) =>
        cur?.key === key ? null : { anchor: el.getBoundingClientRect(), findings, key },
      ),
    [],
  );
  const closePopover = React.useCallback(() => setPopover(null), []);

  const hasFindings = file.finding_lines.length > 0;
  const totalCount = totalFindings(file.severityTally);

  // PrFindingCounts derived from the CURRENTLY-shown findings so the popover's
  // severity chips match its scope (all the file's findings for the badge, just
  // the line's for an inline tag). Same shape the PR-list / timeline popovers pass.
  const counts = React.useMemo(
    () => countBySeverity(popover?.findings ?? []),
    [popover?.findings],
  );

  // Jump-to-line preserved as the popover's onPick: close, open the body, scroll.
  const onPick = React.useCallback(
    (finding: FindingRecord) => {
      closePopover();
      setOpen(true);
      const lineNo = Math.min(finding.start_line, finding.end_line);
      // Defer so the file body has rendered its line refs before scrolling.
      requestAnimationFrame(() => scrollToLine(file.path, lineNo));
    },
    [closePopover, scrollToLine, file.path],
  );

  // Card-mode (inline-tag) state. The popover key is `line-${lineNo}` for the
  // tag path and "badge" for the header badge; only the tag path renders cards.
  const isCardMode = popover?.key.startsWith("line-") ?? false;
  const openLineNo = isCardMode ? Number(popover!.key.slice("line-".length)) : null;
  // Live source (NOT the captured popover.findings snapshot): recomputed from
  // file.findings each render so an accept updates a card in place and a dismiss
  // drops it after refetch. findingsAtLine is keyed by the finding start line.
  const liveFindings = openLineNo != null ? (findingsAtLine.get(openLineNo) ?? []) : [];

  // Auto-close once the open tag line empties out (e.g. last finding dismissed
  // and reviews refetched). Guarded to the tag path so the badge path is never
  // auto-closed. Syncing closure to external (server) state ⇒ an effect is the
  // right tool here, not a derived value.
  React.useEffect(() => {
    if (isCardMode && liveFindings.length === 0) closePopover();
  }, [isCardMode, liveFindings.length, closePopover]);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", cursor: "pointer" }}
      >
        <Icon.ChevronRight
          size={13}
          style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .12s", flexShrink: 0 }}
        />
        <span className="mono" style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {file.path}
        </span>
        {hasFindings && (
          <span
            data-testid="finding-dot"
            aria-hidden
            style={{ width: 7, height: 7, borderRadius: 99, background: "var(--crit)", flexShrink: 0 }}
          />
        )}
        {totalCount > 0 && (
          <button
            type="button"
            // Stop propagation so the badge/popover click doesn't toggle the
            // row's collapse (see client INSIGHTS: row-anchored popover). Routes
            // through the unified popover state — appearance/placement unchanged.
            onClick={(e) => {
              e.stopPropagation();
              togglePopover("badge", file.findings, e.currentTarget);
            }}
            aria-label={t("diffViewer.findingsBadge", { count: totalCount })}
            style={{ display: "inline-flex", gap: 4, background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            {BADGE_SEVERITIES.filter((sev) => file.severityTally[sev] > 0).map((sev) => (
              <SeverityBadge key={sev} severity={sev} count={file.severityTally[sev]} compact />
            ))}
          </button>
        )}
        <span className="mono tnum" style={{ fontSize: 12 }}>
          <span style={{ color: "var(--code-add-text)" }}>+{file.additions}</span>{" "}
          <span style={{ color: "var(--code-del-text)" }}>−{file.deletions}</span>
        </span>
      </div>

      {popover && (
        <FindingsFilterPopover
          counts={counts}
          findings={popover.findings}
          title={t("diffViewer.findingsTitle")}
          closeLabel={t("diffViewer.findingsClose")}
          emptyTitle={t("diffViewer.findingsEmptyTitle")}
          emptyBody={t("diffViewer.findingsEmptyBody")}
          anchor={popover.anchor}
          onClose={closePopover}
          // Card-mode (inline tag): render a self-contained stack of full
          // FindingCards; no onPick (no scroll-to-line navigation). Badge path:
          // keep the condensed list with jump-to-line onPick (decisions #1/#4).
          {...(isCardMode
            ? {
                renderContent: (
                  <FindingCardStack
                    findings={liveFindings}
                    prId={prId}
                    repoFullName={repoFullName}
                    headSha={headSha}
                    action={action}
                  />
                ),
              }
            : { onPick })}
        />
      )}

      {open && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          {file.pseudocode_summary && (
            <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" }}>
              {file.pseudocode_summary}
            </div>
          )}
          {lines.map((ln, i) => {
            const lineNo = ln.newNo ?? ln.oldNo;
            const isFinding = lineNo != null && findingLineSet.has(lineNo);
            const sev = lineNo != null ? file.severityByLine.get(lineNo) : undefined;
            const tint = sev ? SEV[sev] : null;
            // One inline tag per finding, on its start line (not every covered line).
            const tagSev = lineNo != null ? tagByLine.get(lineNo) : undefined;
            return (
              <div
                key={i}
                id={isFinding && lineNo != null ? jumpTargetId(file.path, lineNo) : undefined}
                ref={
                  isFinding && lineNo != null
                    ? (node) => {
                        lineRefs.current.set(jumpTargetId(file.path, lineNo), node);
                      }
                    : undefined
                }
                data-finding-line={isFinding ? lineNo : undefined}
                style={{
                  position: "relative",
                  ...(tint ? { background: tint.bg, boxShadow: `inset 2px 0 0 ${tint.c}` } : {}),
                }}
              >
                <CodeLine ln={ln} path={file.path} threads={[]} />
                {tagSev && lineNo != null && (
                  <button
                    type="button"
                    aria-label={t(`diffViewer.${SEV_TAG_KEY[tagSev]}`)}
                    // Click opens the shared popover scoped to THIS line's
                    // finding(s) (R3.1). Anchor via e.currentTarget — no per-tag
                    // ref, since a file can have many tags. stopPropagation so the
                    // click doesn't toggle the row collapse.
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePopover(`line-${lineNo}`, findingsAtLine.get(lineNo) ?? [], e.currentTarget);
                    }}
                    style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      zIndex: 2,
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                    }}
                  >
                    <Badge color={SEV[tagSev].c} bg={SEV[tagSev].bg} icon={SEV[tagSev].icon}>
                      {t(`diffViewer.${SEV_TAG_KEY[tagSev]}`)}
                    </Badge>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
