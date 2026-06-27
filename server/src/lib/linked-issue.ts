/**
 * Parse a PR body for a linked-issue reference (`#123`, `closes #123`,
 * `fixes #123`, `resolves #123`). Single source of truth shared by the GitHub
 * adapter (`OctokitGitHubClient.resolveLinkedIssue`) and the intent classifier
 * (`classifyIntent`) so the pattern cannot drift between the two call sites.
 *
 * Cross-repo refs (`owner/repo#123`) are intentionally ignored: the `#` must not
 * be preceded by a word char or `/`, so only a same-repo bare ref resolves.
 *
 * @returns the referenced issue NUMBER, or `null` when the body has no ref.
 */
export function parseLinkedIssueRef(body: string): number | null {
  const m = body.match(/(?:closes|fixes|resolves)?\s*(?<![\w/])#(\d+)/i);
  return m?.[1] ? Number(m[1]) : null;
}
