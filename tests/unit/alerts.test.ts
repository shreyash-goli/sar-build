import { describe, expect, it } from "vitest";
import { classifyTransition, type RiskState } from "@/lib/alerts/transitions";

const s = (severity: RiskState["severity"], status: RiskState["status"] = "OPEN", category: RiskState["category"] = "PROJECTED_SHORTFALL", fingerprint = "fp"): RiskState => ({
  severity,
  status,
  category,
  fingerprint,
});

describe("classifyTransition (material changes only)", () => {
  it("creation alerts only for risky incidents", () => {
    expect(classifyTransition(null, s("CRITICAL"))).toBe("CREATED");
    expect(classifyTransition(null, s("UNKNOWN", "OPEN", "UNKNOWN_DATA"))).toBe("CREATED");
    expect(classifyTransition(null, s("LOW", "MONITORING", "NO_RISK"))).toBeNull();
  });

  it("resolution, escalation (incl. reopen), de-escalation and reclassification", () => {
    expect(classifyTransition(s("CRITICAL"), s("LOW", "RESOLVED", "NO_RISK"))).toBe("RESOLVED");
    expect(classifyTransition(s("LOW", "RESOLVED"), s("LOW", "RESOLVED"))).toBeNull();
    expect(classifyTransition(s("LOW", "RESOLVED", "NO_RISK"), s("CRITICAL"))).toBe("REOPENED");
    // A risk returning at the SAME severity and category is never silent.
    expect(classifyTransition(s("HIGH", "RESOLVED"), s("HIGH", "OPEN"))).toBe("REOPENED");
    expect(classifyTransition(s("LOW", "RESOLVED", "NO_RISK"), s("LOW", "MONITORING", "NO_RISK"))).toBe("REOPENED");
    expect(classifyTransition(s("HIGH"), s("CRITICAL"))).toBe("ESCALATED");
    expect(classifyTransition(s("UNKNOWN"), s("MEDIUM"))).toBe("ESCALATED");
    expect(classifyTransition(s("CRITICAL"), s("HIGH"))).toBe("DEESCALATED");
    expect(classifyTransition(s("LOW", "MONITORING", "NO_RISK"), s("LOW", "MONITORING", "PROJECTED_SHORTFALL"))).toBe("RECLASSIFIED");
  });

  it("amount/date-only changes are not material", () => {
    expect(classifyTransition(s("CRITICAL", "OPEN", "PROJECTED_SHORTFALL", "a"), s("CRITICAL", "OPEN", "PROJECTED_SHORTFALL", "b"))).toBeNull();
    expect(classifyTransition(s("HIGH", "ACKNOWLEDGED"), s("HIGH", "ACKNOWLEDGED"))).toBeNull();
  });
});
