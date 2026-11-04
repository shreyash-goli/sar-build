import { describe, expect, it } from "vitest";

import {
  CATEGORY_LABEL,
  CONFIDENCE_LABEL,
  SEVERITY_LABEL,
  SEVERITY_VARIANT,
  dueLabel,
  formatDayUtc,
  graphHref,
  vendorNodeId,
} from "@/components/dashboard/format";
import { ConfidenceTier, RiskCategory, Severity } from "@/lib/schema/enums";
import { formatCents } from "@/lib/schema/money";

describe("dashboard format helpers", () => {
  it("dueLabel: today, tomorrow, future, overdue, and unknown stays unknown", () => {
    expect(dueLabel(0)).toBe("Due today");
    expect(dueLabel(1)).toBe("Due tomorrow");
    expect(dueLabel(2)).toBe("Due in 2 days");
    expect(dueLabel(-1)).toBe("1 day overdue");
    expect(dueLabel(-3)).toBe("3 days overdue");
    expect(dueLabel(null)).toBeNull();
  });

  it("formatDayUtc is UTC and deterministic regardless of host timezone", () => {
    expect(formatDayUtc("2026-11-19T00:00:00Z")).toBe("19 Nov 2026");
    // 23:30 at -05:00 is already the next day in UTC.
    expect(formatDayUtc("2026-11-18T23:30:00-05:00")).toBe("19 Nov 2026");
  });

  it("graph links use the ?node= deep link and the node-<entityId> convention", () => {
    expect(vendorNodeId("vendor-cloudcomms")).toBe("node-vendor-cloudcomms");
    expect(graphHref("node-vendor-cloudcomms")).toBe("/graph?node=node-vendor-cloudcomms");
    expect(graphHref("a b&c")).toBe("/graph?node=a%20b%26c");
  });

  it("every enum value has a label (no silent blanks), and severity always maps to a badge", () => {
    for (const s of Severity.options) {
      expect(SEVERITY_LABEL[s]).toBeTruthy();
      expect(SEVERITY_VARIANT[s]).toBeTruthy();
    }
    for (const c of RiskCategory.options) expect(CATEGORY_LABEL[c]).toBeTruthy();
    for (const c of ConfidenceTier.options) expect(CONFIDENCE_LABEL[c]).toBeTruthy();
  });

  it("unknown amounts render as Unknown, never $0", () => {
    expect(formatCents(null)).toBe("Unknown");
    expect(formatCents(45000)).toBe("$450.00");
  });
});
