import { describe, it, expect } from "vitest";
import { relativeTimeAgo, fileViewerHref, SECTION_ORDER, FIRST_TASKS_MAX_LINKS } from "./helpers";

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
