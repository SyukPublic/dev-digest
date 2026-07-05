import { describe, it, expect } from "vitest";
import enBrief from "../../messages/en/brief.json";
import ukBrief from "../../messages/uk/brief.json";

/**
 * AC-17 (T29) — key-parity check for the Why/Risk PR Brief feature's
 * user-facing strings between `en` (loaded at runtime) and `uk`.
 *
 * Unit under test: the checked-in JSON message files themselves (no
 * component, no next-intl runtime) — a cheap, static parity gate mirroring
 * the Onboarding/Project Context precedent (`onboarding-i18n.test.ts`).
 * Input: the `en`/`uk` pair for `brief.json` — this feature's whole namespace
 * (existing intent/scope keys REUSED by IntentCard + the NEW PrBriefCard /
 * ReviewFocusSection keys: PR Brief card, verdict, findings/blockers pill, PR
 * Score gauge text, Outdated caveat, risk-level labels/tooltips, REVIEW FOCUS
 * heading). The `uk` file is forward-looking (single-locale at runtime today).
 * Expected output: every leaf key present on one side is present (with a
 * non-empty string) on the other side too — full bidirectional parity — and
 * every ICU placeholder ({findings}, {blockers}, {score}, {count}) matches
 * across locales so the mirror can never silently drop an interpolation.
 *
 * Model-authored brief body text is CONTENT (generated in the configured
 * language), not a UI string, so it is intentionally absent from both files.
 */

type JsonObject = { [key: string]: unknown };

function flatten(obj: JsonObject, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of flatten(value as JsonObject, path)) out.set(k, v);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

function placeholders(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return [...value.matchAll(/\{(\w+)/g)]
    .map((m) => m[1])
    .filter((name): name is string => name !== undefined)
    .sort();
}

describe("PR Brief i18n key parity — en vs uk (AC-17)", () => {
  const enKeys = flatten(enBrief as JsonObject);
  const ukKeys = flatten(ukBrief as JsonObject);

  it("brief.json: every en key has a non-empty uk counterpart, and vice versa", () => {
    const missingInUk = [...enKeys.keys()].filter((k) => !ukKeys.has(k));
    const missingInEn = [...ukKeys.keys()].filter((k) => !enKeys.has(k));
    expect(missingInUk).toEqual([]);
    expect(missingInEn).toEqual([]);

    for (const [key, value] of enKeys) {
      if (typeof value === "string") {
        expect(typeof ukKeys.get(key)).toBe("string");
        expect((ukKeys.get(key) as string).length).toBeGreaterThan(0);
      }
    }
  });

  it("brief.json: ICU placeholders match across locales for every key", () => {
    for (const [key, value] of enKeys) {
      expect(placeholders(ukKeys.get(key))).toEqual(placeholders(value));
    }
  });
});
