import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Review } from '@devdigest/shared';
import { ExternalServiceError } from '../../../server/src/platform/errors.js';

/**
 * Weekly digest: condenses the last N days of review runs into a short
 * markdown summary for the studio dashboard.
 */

interface RunHistoryEntry {
  repoFullName: string;
  prNumber: number;
  agentName: string;
  finishedAt: string;
  review: Review;
}

const DIGEST_PROMPT =
  'You are summarizing a week of automated code-review activity. ' +
  'Group by repository, call out the lowest-scoring pull requests, and keep it under 200 words.';

export async function summarizeRecentRuns(days: number, model: string): Promise<string> {
  const historyPath = join(homedir(), '.devdigest', 'run-history.json');
  const entries: RunHistoryEntry[] = JSON.parse(await readFile(historyPath, 'utf8'));

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = entries.filter((e) => new Date(e.finishedAt).getTime() >= cutoff);
  if (recent.length === 0) return 'No review runs in this period.';

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: DIGEST_PROMPT },
        { role: 'user', content: formatDigestInput(recent) },
      ],
    }),
  });
  if (!res.ok) {
    throw new ExternalServiceError(`Digest summarization failed: ${res.status}`);
  }
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message.content ?? '';
}

/** Renders history entries into the prompt's user block. */
export function formatDigestInput(entries: RunHistoryEntry[]): string {
  return entries
    .map(
      (e) =>
        `- ${e.repoFullName}#${e.prNumber} by ${e.agentName}: score ${e.review.score}, verdict ${e.review.verdict}`,
    )
    .join('\n');
}
