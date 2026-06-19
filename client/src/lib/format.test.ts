import { describe, it, expect } from "vitest";
import { formatCost, formatTokensTotal } from "./format";

describe("formatCost", () => {
  it("shows '—' for unknown cost (never '$0.00')", () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
  });

  it("renders a genuine zero as a dollar value, not '—'", () => {
    expect(formatCost(0)).toBe("$0.0000");
  });

  it("uses 4 decimals for sub-$0.10 (cent-fraction) costs", () => {
    expect(formatCost(0.0013)).toBe("$0.0013");
    expect(formatCost(0.06)).toBe("$0.0600");
  });

  it("uses 3 decimals at/above $0.10", () => {
    expect(formatCost(0.1)).toBe("$0.100");
    expect(formatCost(0.123)).toBe("$0.123");
  });
});

describe("formatTokensTotal", () => {
  it("sums in+out and space-groups thousands", () => {
    expect(formatTokensTotal(9000, 119)).toBe("9 119 tok");
  });

  it("treats null/undefined as zero", () => {
    expect(formatTokensTotal(null, undefined)).toBe("0 tok");
  });
});
