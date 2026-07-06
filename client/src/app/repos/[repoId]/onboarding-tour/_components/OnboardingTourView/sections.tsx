/* sections.tsx — per-section renderers for the Onboarding Tour cards. Each
   renderer takes an `OnboardingSection` (facade-authoritative data) and renders
   its body as DATA: prose via <Markdown> (no script — AC-16), the architecture
   mermaid via <MermaidDiagram> (invalid dropped, section still renders — AC-16),
   reading_path in response order with an Open file-viewer link (AC-3, AC-17),
   and getting_started command rows with copy buttons (AC-17). Presentational
   only; the fixed card order + collapsing lives in the parent view. */
"use client";

import React from "react";
import { IconBtn, Markdown, MonoLink, useCopyToClipboard } from "@devdigest/ui";
import MermaidDiagram from "@/components/mermaid-diagram/MermaidDiagram";
import type { OnboardingSection } from "@devdigest/shared";
import {
  fileViewerHref,
  FIRST_TASKS_MAX_LINKS,
  parseNumberedList,
  sanitizeReadingPathLabel,
} from "./helpers";
import { s } from "./styles";

interface SectionProps {
  section: OnboardingSection;
  repoFullName: string | null | undefined;
  /** git ref the file-viewer links pin to (repo default branch). Named `gitRef`
   *  (not `ref`) so React never treats it as a component ref. */
  gitRef: string | null | undefined;
  /** i18n label for each row's "Open" control. */
  openLabel: string;
  /** i18n label for each command row's copy control. */
  copyLabel: string;
}

/** architecture — narrative body + the model diagram (best-effort mermaid). */
export function ArchitectureSection({ section }: Pick<SectionProps, "section">) {
  return (
    <div>
      <Markdown>{section.body}</Markdown>
      {section.diagram ? <MermaidDiagram chart={section.diagram} /> : null}
    </div>
  );
}

/** reading_path — ONE list driven by the facade-authoritative `links[]` order
 *  (AC-1). Each entry is a description row (single correct number "<n>.", the
 *  file path as an inline-code badge, an em-dash, then the description) above an
 *  indented row with the monospace file path and the Open file-viewer deep-link
 *  at the right edge.
 *
 *  R1b — the description SOURCE is chosen per render (AC-19/AC-20/AC-21):
 *  - WHEN `section.body` holds a top-level numbered list whose parsed item count
 *    EQUALS `links.length`, each parsed item (already folded to one inline line)
 *    is the description of the entry at the same index — so an ALREADY-STORED
 *    (old-prompt) tour, whose real per-file description lives only in the body
 *    list while `link.label` is junk, reaches the intended look WITHOUT
 *    regeneration.
 *  - OTHERWISE (no usable body list, count mismatch, parse failure, empty body)
 *    the description is composed as "N. `path` — <sanitized label>", dropping
 *    the dash + label when the label is empty / a junk "N." prefix / equal to
 *    the filename → "N. `path`" alone. Never doubled numbering, never a blank
 *    row (AC-20).
 *
 *  Every description is rendered through the shared `<Markdown>` as
 *  Markdown-as-DATA (inline code / bold preserved; no `dangerouslySetInnerHTML`
 *  — AC-22/AC-16); it is a SINGLE inline line, which is all the inline-only
 *  `<Markdown>` styles (client INSIGHTS 2026-06-23). The Open href stays
 *  `fileViewerHref` (AC-5). Zero LLM calls on read (client-render only, AC-23). */
export function ReadingPathSection({ section, repoFullName, gitRef, openLabel }: SectionProps) {
  // Use the body numbered list ONLY when its item count matches links exactly —
  // a mismatch would mis-map descriptions to files (R1b correctness pivot).
  const bodyItems = parseNumberedList(section.body);
  const useBody = bodyItems.length === section.links.length && section.links.length > 0;

  return (
    <ol style={s.pathList}>
      {section.links.map((link, i) => {
        const href = fileViewerHref(repoFullName, gitRef, link.path);
        // The description is a single INLINE markdown string WITHOUT a leading
        // number — a leading "N. " would be parsed by react-markdown as an
        // ordered-list marker (renumbered, wrapped in <ol><li>), so the number
        // is rendered SEPARATELY as a bold span (single, correct number — no
        // doubling). Body-list item (R1b AC-19) or the sanitized
        // "`path` — label" / "`path`" fallback (AC-20).
        const description = useBody ? bodyItems[i]! : composeReadingPathDescription(link.path, link.label);
        return (
          <li key={`${link.path}-${i}`} style={s.pathRow}>
            <div style={s.pathRationale}>
              <span style={s.pathNum}>{i + 1}.</span>
              <span style={s.pathDesc}>
                <Markdown>{description}</Markdown>
              </span>
            </div>
            <div style={s.pathPathRow}>
              <span className="mono" style={s.pathPath}>
                {link.path}
              </span>
              <MonoLink href={href}>{openLabel}</MonoLink>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Compose the AC-20 fallback description (WITHOUT a leading number — the caller
 *  renders the number separately): "`path` — label" when the sanitized label
 *  carries a real description, else "`path`" alone (no dash, no junk label). The
 *  path is wrapped in inline-code backticks so `<Markdown>` renders it as the
 *  badge. */
function composeReadingPathDescription(path: string, label: string | null | undefined): string {
  const desc = sanitizeReadingPathLabel(label, path);
  return desc ? `\`${path}\` — ${desc}` : `\`${path}\``;
}

/** A single copyable command row (own copy state via useCopyToClipboard). */
function CommandRow({ step, command, copyLabel }: { step: number; command: string; copyLabel: string }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <div style={s.cmdRow}>
      <span aria-hidden="true" style={s.cmdStep}>
        {step}
      </span>
      <code className="mono" style={s.cmd}>
        {command}
      </code>
      <IconBtn icon={copied ? "Check" : "Copy"} label={copyLabel} onClick={() => copy(command)} />
    </div>
  );
}

/** getting_started — command rows parsed from the section body (one per line).
 *  Blank lines are dropped; each surviving line gets a step number + copy button. */
export function GettingStartedSection({ section, copyLabel }: Pick<SectionProps, "section" | "copyLabel">) {
  const commands = section.body
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  return (
    <div>
      {commands.map((command, i) => (
        <CommandRow key={`${i}-${command}`} step={i + 1} command={command} copyLabel={copyLabel} />
      ))}
    </div>
  );
}

/** Narrative markdown card (overview, key_modules, conventions_gotchas). */
export function NarrativeSection({ section }: Pick<SectionProps, "section">) {
  return <Markdown>{section.body}</Markdown>;
}

/** first_tasks — markdown body + up to ~4 links (label + path). */
export function FirstTasksSection({
  section,
  repoFullName,
  gitRef,
}: Pick<SectionProps, "section" | "repoFullName" | "gitRef">) {
  const links = section.links.slice(0, FIRST_TASKS_MAX_LINKS);
  return (
    <div>
      <Markdown>{section.body}</Markdown>
      {links.length > 0 ? (
        <div style={s.linkList}>
          {links.map((link, i) => {
            const href = fileViewerHref(repoFullName, gitRef, link.path);
            return (
              <div key={`${link.path}-${i}`} style={s.linkRow}>
                <span style={{ color: "var(--text-secondary)" }}>{link.label}</span>
                <MonoLink href={href}>{link.path}</MonoLink>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
