import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { OnboardingSection } from "@devdigest/shared";
import { FirstTasksSection, ReadingPathSection } from "./sections";

/**
 * sections.tsx — per-section renderer tests for behavior not already covered
 * by OnboardingTourView.test.tsx's happy-path fixture (which only ever
 * supplies 2 links per section, so the first_tasks cap was never exercised).
 *
 * Unit under test: `FirstTasksSection` (AC-17 "up to ~4 links").
 * Input: a `first_tasks` section with 6 links.
 * Expected output: only the first 4 render; the 5th/6th are dropped.
 */

function firstTasksSection(linkCount: number): OnboardingSection {
  return {
    kind: "first_tasks",
    title: "First tasks",
    body: "Try these:",
    diagram: null,
    links: Array.from({ length: linkCount }, (_, i) => ({
      label: `Task ${i + 1}`,
      path: `src/tasks/${i + 1}.ts`,
    })),
  };
}

afterEach(cleanup);

describe("FirstTasksSection — link cap (AC-17)", () => {
  it("renders only the first 4 of 6 provided links", () => {
    render(<FirstTasksSection section={firstTasksSection(6)} repoFullName="acme/payments-api" gitRef="main" />);

    for (let i = 1; i <= 4; i++) {
      expect(screen.getByText(`Task ${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByText("Task 5")).not.toBeInTheDocument();
    expect(screen.queryByText("Task 6")).not.toBeInTheDocument();
  });

  it("renders all links when there are 4 or fewer (no over-truncation)", () => {
    render(<FirstTasksSection section={firstTasksSection(2)} repoFullName="acme/payments-api" gitRef="main" />);
    expect(screen.getByText("Task 1")).toBeInTheDocument();
    expect(screen.getByText("Task 2")).toBeInTheDocument();
  });
});

describe("ReadingPathSection — Open link falls back gracefully without repo identity", () => {
  it("renders the row without a resolvable href when repoFullName/ref are unknown", () => {
    const section: OnboardingSection = {
      kind: "reading_path",
      title: "Reading path",
      body: "",
      diagram: null,
      links: [{ label: "Entry point", path: "src/server.ts" }],
    };
    render(<ReadingPathSection section={section} repoFullName={null} gitRef={null} openLabel="Open" copyLabel="Copy" />);

    expect(screen.getByText("src/server.ts")).toBeInTheDocument();
    const open = screen.getByText("Open");
    expect(open.closest("a")).toBeNull();
  });
});
