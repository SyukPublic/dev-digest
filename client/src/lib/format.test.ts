import { describe, it, expect } from "vitest";
import { formatCost, formatTokensTotal, formatAcceptRate, formatPct } from "./format";

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

describe("formatAcceptRate (AC-8)", () => {
  it("shows '—' for unknown accept-rate (never '0%')", () => {
    expect(formatAcceptRate(null)).toBe("—");
    expect(formatAcceptRate(undefined)).toBe("—");
  });

  it("renders a genuine zero rate as '0%', distinct from unknown", () => {
    expect(formatAcceptRate(0)).toBe("0%");
  });

  it("rounds a 0..1 rate to a whole percent", () => {
    expect(formatAcceptRate(0.78)).toBe("78%");
    expect(formatAcceptRate(0.615)).toBe("62%");
  });
});

describe("formatPct", () => {
  it("shows '—' for unknown share and '0%' for a genuine zero", () => {
    expect(formatPct(null)).toBe("—");
    expect(formatPct(0)).toBe("0%");
    expect(formatPct(0.71)).toBe("71%");
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
