/**
 * Deterministic scorer — no model. Fraction of expected slots present in the output.
 * Use as a cheap first tier: don't pay the judge for what a substring settles.
 *
 * A slot is either a single required substring, or an array of ALTERNATIVES — the slot counts
 * as present when ANY alternative appears. Use alternatives when the artifact under test
 * canonically teaches more than one name for the same thing (e.g. the onion skill's rule 9
 * names both `dependency-cruiser` and its project gate `pnpm arch:check`), so a paraphrase
 * that is faithful to the skill doesn't fail the gate.
 */

export type ExpectedPattern = string | string[];

export function patternMatch(output: string, expected: ExpectedPattern[]): number {
  if (expected.length === 0) return 1;
  const low = output.toLowerCase();
  const hit = (e: string) => low.includes(e.toLowerCase());
  return expected.filter((slot) => (Array.isArray(slot) ? slot.some(hit) : hit(slot))).length / expected.length;
}
