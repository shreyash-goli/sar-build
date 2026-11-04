import { describe, expect, it } from "vitest";
import { RUNBOOK_DISCLAIMER, RunbookSchema, buildRunbook, type RunbookInput } from "@/lib/actions/runbooks";

const base: RunbookInput = {
  incidentKey: "charge:charge-cloudcomms-20261119",
  category: "PROJECTED_SHORTFALL",
  severity: "CRITICAL",
  vendorName: "CloudComms",
  vendorOwner: "Identity Platform",
  fund: { id: "fund-auth", name: "Auth Infrastructure", owner: "Finance Ops" },
  workflows: [{ label: "Account login", owner: "Identity Platform", criticality: "CRITICAL" }],
  possibleImpactLabels: [],
  expectedCents: 245000,
  availableCents: 200000,
  shortfallCents: 45000,
  at: "2026-11-19T16:00:00Z",
  dueInDays: 2,
  declinedAmountCents: null,
  declineReason: null,
  missingCodes: [],
  paymentLinkConfirmed: true,
};
const kinds = (i: RunbookInput) => buildRunbook(i).steps.map((s) => s.kind);

describe("runbook mapping per category", () => {
  it("PROJECTED_SHORTFALL: fund owner -> limit review / alternate route -> service owner -> monitor", () => {
    const r = RunbookSchema.parse(buildRunbook(base));
    expect(r.title).toBe("Prevent a $450.00 funding shortfall for CloudComms by 2026-11-19");
    expect(r.steps.map((s) => [s.id, s.owner.name, s.dependsOn])).toEqual([
      ["contact-fund-owner", "Finance Ops", []],
      ["request-limit-review", "Finance Ops", ["contact-fund-owner"]],
      ["verify-alternate-payment", "Finance Ops", ["contact-fund-owner"]],
      ["contact-service-owner", "Identity Platform", []],
      ["monitor-vendor", "Identity Platform", ["request-limit-review", "verify-alternate-payment"]],
    ]);
    expect(r.nextOwner).toEqual({ role: "FINANCE", name: "Finance Ops" });
    expect(r.steps[0]!.detail).toBe(
      "Modeled $2,000.00 available vs $2,450.00 expected on 2026-11-19 (projected shortfall $450.00). Check the live figure before acting.",
    );
    expect(r.steps[1]!.title).toBe("Request a limit review of at least $450.00");
    expect(r.steps[3]!.detail).toMatch(/potential interruption risk, not a confirmed outage/);
  });

  it("an unconfirmed payment link adds a mapping step first; no confirmed workflow adds a dependency-mapping step", () => {
    expect(kinds({ ...base, paymentLinkConfirmed: false })[0]).toBe("MAP_FUNDING_SOURCE");
    const r = buildRunbook({ ...base, paymentLinkConfirmed: false });
    expect(r.steps.find((s) => s.kind === "CONTACT_FUND_OWNER")!.dependsOn).toEqual(["map-funding-source"]);
    expect(kinds({ ...base, workflows: [] })).toContain("MAP_DEPENDENCIES");
  });

  it("LOW shortfall outside the 14-day window says monitoring", () => {
    expect(buildRunbook({ ...base, severity: "LOW" }).title).toBe("Monitor $450.00 projected shortfall for CloudComms (outside the 14-day window)");
  });

  it("OBSERVED_DECLINE: investigate decline -> payment route -> service owner (impact unconfirmed) -> monitor", () => {
    const r = buildRunbook({
      ...base,
      incidentKey: "transaction:tx-webhookworks-20261116",
      category: "OBSERVED_DECLINE",
      severity: "HIGH",
      vendorName: "WebhookWorks",
      vendorOwner: "SRE",
      fund: { id: "fund-monitoring", name: "Monitoring Tools", owner: "Finance Ops" },
      workflows: [{ label: "On-call escalation", owner: "SRE", criticality: "HIGH" }],
      shortfallCents: null,
      at: "2026-11-16T09:12:00Z",
      declinedAmountCents: 29900,
      declineReason: "SPEND_LIMIT",
    });
    expect(r.title).toBe("Respond to the declined WebhookWorks charge ($299.00)");
    expect(r.steps.map((s) => s.kind)).toEqual(["CONTACT_FUND_OWNER", "VERIFY_ALTERNATE_PAYMENT", "CONTACT_SERVICE_OWNER", "MONITOR_VENDOR"]);
    expect(r.steps[0]!.detail).toMatch(/recorded reason: SPEND_LIMIT/);
    expect(r.steps[2]!.detail).toMatch(/Vendor service impact is unconfirmed/);
  });

  it("UNKNOWN_DATA: billing method -> funding source -> service owner (with suggested impacts) -> monitor", () => {
    const r = buildRunbook({
      ...base,
      incidentKey: "charge:charge-metricsrelay-20261124",
      category: "UNKNOWN_DATA",
      severity: "UNKNOWN",
      vendorName: "MetricsRelay",
      vendorOwner: null,
      fund: null,
      workflows: [],
      possibleImpactLabels: ["Weekly growth reporting"],
      missingCodes: ["BILLING_METHOD", "FUNDING_SOURCE"],
    });
    expect(r.steps.map((s) => [s.kind, s.dependsOn])).toEqual([
      ["CONFIRM_BILLING_METHOD", []],
      ["MAP_FUNDING_SOURCE", ["confirm-billing-method"]],
      ["CONTACT_SERVICE_OWNER", []],
      ["MONITOR_VENDOR", ["confirm-billing-method", "map-funding-source"]], // service contact runs in parallel
    ]);
    expect(r.nextOwner).toEqual({ role: "VENDOR_OWNER", name: null });
    expect(r.steps[2]!.detail).toMatch(/unconfirmed \(suggested\) impact on Weekly growth reporting/);
    expect(r.steps[0]!.copyText).toMatch(/^1\. Confirm how MetricsRelay is billed/);
    expect(r.steps[0]!.copyText).toMatch(/Owner: Unassigned \(vendor owner\)/);
  });

  it("NO_RISK: monitor only", () => {
    expect(kinds({ ...base, category: "NO_RISK", severity: "LOW" })).toEqual(["MONITOR_VENDOR"]);
  });

  it("nothing is automatic; every step is copyable and the disclaimer is present", () => {
    for (const category of ["PROJECTED_SHORTFALL", "OBSERVED_DECLINE", "UNKNOWN_DATA", "NO_RISK"] as const) {
      const r = buildRunbook({ ...base, category, missingCodes: category === "UNKNOWN_DATA" ? ["AVAILABLE_ALLOCATION"] : [] });
      expect(r.disclaimer).toBe(RUNBOOK_DISCLAIMER);
      for (const s of r.steps) {
        expect(s.automatic).toBe(false);
        expect(s.copyText).toMatch(/Manual step: FailSafe does not perform this automatically\.$/);
      }
      expect(JSON.stringify(r)).not.toMatch(/automatically (raised|contacted|moved)|will be (raised|paid)/i);
    }
  });
});
