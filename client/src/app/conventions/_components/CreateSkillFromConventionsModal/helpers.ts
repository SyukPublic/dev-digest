import type { ConventionCandidate } from "@devdigest/shared";

/** Pure helpers for composing a skill from accepted conventions. */

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function defaultSkillName(repoName: string): string {
  return `${slugify(repoName) || "repo"}-conventions`;
}

/**
 * Compose a reviewer-ready skill body from the accepted candidates: a framing
 * line + one `##` section per rule, each citing its evidence file + snippet.
 * Pure + deterministic so it's the same in the modal preview and on save.
 */
export function buildSkillBody(
  name: string,
  repoName: string,
  candidates: ConventionCandidate[],
): string {
  const lines: string[] = [`# ${name}`, ""];
  lines.push(
    `House conventions for \`${repoName}\`. Flag changes that violate any rule below and cite the offending \`file:line\`.`,
    "",
  );
  for (const c of candidates) {
    lines.push(`## ${slugify(c.rule)}`);
    lines.push(c.rule, "");
    if (c.evidence_path) {
      lines.push(`Detected in \`${c.evidence_path}\`:`, "");
      if (c.evidence_snippet) lines.push("```", c.evidence_snippet, "```", "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
