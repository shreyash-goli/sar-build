import { describe, expect, it } from "vitest";
import { loadNorthstarFixture } from "@/fixtures/northstar";
import { ScenarioRunRequestSchema, type SimulationPatch } from "@/lib/schema";
import {
  MODELED_CHANGE_ASSUMPTION,
  SimulationError,
  SimulationResultSchema,
  simulate,
  type WorkspaceSnapshot,
} from "@/lib/simulations";
import { DEFAULT_DEMO_NOW } from "@/lib/time";

const fx = loadNorthstarFixture();
const NOW = new Date(DEFAULT_DEMO_NOW);
const HERO = "charge:charge-cloudcomms-20261119";
const DECLINE = "transaction:tx-webhookworks-20261116";
const snapshot = (): WorkspaceSnapshot =>
  structuredClone({
    nodes: fx.nodes,
    edges: fx.edges,
    vendors: fx.vendors,
    fundingSources: fx.fundingSources,
    charges: fx.vendorCharges,
    transactions: fx.transactions,
    evidence: fx.evidence,
  });
const run = (patch: SimulationPatch, s: WorkspaceSnapshot = snapshot(), focus = HERO) =>
  SimulationResultSchema.parse(simulate({ snapshot: s, patch, focusIncidentKey: focus, now: NOW }));
const plus600: SimulationPatch = { kind: "INCREASE_AVAILABLE_ALLOCATION", fundingSourceId: "fund-auth", amountCents: 60000 };

describe("T-02: +$600 allocation on fund-auth", () => {
  const r = run(plus600);

  it("models available 200000 -> 260000, shortfall 45000 -> 0, margin 15000, severity drops", () => {
    expect(r.focus.before).toMatchObject({ category: "PROJECTED_SHORTFALL", severity: "CRITICAL", availableCents: 200000, shortfallCents: 45000, marginCents: 0 });
    expect(r.focus.after).toMatchObject({ category: "NO_RISK", severity: "LOW", availableCents: 260000, shortfallCents: 0, marginCents: 15000 });
    expect(r.focus.changedFields).toEqual(expect.arrayContaining(["category", "severity", "shortfallCents", "marginCents", "availableCents"]));
  });

  it("labels, rule versions, changed inputs and assumptions", () => {
    expect(r.label).toBe("SIMULATION ONLY");
    expect(r.ruleVersion).toEqual({ simulation: "simulation-v1", shortfall: "projected-shortfall-v1", severity: "risk-severity-v1", decline: "observed-decline-v1" });
    expect(r.evaluatedAt).toBe(DEFAULT_DEMO_NOW);
    expect(r.changedInputs).toEqual([
      { entity: "FUNDING_SOURCE", id: "fund-auth", field: "availableCents", before: 200000, after: 260000 },
      { entity: "FUNDING_SOURCE", id: "fund-auth", field: "limitCents", before: 400000, after: 460000 },
    ]);
    expect(r.assumptions[0]).toBe("Modeled change; no Ramp funds or card limits were changed");
    expect(r.assumptions).toContain(MODELED_CHANGE_ASSUMPTION);
  });

  it("other incidents are unchanged; the diff covers every finding", () => {
    expect(r.diff.map((d) => d.incidentKey)).toEqual([
      HERO,
      "charge:charge-computeharbor-20261121",
      "charge:charge-metricsrelay-20261124",
      DECLINE,
    ]);
    for (const d of r.diff.filter((x) => x.incidentKey !== HERO)) expect(d.changedFields, d.incidentKey).toEqual([]);
  });

  it("a partial increase leaves a smaller shortfall and keeps severity", () => {
    const p = run({ ...plus600, amountCents: 40000 });
    expect(p.focus.after).toMatchObject({ severity: "CRITICAL", shortfallCents: 5000 });
  });
});

describe("T-03: the base snapshot is never mutated; same engine is re-run", () => {
  it("input snapshot is deep-equal before and after every patch kind", () => {
    const patches: SimulationPatch[] = [
      plus600,
      { kind: "ASSIGN_ALTERNATE_FUND", vendorChargeId: "charge-cloudcomms-20261119", fundingSourceId: "fund-infra" },
      { kind: "MARK_CHARGE_RESCHEDULED", vendorChargeId: "charge-cloudcomms-20261119", newExpectedAt: "2026-11-25T16:00:00Z" },
      { kind: "MARK_DEPENDENCY_VERIFIED", edgeId: "edge-service-product-analytics--workflow-growth-reporting" },
    ];
    for (const patch of patches) {
      const s = snapshot();
      const copy = structuredClone(s);
      run(patch, s);
      expect(s, patch.kind).toEqual(copy);
    }
  });

  it("before equals a plain engine run (no client score anywhere)", () => {
    const r = run(plus600);
    expect(r.before.find((f) => f.incidentKey === HERO)).toMatchObject({ severity: "CRITICAL", amountCents: 45000 });
    expect(ScenarioRunRequestSchema.safeParse({ incidentId: "inc-x", patch: { ...plus600, riskScore: 0 } }).success).toBe(false);
    expect(ScenarioRunRequestSchema.safeParse({ incidentId: "inc-x", patch: plus600, severity: "LOW" }).success).toBe(false);
  });
});

describe("other patch kinds", () => {
  it("ASSIGN_ALTERNATE_FUND: shortfall clears but confidence drops (unconfirmed payment link)", () => {
    const r = run({ kind: "ASSIGN_ALTERNATE_FUND", vendorChargeId: "charge-cloudcomms-20261119", fundingSourceId: "fund-infra" });
    expect(r.changedInputs).toEqual([{ entity: "VENDOR_CHARGE", id: "charge-cloudcomms-20261119", field: "fundingSourceId", before: "fund-auth", after: "fund-infra" }]);
    expect(r.focus.after).toMatchObject({ category: "NO_RISK", severity: "LOW", confidence: "LOW", shortfallCents: 0 });
    expect(r.assumptions.join(" ")).toMatch(/no card was re-pointed/);
  });

  it("MARK_CHARGE_RESCHEDULED: later in the period lowers severity; into the next period is unscored", () => {
    const later = run({ kind: "MARK_CHARGE_RESCHEDULED", vendorChargeId: "charge-cloudcomms-20261119", newExpectedAt: "2026-11-25T16:00:00Z" });
    expect(later.focus.after).toMatchObject({ severity: "MEDIUM", shortfallCents: 45000, dueInDays: 8 });
    expect(later.changedInputs.map((c) => c.field)).toEqual(["expectedAt", "status"]);
    const nextMonth = run({ kind: "MARK_CHARGE_RESCHEDULED", vendorChargeId: "charge-cloudcomms-20261119", newExpectedAt: "2026-12-15T16:00:00Z" });
    expect(nextMonth.focus.after).toMatchObject({ category: "UNKNOWN_DATA", severity: "UNKNOWN", shortfallCents: null });
  });

  it("MARK_DEPENDENCY_VERIFIED models a suggested edge as confirmed", () => {
    const r = run(
      { kind: "MARK_DEPENDENCY_VERIFIED", edgeId: "edge-service-product-analytics--workflow-growth-reporting" },
      snapshot(),
      "charge:charge-metricsrelay-20261124",
    );
    expect(r.changedInputs).toEqual([
      { entity: "EDGE", id: "edge-service-product-analytics--workflow-growth-reporting", field: "reviewStatus", before: "SUGGESTED", after: "CONFIRMED" },
    ]);
    expect(r.focus.after).toMatchObject({ category: "UNKNOWN_DATA" }); // still missing billing/funding: never invented
    expect(r.assumptions.join(" ")).toMatch(/stored edge stays SUGGESTED/);
  });
});

describe("feasibility", () => {
  const fail = (patch: SimulationPatch, s: WorkspaceSnapshot = snapshot()) => {
    try {
      run(patch, s);
    } catch (e) {
      expect(e).toBeInstanceOf(SimulationError);
      return e as SimulationError;
    }
    throw new Error("expected SimulationError");
  };

  it("unknown targets are TARGET_NOT_FOUND", () => {
    expect(fail({ ...plus600, fundingSourceId: "fund-nope" }).code).toBe("TARGET_NOT_FOUND");
    expect(fail({ kind: "ASSIGN_ALTERNATE_FUND", vendorChargeId: "charge-nope", fundingSourceId: "fund-infra" }).code).toBe("TARGET_NOT_FOUND");
    expect(fail({ kind: "ASSIGN_ALTERNATE_FUND", vendorChargeId: "charge-cloudcomms-20261119", fundingSourceId: "fund-nope" }).details.field).toBe("patch.fundingSourceId");
    expect(fail({ kind: "MARK_DEPENDENCY_VERIFIED", edgeId: "edge-nope" }).code).toBe("TARGET_NOT_FOUND");
  });

  it("infeasible patches are INFEASIBLE with a reason", () => {
    const unknownAvail = snapshot();
    unknownAvail.fundingSources = unknownAvail.fundingSources.map((f) => (f.id === "fund-auth" ? { ...f, availableCents: null } : f));
    const e1 = fail(plus600, unknownAvail);
    expect(e1).toMatchObject({ code: "INFEASIBLE", details: { field: "patch.fundingSourceId" } });
    expect(e1.details.reason).toMatch(/unknown/);
    expect(fail({ kind: "ASSIGN_ALTERNATE_FUND", vendorChargeId: "charge-cloudcomms-20261119", fundingSourceId: "fund-auth" }).details.reason).toMatch(/already assigned/);
    expect(fail({ kind: "MARK_DEPENDENCY_VERIFIED", edgeId: "edge-fund-auth--card-auth" }).details.reason).toMatch(/only SUGGESTED/);
    expect(fail({ kind: "MARK_CHARGE_RESCHEDULED", vendorChargeId: "charge-cloudcomms-20261119", newExpectedAt: "2026-11-16T00:00:00Z" }).details.reason).toMatch(/past/);
    expect(fail({ ...plus600, amountCents: Number.MAX_SAFE_INTEGER }).code).toBe("INFEASIBLE");
  });
});
