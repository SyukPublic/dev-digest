import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RunCostBadge } from "./RunCostBadge";

afterEach(cleanup);

describe("RunCostBadge", () => {
  it("compact: shows just the cost", () => {
    render(<RunCostBadge costUsd={0.012} />);
    expect(screen.getByText("$0.0120")).toBeInTheDocument();
  });

  it("withTokens: shows total tokens and cost together", () => {
    render(<RunCostBadge costUsd={0.0013} tokensIn={9000} tokensOut={119} variant="withTokens" />);
    expect(screen.getByText("9 119 tok · $0.0013")).toBeInTheDocument();
  });

  it("unknown cost renders '—', never '$0.00'", () => {
    render(<RunCostBadge costUsd={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
