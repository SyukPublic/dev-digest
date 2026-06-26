import type { SmartDiffRole } from '@devdigest/shared';
import {
  BOILERPLATE_PATTERNS,
  WIRING_PATTERNS,
  LARGE_FILE_LINES,
} from './constants.js';

/**
 * Classify a changed file into a Smart Diff role — pure, deterministic, and
 * case-insensitive on the path. No IO, no DB, no LLM.
 *
 * Precedence (most-specific first): boilerplate > wiring > core (default).
 *  - An explicit boilerplate match always wins (generated files are never core).
 *  - Otherwise an explicit wiring match makes it wiring…
 *  - …UNLESS the file is "large" (the size signal): a wiring-looking file with a
 *    big diff is more likely substantive logic, so the tie breaks toward core.
 *    The size signal ONLY affects this wiring tie-break — it never overrides a
 *    boilerplate match nor reclassifies a core file.
 *  - Anything matching neither list is core (real business logic).
 */
export function classifyFile(
  path: string,
  additions: number,
  deletions: number,
): SmartDiffRole {
  const p = path.toLowerCase();

  if (BOILERPLATE_PATTERNS.some((re) => re.test(p))) {
    return 'boilerplate';
  }

  if (WIRING_PATTERNS.some((re) => re.test(p))) {
    // Size signal: a large wiring file leans toward core (more likely real logic).
    const changed = additions + deletions;
    if (changed > LARGE_FILE_LINES) {
      return 'core';
    }
    return 'wiring';
  }

  return 'core';
}
