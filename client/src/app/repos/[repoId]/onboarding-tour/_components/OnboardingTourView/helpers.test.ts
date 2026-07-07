import { describe, it, expect } from "vitest";
import {
  relativeTimeAgo,
  fileViewerHref,
  SECTION_ORDER,
  FIRST_TASKS_MAX_LINKS,
  parseNumberedList,
  sanitizeReadingPathLabel,
} from "./helpers";

/**
 * helpers.ts — pure-function unit tests for the Onboarding Tour view glue.
 * These are only indirectly exercised by OnboardingTourView.test.tsx (which
 * fixes `generatedAt` to "now", covering exactly one relativeTimeAgo bucket).
 * `now` is injectable specifically so this logic is directly testable
 * (per the file's own doc comment) — exercise the remaining buckets here.
 */

describe("relativeTimeAgo (AC-1 meta line)", () => {
  const now = Date.parse("2026-07-05T12:00:00.000Z");

  it("returns null when the timestamp is absent", () => {
    expect(relativeTimeAgo(null, now)).toBeNull();
    expect(relativeTimeAgo(undefined, now)).toBeNull();
  });

  it("returns null for an unparseable timestamp", () => {
    expect(relativeTimeAgo("not-a-date", now)).toBeNull();
  });

  it("formats a few-seconds-ago timestamp in the 'second' bucket", () => {
    const iso = new Date(now - 30_000).toISOString();
    expect(relativeTimeAgo(iso, now)).toMatch(/second/);
  });

  it("formats a minutes-ago timestamp in the 'minute' bucket", () => {
    const iso = new Date(now - 5 * 60_000).toISOString();
    expect(relativeTimeAgo(iso, now)).toMatch(/minute/);
  });

  it("formats an hours-ago timestamp in the 'hour' bucket", () => {
    const iso = new Date(now - 3 * 3_600_000).toISOString();
    expect(relativeTimeAgo(iso, now)).toMatch(/hour/);
  });

  it("formats a days-ago timestamp in the 'day' bucket", () => {
    const iso = new Date(now - 2 * 86_400_000).toISOString();
    expect(relativeTimeAgo(iso, now)).toMatch(/day/);
  });

  it("formats a months-ago timestamp in the 'month' bucket", () => {
    const iso = new Date(now - 60 * 86_400_000).toISOString();
    expect(relativeTimeAgo(iso, now)).toMatch(/month/);
  });

  it("formats a years-ago timestamp in the 'year' bucket", () => {
    const iso = new Date(now - 400 * 86_400_000).toISOString();
    expect(relativeTimeAgo(iso, now)).toMatch(/year/);
  });
});

describe("fileViewerHref (AC-17 Open link)", () => {
  it("builds a github blob URL when both repoFullName and ref are known", () => {
    expect(fileViewerHref("acme/payments-api", "main", "src/server.ts")).toBe(
      "https://github.com/acme/payments-api/blob/main/src/server.ts",
    );
  });

  it("returns undefined when repoFullName is missing", () => {
    expect(fileViewerHref(null, "main", "src/server.ts")).toBeUndefined();
  });

  it("returns undefined when ref is missing", () => {
    expect(fileViewerHref("acme/payments-api", null, "src/server.ts")).toBeUndefined();
  });
});

describe("SECTION_ORDER (AC-1, AC-12 fixed card order)", () => {
  it("lists exactly the seven Onboarding kinds, in the spec's fixed order", () => {
    expect(SECTION_ORDER.map((c) => c.kind)).toEqual([
      "overview",
      "architecture",
      "key_modules",
      "reading_path",
      "getting_started",
      "conventions_gotchas",
      "first_tasks",
    ]);
  });

  it("gives every section a unique anchor id (TOC + card wrapper rely on this)", () => {
    const anchors = SECTION_ORDER.map((c) => c.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
  });
});

describe("FIRST_TASKS_MAX_LINKS (AC-17 first_tasks link cap)", () => {
  it("caps first_tasks links at 4, per the design brief", () => {
    expect(FIRST_TASKS_MAX_LINKS).toBe(4);
  });
});

/**
 * R1b reading-path source logic (T24 parser, T25 sanitizer). Pure functions, so
 * tested in isolation without RTL. Covers the clean count-matching list (AC-19),
 * multi-line folded items, malformed / no-list → [] (AC-21), and the label
 * sanitizer's "N." strip + filename/empty → path alone (AC-20).
 */
describe("parseNumberedList (R1b, AC-19/AC-21)", () => {
  it("parses a clean top-level numbered list, one item per number, marker stripped", () => {
    const body = [
      "1. `server/src/db/schema/_shared.ts` — Foundation: shared DB utilities.",
      "2. `server/src/index.ts` — Boots the Fastify server.",
      "3. `client/src/app/page.tsx` — The studio entry page.",
    ].join("\n");
    expect(parseNumberedList(body)).toEqual([
      "`server/src/db/schema/_shared.ts` — Foundation: shared DB utilities.",
      "`server/src/index.ts` — Boots the Fastify server.",
      "`client/src/app/page.tsx` — The studio entry page.",
    ]);
  });

  it("folds multi-line continuation lines into ONE inline item until the next number", () => {
    const body = [
      "1. `a.ts` — Start here to understand the base schema patterns.",
      "   It also holds the `now()` helper used everywhere.",
      "2. `b.ts` — The next file.",
    ].join("\n");
    const items = parseNumberedList(body);
    expect(items).toHaveLength(2);
    expect(items[0]).toBe(
      "`a.ts` — Start here to understand the base schema patterns. It also holds the `now()` helper used everywhere.",
    );
    expect(items[1]).toBe("`b.ts` — The next file.");
  });

  it("folds across a blank line inside an item (still one item)", () => {
    const body = ["1. First line.", "", "   still first.", "2. Second."].join("\n");
    const items = parseNumberedList(body);
    expect(items).toHaveLength(2);
    expect(items[0]).toBe("First line. still first.");
    expect(items[1]).toBe("Second.");
  });

  it("ignores preamble prose before the first numbered line", () => {
    const body = ["Read these files in order:", "1. `a.ts` — one", "2. `b.ts` — two"].join("\n");
    expect(parseNumberedList(body)).toEqual(["`a.ts` — one", "`b.ts` — two"]);
  });

  it("returns [] for empty / null / undefined body", () => {
    expect(parseNumberedList("")).toEqual([]);
    expect(parseNumberedList(null)).toEqual([]);
    expect(parseNumberedList(undefined)).toEqual([]);
  });

  it("returns [] for prose with no numbered list (malformed / parse failure)", () => {
    expect(parseNumberedList("Just a paragraph of prose.\nAnother line.")).toEqual([]);
    // A bullet list is NOT a top-level numbered list.
    expect(parseNumberedList("- one\n- two")).toEqual([]);
  });

  it("counts items so the caller can detect a mismatch vs links.length", () => {
    // 3 parsed items — the renderer compares this against links.length.
    expect(parseNumberedList("1. one\n2. two\n3. three")).toHaveLength(3);
  });
});

describe("sanitizeReadingPathLabel (R1b, AC-20)", () => {
  it("strips a leading duplicate 'N.' prefix from the label", () => {
    expect(sanitizeReadingPathLabel("1. Foundation: shared utilities", "server/src/_shared.ts")).toBe(
      "Foundation: shared utilities",
    );
    expect(sanitizeReadingPathLabel("12.   Route wiring", "src/routes.ts")).toBe("Route wiring");
  });

  it("keeps a real description label unchanged", () => {
    expect(sanitizeReadingPathLabel("Entry point — boots the server", "src/server.ts")).toBe(
      "Entry point — boots the server",
    );
  });

  it("returns null for an empty / whitespace-only / absent label (→ render path alone)", () => {
    expect(sanitizeReadingPathLabel("", "src/x.ts")).toBeNull();
    expect(sanitizeReadingPathLabel("   ", "src/x.ts")).toBeNull();
    expect(sanitizeReadingPathLabel(null, "src/x.ts")).toBeNull();
    expect(sanitizeReadingPathLabel(undefined, "src/x.ts")).toBeNull();
  });

  it("returns null when the sanitized label equals the path's filename (junk, no description)", () => {
    expect(sanitizeReadingPathLabel("_shared.ts", "server/src/db/schema/_shared.ts")).toBeNull();
    // Old-prompt junk: "1. _shared.ts" → strip number → "_shared.ts" == filename → null.
    expect(sanitizeReadingPathLabel("1. _shared.ts", "server/src/db/schema/_shared.ts")).toBeNull();
  });

  it("returns null when the label equals the full path", () => {
    expect(sanitizeReadingPathLabel("src/server.ts", "src/server.ts")).toBeNull();
  });
});
