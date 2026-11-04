import { describe, expect, it } from "vitest";
import { loadNorthstarFixture } from "@/fixtures/northstar";
import { DECLINE_WINDOW_DAYS, evaluateRisk, type RiskFinding, type RiskInput } from "@/lib/risk";
import { RiskEvaluationSchema, type GraphEdge, type Transaction } from "@/lib/schema";
import { DEFAULT_DEMO_NOW } from "@/lib/time";

const fx = loadNorthstarFixture();
const NOW = new Date(DEFAULT_DEMO_NOW);
const baseInput = (): RiskInput => ({
  graph: { nodes: structuredClone(fx.nodes), edges: structuredClone(fx.edges) },
  charges: structuredClone(fx.vendorCharges),
  vendors: structuredClone(fx.vendors),
  fundingSources: structuredClone(fx.fundingSources),
  transactions: structuredClone(fx.transactions),
  evidence: fx.evidence,
  now: NOW,
});
const byKey = (fs: RiskFinding[], key: string) => fs.find((f) => f.incidentKey === key)!;
const HERO = "charge:charge-cloudcomms-20261119";
const DECLINE = "transaction:tx-webhookworks-20261116";
const HEALTHY = "charge:charge-computeharbor-20261121";
const UNKNOWN = "charge:charge-metricsrelay-20261124";

const LOGIN_PATH =
  "path:edge-fund-auth--card-auth|edge-card-auth--vendor-cloudcomms|edge-vendor-cloudcomms--service-otp-gateway|edge-service-otp-gateway--workflow-account-login";
const CHECKOUT_PATH = `${LOGIN_PATH}|edge-workflow-account-login--outcome-customer-checkout`;

describe("Northstar golden path", () => {
  const findings = evaluateRisk(baseInput());

  it("produces exactly four findings, each a valid RiskEvaluation, ordered by severity", () => {
    expect(findings.map((f) => [f.incidentKey, f.evaluation.severity])).toEqual([
      [HERO, "CRITICAL"],
      [DECLINE, "HIGH"],
      [UNKNOWN, "UNKNOWN"],
      [HEALTHY, "LOW"],
    ]);
    for (const f of findings) expect(RiskEvaluationSchema.safeParse(f.evaluation).success, f.incidentKey).toBe(true);
  });

  it("hero: $450 PROJECTED_SHORTFALL, CRITICAL, HIGH confidence, with exact path IDs", () => {
    const f = byKey(findings, HERO);
    expect(f.title).toBe("Projected $450.00 funding shortfall for CloudComms");
    expect(f.evaluation).toMatchObject({ category: "PROJECTED_SHORTFALL", severity: "CRITICAL", confidence: "HIGH", requestedMappings: [] });
    expect(f.evaluation.reasons[0]).toMatchObject({
      riskRuleId: "projected-shortfall-v1",
      thresholdDays: 3,
      amountCents: 45000,
      daysUntil: 2,
      confirmedImpactedPathIds: [LOGIN_PATH, CHECKOUT_PATH],
    });
    expect(f.evaluation.reasons[1]).toMatchObject({ riskRuleId: "risk-severity-v1", confirmedImpactedPathIds: [LOGIN_PATH] });
    expect(f.evaluation.reasons[1]!.detail).toMatch(/potential interruption of Account login \(CRITICAL\)/);
    const a = f.evaluation.assertion;
    expect(a).toMatchObject({ assertionId: "risk-charge-charge-cloudcomms-20261119", status: "DERIVED", ruleId: "projected-shortfall-v1", amountCents: 45000, evaluatedAt: DEFAULT_DEMO_NOW });
    expect(a.claim).toBe("Projected $450.00 funding shortfall for CloudComms charge due 2026-11-19 (potential interruption of Account login (CRITICAL))");
    expect(a.inputs.slice(0, 3)).toEqual(["evidence:ev-charge-cloudcomms-20261119", "evidence:ev-vendor-cloudcomms", "evidence:ev-fund-auth"]);
    expect(a.inputs).toContain("evidence:ev-edge-workflow-account-login--outcome-customer-checkout");
    expect(a.limitations.join(" ")).toMatch(/synthetic demo data/);
    expect(a.limitations.join(" ")).toMatch(/Potential interruption risk only: whether the vendor would suspend service is unknown/);
    expect(JSON.stringify(f)).not.toMatch(/suspended service|outage confirmed|will fail/i);
    expect(f.impact).toMatchObject({
      startNodeId: "node-fund-auth",
      confirmedWorkflows: [{ nodeId: "node-workflow-account-login", label: "Account login", criticality: "CRITICAL" }],
      confirmedOutcomeIds: ["node-outcome-customer-checkout"],
      possibleNodeIds: [],
      complete: true,
    });
  });

  it("T-06: WebhookWorks decline is a separate OBSERVED_DECLINE incident, not an outage", () => {
    const f = byKey(findings, DECLINE);
    expect(f.subject).toEqual({ type: "TRANSACTION", id: "tx-webhookworks-20261116" });
    expect(f.title).toBe("Observed transaction decline: WebhookWorks $299.00");
    expect(f.evaluation).toMatchObject({ category: "OBSERVED_DECLINE", severity: "HIGH", confidence: "MEDIUM" });
    expect(f.evaluation.assertion.ruleId).toBe("observed-decline-v1");
    const lim = f.evaluation.assertion.limitations;
    expect(lim[0]).toBe("Observed transaction decline; vendor service impact unconfirmed. This is not a confirmed outage.");
    expect(lim).toContain('Decline reason "SPEND_LIMIT" is local demo terminology, not a verified Ramp enum.');
    expect(f.impact.confirmedWorkflows.map((w) => w.nodeId)).toEqual(["node-workflow-oncall-escalation"]);
    expect(f.title).not.toMatch(/outage/i);
  });

  it("ComputeHarbor is LOW (NO_RISK) with a positive margin", () => {
    const f = byKey(findings, HEALTHY);
    expect(f.evaluation).toMatchObject({ category: "NO_RISK", severity: "LOW", confidence: "HIGH" });
    expect(f.evaluation.assertion.amountCents).toBe(0);
    expect(f.evaluation.reasons[0]!.detail).toMatch(/margin \$10,200\.00/);
  });

  it("MetricsRelay is UNKNOWN (UNKNOWN_DATA), never $0", () => {
    const f = byKey(findings, UNKNOWN);
    expect(f.evaluation).toMatchObject({ category: "UNKNOWN_DATA", severity: "UNKNOWN", confidence: "UNKNOWN" });
    expect(f.evaluation.assertion).toMatchObject({ status: "UNKNOWN", amountCents: null });
    expect(f.evaluation.requestedMappings).toHaveLength(2);
    expect(f.evaluation.reasons[0]!.amountCents).toBeNull();
    expect(f.impact.confirmedPathIds).toEqual([]);
  });

  it("is deterministic and does not mutate inputs", () => {
    const input = baseInput();
    const before = structuredClone(input);
    expect(evaluateRisk(input)).toEqual(evaluateRisk(input));
    expect(input).toEqual(before);
  });
});

describe("severity ladder", () => {
  const withHero = (mut: (i: RiskInput) => void) => {
    const i = baseInput();
    mut(i);
    return byKey(evaluateRisk(i), HERO).evaluation;
  };
  const due = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

  it("CRITICAL at <=3 days with a CRITICAL workflow; HIGH at 4-7; MEDIUM at 8-14; LOW beyond 14", () => {
    // Use a TOTAL-interval fund so far dates stay in-period.
    const set = (days: number) =>
      withHero((i) => {
        i.fundingSources = i.fundingSources.map((f) => (f.id === "fund-auth" ? { ...f, interval: "TOTAL" } : f));
        i.charges = i.charges.map((c) => (c.id === "charge-cloudcomms-20261119" ? { ...c, expectedAt: due(days) } : c));
      });
    expect(set(3)).toMatchObject({ severity: "CRITICAL" });
    expect(set(4)).toMatchObject({ severity: "HIGH" });
    expect(set(7)).toMatchObject({ severity: "HIGH" });
    expect(set(8)).toMatchObject({ severity: "MEDIUM" });
    expect(set(14)).toMatchObject({ severity: "MEDIUM" });
    const far = set(15);
    expect(far).toMatchObject({ category: "PROJECTED_SHORTFALL", severity: "LOW" });
    const note = "Projected shortfall due in 15 days is outside the 14-day scoring window; monitoring";
    expect(far.reasons[1]!.detail).toBe(note);
    expect(far.assertion.limitations).toContain(note);
    expect(set(14).assertion.limitations.join(" ")).not.toMatch(/outside the 14-day scoring window/);
  });

  it("<=3 days but only a MEDIUM workflow is MEDIUM; HIGH workflow is HIGH", () => {
    const lower = (crit: "HIGH" | "MEDIUM") =>
      withHero((i) => {
        i.graph = { ...i.graph, nodes: i.graph.nodes.map((n) => (n.id === "node-workflow-account-login" ? { ...n, criticality: crit } : n)) };
      });
    expect(lower("HIGH").severity).toBe("HIGH");
    expect(lower("MEDIUM").severity).toBe("MEDIUM");
  });

  it("suggested and rejected edges never raise severity (unsupported-edge exclusion)", () => {
    for (const status of ["SUGGESTED", "REJECTED"] as const) {
      const ev = withHero((i) => {
        i.graph = {
          ...i.graph,
          edges: i.graph.edges.map((e) => (e.id === "edge-service-otp-gateway--workflow-account-login" ? ({ ...e, reviewStatus: status } as GraphEdge) : e)),
        };
      });
      // OTP gateway is a SERVICE: with the login edge unconfirmed there is no confirmed path to a workflow/outcome.
      expect(ev, status).toMatchObject({ category: "PROJECTED_SHORTFALL", severity: "UNKNOWN", confidence: "UNKNOWN" });
      expect(ev.reasons[0]!.confirmedImpactedPathIds).toEqual([]);
      expect(ev.requestedMappings[0]).toMatch(/Map which services and workflows depend on CloudComms/);
    }
  });

  it("golden hero has a confirmed payment link and no payment-link caveat", () => {
    const f = byKey(evaluateRisk(baseInput()), HERO);
    expect(f.impact.paymentLinkConfirmed).toBe(true);
    expect(f.evaluation.assertion.limitations.join(" ")).not.toMatch(/not confirmed in the dependency graph/);
  });

  it.each(["REJECTED", "SUGGESTED"] as const)(
    "unconfirmed (%s) card -> vendor PAYS edge: severity kept, confidence LOW, caveat and mapping added",
    (status) => {
      const i = baseInput();
      i.graph = {
        ...i.graph,
        edges: i.graph.edges.map((e) => (e.id === "edge-card-auth--vendor-cloudcomms" ? ({ ...e, reviewStatus: status } as GraphEdge) : e)),
      };
      const f = byKey(evaluateRisk(i), HERO);
      expect(f.impact).toMatchObject({ paymentLinkConfirmed: false, startNodeId: "node-vendor-cloudcomms" });
      expect(f.evaluation).toMatchObject({ category: "PROJECTED_SHORTFALL", severity: "CRITICAL", confidence: "LOW" });
      expect(f.evaluation.assertion.limitations[0]).toBe(
        "Payment link from Auth Infrastructure to CloudComms is not confirmed in the dependency graph",
      );
      expect(f.evaluation.requestedMappings).toContain("Confirm which card/fund pays CloudComms.");
      // The unconfirmed edge never appears in a confirmed path.
      expect(f.impact.confirmedPathIds.some((p) => p.includes("edge-card-auth--vendor-cloudcomms"))).toBe(false);
      expect(f.impact.confirmedPathIds[0]).toBe("path:edge-vendor-cloudcomms--service-otp-gateway|edge-service-otp-gateway--workflow-account-login");
      expect(RiskEvaluationSchema.safeParse(f.evaluation).success).toBe(true);
    },
  );

  it("unconfirmed payment link also caps a healthy (NO_RISK) result and a decline", () => {
    const i = baseInput();
    i.graph = {
      ...i.graph,
      edges: i.graph.edges.map((e) =>
        e.id === "edge-card-infra--vendor-computeharbor" || e.id === "edge-card-monitoring--vendor-webhookworks"
          ? ({ ...e, reviewStatus: "REJECTED" } as GraphEdge)
          : e,
      ),
    };
    const fs = evaluateRisk(i);
    expect(byKey(fs, HEALTHY).evaluation).toMatchObject({ severity: "LOW", confidence: "LOW" });
    expect(byKey(fs, HEALTHY).evaluation.requestedMappings).toEqual(["Confirm which card/fund pays ComputeHarbor."]);
    const d = byKey(fs, DECLINE).evaluation;
    expect(d).toMatchObject({ severity: "HIGH", confidence: "LOW" });
    expect(d.assertion.limitations).toContain("Payment link from Monitoring Tools to WebhookWorks is not confirmed in the dependency graph");
  });

  it("possible (suggested-only) impacts are reported but not scored", () => {
    const i = baseInput();
    i.graph = { ...i.graph, edges: i.graph.edges.map((e) => (e.id === "edge-service-otp-gateway--workflow-account-login" ? { ...e, reviewStatus: "SUGGESTED" } : e)) };
    const f = byKey(evaluateRisk(i), HERO);
    expect(f.impact.possibleNodeIds).toEqual(["node-outcome-customer-checkout", "node-workflow-account-login"]);
    expect(f.impact.confirmedWorkflows).toEqual([]);
  });

  it("confidence is the weakest confirmed edge tier on the driving paths; stale availability caps at MEDIUM", () => {
    const low = withHero((i) => {
      i.graph = { ...i.graph, edges: i.graph.edges.map((e) => (e.id === "edge-card-auth--vendor-cloudcomms" ? { ...e, confidenceTier: "LOW" } : e)) };
    });
    expect(low).toMatchObject({ severity: "CRITICAL", confidence: "LOW" });
    // The DEGRADED checkout edge is not on the driving (login) path; lowering it leaves confidence HIGH.
    const checkoutOnly = withHero((i) => {
      i.graph = { ...i.graph, edges: i.graph.edges.map((e) => (e.id === "edge-workflow-account-login--outcome-customer-checkout" ? { ...e, confidenceTier: "LOW" } : e)) };
    });
    expect(checkoutOnly.confidence).toBe("HIGH");
    const stale = withHero((i) => {
      i.fundingSources = i.fundingSources.map((f) => (f.id === "fund-auth" ? { ...f, observedAt: "2026-11-01T16:00:00Z" } : f));
    });
    expect(stale).toMatchObject({ severity: "CRITICAL", confidence: "MEDIUM" });
  });

  it("missing availability or billing makes the hero UNKNOWN_DATA", () => {
    expect(withHero((i) => (i.fundingSources = i.fundingSources.map((f) => (f.id === "fund-auth" ? { ...f, availableCents: null } : f))))).toMatchObject({
      category: "UNKNOWN_DATA",
      severity: "UNKNOWN",
    });
    expect(withHero((i) => (i.vendors = i.vendors.map((v) => (v.id === "vendor-cloudcomms" ? { ...v, billingMethod: "UNKNOWN" } : v))))).toMatchObject({
      category: "UNKNOWN_DATA",
    });
  });

  it("+$600 allocation turns the hero into NO_RISK LOW (simulation input)", () => {
    expect(withHero((i) => (i.fundingSources = i.fundingSources.map((f) => (f.id === "fund-auth" ? { ...f, availableCents: 260000 } : f))))).toMatchObject({
      category: "NO_RISK",
      severity: "LOW",
    });
  });
});

describe("observed declines", () => {
  const decline = (extra: Partial<Transaction>): Transaction => ({
    id: "tx-new-decline",
    providerEventId: "evt-x",
    vendorId: "vendor-cloudcomms",
    fundingSourceId: "fund-auth",
    occurredAt: "2026-11-17T10:00:00Z",
    amountCents: 245000,
    state: "DECLINED",
    reason: null,
    evidenceId: "ev-tx-webhookworks-20261116",
    ...extra,
  });

  it("a decline reaching a CRITICAL workflow is CRITICAL; the vendor's charge is not also reported LOW", () => {
    const i = baseInput();
    i.transactions = [...i.transactions, decline({})];
    i.fundingSources = i.fundingSources.map((f) => (f.id === "fund-auth" ? { ...f, availableCents: 900000 } : f));
    const fs = evaluateRisk(i);
    expect(byKey(fs, "transaction:tx-new-decline").evaluation).toMatchObject({ category: "OBSERVED_DECLINE", severity: "CRITICAL" });
    expect(fs.find((f) => f.incidentKey === HERO)).toBeUndefined();
  });

  it(`declines older than ${DECLINE_WINDOW_DAYS} days or in the future are ignored`, () => {
    const i = baseInput();
    i.transactions = [decline({ id: "old", occurredAt: "2026-11-01T00:00:00Z" }), decline({ id: "future", occurredAt: "2026-11-18T00:00:00Z" })];
    expect(evaluateRisk(i).filter((f) => f.subject.type === "TRANSACTION")).toEqual([]);
  });

  it("a decline with no confirmed dependency path is UNKNOWN, asking for a mapping", () => {
    const i = baseInput();
    i.transactions = [decline({ id: "tx-metrics", vendorId: "vendor-metricsrelay", fundingSourceId: null })];
    const f = byKey(evaluateRisk(i), "transaction:tx-metrics");
    // MetricsRelay -> Product analytics is CONFIRMED but ends at a SERVICE; growth reporting is SUGGESTED only.
    expect(f.evaluation).toMatchObject({ category: "OBSERVED_DECLINE", severity: "UNKNOWN", confidence: "UNKNOWN" });
    expect(f.impact.possibleNodeIds).toEqual(["node-workflow-growth-reporting"]);
    expect(f.evaluation.assertion.limitations[0]).toMatch(/vendor service impact unconfirmed/);
  });
});
