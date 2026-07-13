import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalSkillCaseDelta } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";
import { DeltaFindings } from "./DeltaFindings";

afterEach(cleanup);

function renderDelta(delta: EvalSkillCaseDelta | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <DeltaFindings delta={delta} />
    </NextIntlClientProvider>,
  );
}

describe("DeltaFindings", () => {
  it("renders a severity·category chip, location and a TEXT classification per row (AC-30)", () => {
    renderDelta({
      findings: [
        { file: "src/auth.ts", start_line: 10, end_line: 12, severity: "CRITICAL", category: "security", title: "Hardcoded secret", classification: "caught" },
        { file: "src/util.ts", start_line: 4, end_line: 4, severity: "WARNING", category: "bug", title: "Off-by-one", classification: "noise" },
      ],
    });
    // Chip carries severity·category.
    expect(screen.getByText("CRITICAL·security")).toBeInTheDocument();
    expect(screen.getByText("WARNING·bug")).toBeInTheDocument();
    // Location and title are shown.
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("src/auth.ts:10")).toBeInTheDocument();
    // Classification is conveyed as TEXT, not colour alone.
    expect(screen.getByText("caught")).toBeInTheDocument();
    expect(screen.getByText("noise")).toBeInTheDocument();
  });

  it("shows empty-delta copy when the skill added no findings (AC-15)", () => {
    renderDelta({ findings: [] });
    expect(screen.getByText("This skill added no findings on this case.")).toBeInTheDocument();
  });

  it("treats a null delta as empty", () => {
    renderDelta(null);
    expect(screen.getByText("This skill added no findings on this case.")).toBeInTheDocument();
  });
});
