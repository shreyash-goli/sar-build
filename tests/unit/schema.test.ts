import { describe, expect, it } from "vitest";
import {
  ActionProposalSchema,
  ApiErrorSchema,
  AuditEventSchema,
  IncidentSchema,
  NodeSchema,
  PaymentInstrumentSchema,
  RiskEvaluationSchema,
  ScenarioRunRequestSchema,
  SimulationPatchSchema,
  SimulationSchema,
  TransactionSchema,
  VendorSchema,
  WorkspaceSchema,
  apiResponseSchema,
  apiSuccessSchema,
  canTransitionActionProposal,
  findCardSecretKeys,
} from "@/lib/schema";
import * as z from "zod";

const NOW = "2026-11-17T16:00:00Z";

describe("PaymentInstrument never carries card secrets", () => {
  const card = {
    id: "card-auth",
    kind: "VIRTUAL_CARD",
    externalCardId: null,
    fundingSourceId: "fund-auth",
    status: "ACTIVE",
    evidenceId: "ev-card-auth",
  } as const;

  it("accepts card metadata", () => {
    expect(PaymentInstrumentSchema.safeParse(card).success).toBe(true);
  });

  it.each([
    ["pan", "4111111111111111"],
    ["cardNumber", "4111111111111111"],
    ["cvv", "123"],
    ["cvc", "123"],
    ["securityCode", "123"],
    ["expiration", "12/29"],
  ])("rejects %s", (key, value) => {
    const r = PaymentInstrumentSchema.safeParse({ ...card, [key]: value });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.code).toBe("unrecognized_keys");
  });

  it.each(["4111111111111111", "4111 1111 1111 1111", "4111-1111-1111-1111", "378282246310005", "123456789012"])(
    "rejects PAN-shaped externalCardId %s",
    (externalCardId) => {
      expect(PaymentInstrumentSchema.safeParse({ ...card, externalCardId }).success).toBe(false);
    },
  );

  it("accepts provider card IDs that are not PAN-shaped", () => {
    for (const externalCardId of ["c8f1e2a4-7b3d-4f0e-9a1b-2c3d4e5f6a7b", "card_01HXYZ", "12345678901"]) {
      expect(PaymentInstrumentSchema.safeParse({ ...card, externalCardId }).success, externalCardId).toBe(true);
    }
  });

  it("findCardSecretKeys detects nested secret fields in untrusted payloads", () => {
    expect(
      findCardSecretKeys({ id: "x", card: { card_number: "4111", CVV: "1" }, items: [{ pan: "1" }] }),
    ).toEqual(["card.card_number", "card.CVV", "items.0.pan"]);
    expect(findCardSecretKeys(card)).toEqual([]);
  });
});

describe("SimulationPatch", () => {
  const inc = { kind: "INCREASE_AVAILABLE_ALLOCATION", fundingSourceId: "fund-auth", amountCents: 60000 };

  it("accepts each of the four kinds", () => {
    for (const p of [
      inc,
      { kind: "ASSIGN_ALTERNATE_FUND", vendorChargeId: "charge-1", fundingSourceId: "fund-ops" },
      { kind: "MARK_CHARGE_RESCHEDULED", vendorChargeId: "charge-1", newExpectedAt: "2026-12-01T00:00:00Z" },
      { kind: "MARK_DEPENDENCY_VERIFIED", edgeId: "edge-1" },
    ]) {
      expect(SimulationPatchSchema.safeParse(p).success, p.kind).toBe(true);
    }
  });

  it.each([0, -60000, 600.5, Number.NaN, "60000"])("rejects amountCents %j", (amountCents) => {
    expect(SimulationPatchSchema.safeParse({ ...inc, amountCents }).success).toBe(false);
  });

  it("rejects unknown kinds", () => {
    expect(SimulationPatchSchema.safeParse({ ...inc, kind: "MOVE_MONEY" }).success).toBe(false);
  });

  it.each(["riskScore", "severity", "shortfallCents"])("rejects client-provided %s", (key) => {
    expect(SimulationPatchSchema.safeParse({ ...inc, [key]: 0 }).success).toBe(false);
    expect(
      ScenarioRunRequestSchema.safeParse({ incidentId: "inc-1", patch: inc, [key]: 0 }).success,
    ).toBe(false);
  });

  it("rejects fields from another patch kind and missing targets", () => {
    expect(SimulationPatchSchema.safeParse({ ...inc, edgeId: "edge-1" }).success).toBe(false);
    expect(SimulationPatchSchema.safeParse({ kind: "MARK_DEPENDENCY_VERIFIED" }).success).toBe(false);
    expect(SimulationPatchSchema.safeParse({ ...inc, fundingSourceId: "" }).success).toBe(false);
  });
});

describe("domain records", () => {
  it("validates workspace, vendor, node, transaction, incident, audit event", () => {
    expect(WorkspaceSchema.safeParse({ id: "ws", name: "Northstar Labs", mode: "DEMO" }).success).toBe(true);
    expect(WorkspaceSchema.safeParse({ id: "ws", name: "N", mode: "RAMP_LIVE" }).success).toBe(false);
    expect(
      VendorSchema.safeParse({
        id: "vendor-cloudcomms",
        name: "CloudComms",
        normalizedKey: "cloudcomms",
        billingMethod: "UNKNOWN",
        evidenceId: "ev",
      }).success,
    ).toBe(true);
    expect(
      VendorSchema.safeParse({ id: "v", name: "CloudComms", normalizedKey: "Cloud Comms", billingMethod: "CARD", evidenceId: "ev" })
        .success,
    ).toBe(false);
    expect(
      NodeSchema.safeParse({ id: "n", kind: "WORKFLOW", label: "Login", criticality: "CRITICAL", owner: null, evidenceId: "ev" })
        .success,
    ).toBe(true);
    expect(
      NodeSchema.safeParse({ id: "n", kind: "WORKFLOW", label: "Login", criticality: "CRITICAL", owner: null }).success,
    ).toBe(false);
    expect(
      TransactionSchema.safeParse({
        id: "t",
        providerEventId: "evt-1",
        vendorId: "v",
        fundingSourceId: null,
        occurredAt: NOW,
        amountCents: 245000,
        state: "DECLINED",
        reason: "insufficient allocation",
        evidenceId: "ev",
      }).success,
    ).toBe(true);
    expect(
      IncidentSchema.safeParse({
        id: "inc",
        scenarioKey: "A",
        status: "OPEN",
        severity: "UNKNOWN",
        title: "Unknown data",
        firstSeenAt: NOW,
        updatedAt: NOW,
        primaryVendorId: null,
        detectionRule: "projected-shortfall-v1",
        snapshotJson: { fund: null },
        evidenceId: "ev",
      }).success,
    ).toBe(true);
    expect(
      AuditEventSchema.safeParse({ id: "a", actor: "demo-user", action: "action.approved_for_demo", subjectId: "p", detailsJson: {}, at: NOW })
        .success,
    ).toBe(true);
  });

  it("Incident.detectionRule must be a versioned rule ID", () => {
    const incident = {
      id: "inc",
      scenarioKey: null,
      status: "OPEN",
      severity: "HIGH",
      title: "Projected shortfall",
      firstSeenAt: NOW,
      updatedAt: NOW,
      primaryVendorId: "vendor-cloudcomms",
      detectionRule: "projected-shortfall-v1",
      snapshotJson: {},
      evidenceId: "ev",
    };
    expect(IncidentSchema.safeParse(incident).success).toBe(true);
    for (const detectionRule of ["projected-shortfall", "Projected shortfall rule", ""]) {
      expect(IncidentSchema.safeParse({ ...incident, detectionRule }).success, detectionRule).toBe(false);
    }
  });

  it("Simulation embeds a validated patch", () => {
    const sim = {
      id: "sim",
      incidentId: "inc",
      patchJson: { kind: "INCREASE_AVAILABLE_ALLOCATION", fundingSourceId: "fund-auth", amountCents: 60000 },
      beforeJson: { shortfallCents: 45000 },
      afterJson: { shortfallCents: 0 },
      createdAt: NOW,
      createdBy: "demo-user",
      isDemo: true,
    };
    expect(SimulationSchema.safeParse(sim).success).toBe(true);
    expect(SimulationSchema.safeParse({ ...sim, patchJson: { ...sim.patchJson, amountCents: -1 } }).success).toBe(false);
  });
});

describe("ActionProposal", () => {
  const proposal = {
    id: "p",
    incidentId: "inc",
    kind: "INCREASE_AVAILABLE_ALLOCATION",
    payloadJson: { kind: "INCREASE_AVAILABLE_ALLOCATION", fundingSourceId: "fund-auth", amountCents: 60000 },
    state: "PENDING_APPROVAL",
    approver: null,
    simulated: true,
    createdAt: NOW,
  } as const;

  it("accepts a simulated pending proposal", () => {
    expect(ActionProposalSchema.safeParse(proposal).success).toBe(true);
  });

  it("must be simulated (MVP never executes externally)", () => {
    expect(ActionProposalSchema.safeParse({ ...proposal, simulated: false }).success).toBe(false);
    expect(ActionProposalSchema.safeParse({ ...proposal, state: "EXECUTED" }).success).toBe(false);
  });

  it("kind must match payload; approval requires approver", () => {
    expect(ActionProposalSchema.safeParse({ ...proposal, kind: "MARK_DEPENDENCY_VERIFIED" }).success).toBe(false);
    expect(ActionProposalSchema.safeParse({ ...proposal, state: "APPROVED_FOR_DEMO" }).success).toBe(false);
    expect(
      ActionProposalSchema.safeParse({ ...proposal, state: "APPROVED_FOR_DEMO", approver: "ops-lead" }).success,
    ).toBe(true);
  });

  it("enforces state transitions", () => {
    expect(canTransitionActionProposal("DRAFT", "PENDING_APPROVAL")).toBe(true);
    expect(canTransitionActionProposal("PENDING_APPROVAL", "APPROVED_FOR_DEMO")).toBe(true);
    expect(canTransitionActionProposal("DRAFT", "APPROVED_FOR_DEMO")).toBe(false);
    expect(canTransitionActionProposal("REJECTED", "PENDING_APPROVAL")).toBe(false);
    expect(canTransitionActionProposal("APPROVED_FOR_DEMO", "REJECTED")).toBe(false);
  });
});

describe("RiskEvaluation", () => {
  const assertion = {
    assertionId: "risk-x",
    claim: "Cannot evaluate: availability unknown",
    status: "UNKNOWN",
    ruleId: "projected-shortfall-v1",
    inputs: [],
    evaluatedAt: NOW,
    amountCents: null,
    limitations: ["Fund availability not reported"],
  };
  const reason = {
    riskRuleId: "projected-shortfall-v1",
    thresholdDays: null,
    amountCents: null,
    daysUntil: 2,
    confirmedImpactedPathIds: [],
    detail: "Available allocation unknown",
  };

  it("UNKNOWN_DATA keeps unknown severity and null amounts", () => {
    const r = RiskEvaluationSchema.parse({
      category: "UNKNOWN_DATA",
      severity: "UNKNOWN",
      confidence: "UNKNOWN",
      reasons: [reason],
      assertion,
      requestedMappings: ["fund availability"],
    });
    expect(r.assertion.amountCents).toBeNull();
    expect(r.reasons[0]?.amountCents).toBeNull();
  });

  it("rejects UNKNOWN_DATA with a concrete severity, or no reasons", () => {
    const base = { category: "UNKNOWN_DATA", confidence: "UNKNOWN", assertion, requestedMappings: [] };
    expect(RiskEvaluationSchema.safeParse({ ...base, severity: "CRITICAL", reasons: [reason] }).success).toBe(false);
    expect(RiskEvaluationSchema.safeParse({ ...base, severity: "UNKNOWN", reasons: [] }).success).toBe(false);
  });
});

describe("API envelopes", () => {
  const meta = { workspaceMode: "DEMO", generatedAt: NOW, evaluatedAt: null };

  it("accepts { data, meta }", () => {
    const s = apiSuccessSchema(z.array(z.string()));
    expect(s.safeParse({ data: ["a"], meta }).success).toBe(true);
    expect(s.safeParse({ data: ["a"] }).success).toBe(false);
  });

  it("accepts { error: { code, message, details? } }", () => {
    expect(ApiErrorSchema.safeParse({ error: { code: "NOT_FOUND", message: "Incident not found" } }).success).toBe(true);
    expect(
      ApiErrorSchema.safeParse({ error: { code: "BAD_REQUEST", message: "Invalid", details: { field: "amountCents" } } })
        .success,
    ).toBe(true);
    expect(ApiErrorSchema.safeParse({ error: { code: "OOPS", message: "x" } }).success).toBe(false);
    expect(ApiErrorSchema.safeParse({ error: { code: "INTERNAL_ERROR", message: "x", stack: "..." } }).success).toBe(false);
  });

  it("response union accepts either shape but not both", () => {
    const s = apiResponseSchema(z.number());
    expect(s.safeParse({ data: 1, meta }).success).toBe(true);
    expect(s.safeParse({ error: { code: "NOT_FOUND", message: "x" } }).success).toBe(true);
    expect(s.safeParse({ data: 1, meta, error: { code: "NOT_FOUND", message: "x" } }).success).toBe(false);
  });
});
