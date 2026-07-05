import { describe, it, expect } from "vitest";
import enOnboarding from "../../messages/en/onboarding.json";
import ukOnboarding from "../../messages/uk/onboarding.json";

/**
 * AC-18 (T30) — key-parity check for the Onboarding Tour Generator feature's
 * user-facing strings between `en` (loaded at runtime) and `uk`.
 *
 * Unit under test: the checked-in JSON message files themselves (no
 * component, no next-intl runtime) — a cheap, static parity gate mirroring
 * the Project Context precedent (`project-context-i18n.test.ts`).
 * Input: the `en`/`uk` pair for `onboarding.json` — this feature's whole
 * namespace. The 7 section titles + chrome (buttons, meta, TOC label) +
 * badges + empty/load-error/confirmation strings must exist in BOTH locales.
 * Expected output: every leaf key present on one side is present (with a
 * non-empty string) on the other side too — full bidirectional parity.
 *
 * Model-authored section bodies are CONTENT (generated in the configured
 * language), not UI strings, so they are intentionally absent from both files.
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

describe("Onboarding Tour i18n key parity — en vs uk (AC-18)", () => {
  it("onboarding.json: every en key has a non-empty uk counterpart, and vice versa", () => {
    const enKeys = flatten(enOnboarding as JsonObject);
    const ukKeys = flatten(ukOnboarding as JsonObject);

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
});
