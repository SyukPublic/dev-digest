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
import { fileViewerHref, FIRST_TASKS_MAX_LINKS } from "./helpers";
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

/** reading_path — numbered rows in the response (facade) order. Each row pairs a
 *  link (label = role, path = file) with an Open file-viewer deep-link. */
export function ReadingPathSection({ section, repoFullName, gitRef, openLabel }: SectionProps) {
  return (
    <div>
      {section.body ? <Markdown>{section.body}</Markdown> : null}
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {section.links.map((link, i) => {
          const href = fileViewerHref(repoFullName, gitRef, link.path);
          return (
            <li key={`${link.path}-${i}`} style={s.pathRow}>
              <span aria-hidden="true" style={s.pathBadge}>
                {i + 1}
              </span>
              <div style={s.pathBody}>
                <span className="mono" style={s.pathPath}>
                  {link.path}
                </span>
                {link.label ? <div style={s.pathRationale}>{link.label}</div> : null}
              </div>
              <MonoLink href={href}>{openLabel}</MonoLink>
            </li>
          );
        })}
      </ol>
    </div>
  );
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
