import { describe, expect, it } from "vitest";

import { incidentAmountDisplay } from "@/components/risks/amount";

describe("incidentAmountDisplay", () => {
  it("NO_RISK with a known margin: no shortfall plus headroom, never Unknown", () => {
    expect(incidentAmountDisplay({ category: "NO_RISK", amountCents: null }, 1020000)).toEqual({
      text: "No shortfall · $10,200.00 headroom",
      tone: "healthy",
    });
  });

  it("NO_RISK without a margin still says No shortfall", () => {
    expect(incidentAmountDisplay({ category: "NO_RISK", amountCents: null })).toEqual({
      text: "No shortfall",
      tone: "healthy",
    });
  });

  it("known amounts are formatted", () => {
    expect(incidentAmountDisplay({ category: "PROJECTED_SHORTFALL", amountCents: 45000 })).toEqual({
      text: "$450.00",
      tone: "default",
    });
    expect(incidentAmountDisplay({ category: "OBSERVED_DECLINE", amountCents: 29900 }).text).toBe("$299.00");
  });

  it("real unknowns are Unknown, never $0", () => {
    expect(incidentAmountDisplay({ category: "UNKNOWN_DATA", amountCents: null })).toEqual({
      text: "Unknown",
      tone: "unknown",
    });
    expect(incidentAmountDisplay({ category: "PROJECTED_SHORTFALL", amountCents: null }).text).toBe("Unknown");
  });
});
