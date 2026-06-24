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
 * When `category` is given, the framing line scopes the skill to that category.
 */
export function buildSkillBody(
  name: string,
  repoName: string,
  candidates: ConventionCandidate[],
  category?: string,
): string {
  const lines: string[] = [`# ${name}`, ""];
  const scope = category ? `\`${category}\` conventions` : "conventions";
  lines.push(
    `House ${scope} for \`${repoName}\`. Flag changes that violate any rule below and cite the offending \`file:line\`.`,
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

/** `<repo>-conventions-<category>` — the per-category skill name (slugged). */
export function categorySkillName(repoName: string, category: string): string {
  return `${slugify(repoName) || "repo"}-conventions-${slugify(category)}`;
}

/** One generated skill, derived purely from the accepted candidates of one category. */
export interface ConventionSkillPlan {
  /** Group key — same rule as `groupByCategory`: `category?.trim() || "general"`. */
  category: string;
  name: string;
  body: string;
  evidenceFiles: string[];
  /** Rules in this category (drives the preview count + description). */
  count: number;
}

/**
 * Plan ONE skill per non-empty category of the accepted candidates. Grouping
 * mirrors `groupByCategory` (`category?.trim() || "general"`); output is sorted
 * by category so the modal preview and the submit loop agree (deterministic).
 * Pure: the i18n description is added by the caller, not baked in here.
 */
export function planSkillsFromConventions(
  repoName: string,
  candidates: ConventionCandidate[],
): ConventionSkillPlan[] {
  const groups = new Map<string, ConventionCandidate[]>();
  for (const c of candidates) {
    const key = c.category?.trim() || "general";
    const arr = groups.get(key);
    if (arr) arr.push(c);
    else groups.set(key, [c]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, items]) => {
      const name = categorySkillName(repoName, category);
      return {
        category,
        name,
        body: buildSkillBody(name, repoName, items, category),
        evidenceFiles: [...new Set(items.map((c) => c.evidence_path).filter(Boolean))],
        count: items.length,
      };
    });
}
