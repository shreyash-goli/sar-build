import { describe, expect, it } from "vitest";
import raw from "@/fixtures/northstar-demo.json";
import { DemoFixtureSchema, entityNodeId, loadNorthstarFixture } from "@/fixtures/northstar";
import { findCardSecretKeys, formatCents, shortfallCents, knownCents } from "@/lib/schema";
import { checkEdgeEvidence } from "@/lib/repositories/edge-policy";
import { DEFAULT_DEMO_NOW, InvalidDemoClockError, getNow, getNowIso } from "@/lib/time";

const fx = loadNorthstarFixture();
const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
const evidence = byId(fx.evidence);
const nodes = byId(fx.nodes);

describe("Northstar fixture contract", () => {
  it("validates against the Zod schemas", () => {
    expect(DemoFixtureSchema.safeParse(raw).success).toBe(true);
  });

  it("is a DEMO workspace with the fixed demo clock", () => {
    expect(fx.workspace).toEqual({ id: "ws-northstar", name: "Northstar Labs", mode: "DEMO" });
    expect(fx.meta.demoNow).toBe(DEFAULT_DEMO_NOW);
  });

  it("contains no precomputed incidents, simulations or proposals", () => {
    for (const key of ["incidents", "simulations", "actionProposals", "auditEvents"]) {
      expect(raw).not.toHaveProperty(key);
    }
  });

  it("has globally unique IDs per collection", () => {
    for (const xs of [fx.evidence, fx.fundingSources, fx.paymentInstruments, fx.vendors, fx.vendorCharges, fx.transactions, fx.nodes, fx.edges]) {
      expect(new Set(xs.map((x) => x.id)).size).toBe(xs.length);
    }
    expect(new Set(fx.vendors.map((v) => v.normalizedKey)).size).toBe(fx.vendors.length);
    expect(new Set(fx.transactions.map((t) => t.providerEventId)).size).toBe(fx.transactions.length);
  });
});

describe("hero scenario A values", () => {
  const fund = fx.fundingSources.find((f) => f.id === "fund-auth")!;
  const charge = fx.vendorCharges.find((c) => c.id === "charge-cloudcomms-20261119")!;

  it("fund-auth: limit 400000, available 200000", () => {
    expect(fund).toMatchObject({ limitCents: 400000, availableCents: 200000 });
  });

  it("CloudComms charge 245000 expected 2026-11-19T16:00:00Z on fund-auth", () => {
    expect(charge).toMatchObject({
      vendorId: "vendor-cloudcomms",
      fundingSourceId: "fund-auth",
      expectedCents: 245000,
      expectedAt: "2026-11-19T16:00:00Z",
    });
    expect(fx.vendors.find((v) => v.id === "vendor-cloudcomms")?.billingMethod).toBe("CARD");
  });

  it("card-auth is metadata only and funded by fund-auth", () => {
    expect(fx.paymentInstruments.find((p) => p.id === "card-auth")).toMatchObject({
      fundingSourceId: "fund-auth",
      externalCardId: null,
    });
  });

  it("inputs yield the $450 modeled shortfall (sanity only; FS-10/11 compute it for real)", () => {
    const s = shortfallCents(knownCents(charge.expectedCents!), knownCents(fund.availableCents!));
    expect(formatCents(s)).toBe("$450.00");
  });

  it("confirmed chain fund-auth -> card-auth -> CloudComms -> OTP gateway -> Account login -> Customer checkout", () => {
    const chain = [
      "node-fund-auth",
      "node-card-auth",
      "node-vendor-cloudcomms",
      "node-service-otp-gateway",
      "node-workflow-account-login",
      "node-outcome-customer-checkout",
    ];
    for (let i = 0; i < chain.length - 1; i++) {
      const e = fx.edges.find((x) => x.fromNodeId === chain[i] && x.toNodeId === chain[i + 1]);
      expect(e, `${chain[i]} -> ${chain[i + 1]}`).toBeDefined();
      expect(e!.reviewStatus).toBe("CONFIRMED");
      expect(e!.dependencyStrength).toBe(i === chain.length - 2 ? "DEGRADED" : "HARD");
    }
    expect(nodes.get("node-outcome-customer-checkout")?.kind).toBe("OUTCOME");
  });
});

describe("scenarios B, C, D", () => {
  it("B: WebhookWorks declined transaction with local SPEND_LIMIT reason, path to on-call escalation", () => {
    const tx = fx.transactions.filter((t) => t.state === "DECLINED");
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ vendorId: "vendor-webhookworks", reason: "SPEND_LIMIT" });
    expect(evidence.get(tx[0]!.evidenceId)?.excerpt).toMatch(/not a verified Ramp enum/);
    expect(fx.edges.some((e) => e.fromNodeId === "node-vendor-webhookworks" && e.toNodeId === "node-service-incident-monitoring")).toBe(true);
    expect(fx.edges.some((e) => e.fromNodeId === "node-service-incident-monitoring" && e.toNodeId === "node-workflow-oncall-escalation")).toBe(true);
  });

  it("B: the WebhookWorks -> Incident monitoring edge is CONFIRMED (synthetic) with MEDIUM confidence and a potential-impact caveat", () => {
    const e = fx.edges.find((x) => x.id === "edge-vendor-webhookworks--service-incident-monitoring")!;
    expect(e).toMatchObject({ reviewStatus: "CONFIRMED", confidenceTier: "MEDIUM", dependencyStrength: "HARD" });
    expect(evidence.get(e.evidenceId)?.excerpt).toMatch(/Impact is potential, pending vendor service-status confirmation/);
    expect(fx.edges.filter((x) => x.confidenceTier === "MEDIUM").map((x) => x.id).sort()).toEqual([
      "edge-vendor-metricsrelay--service-product-analytics",
      "edge-vendor-webhookworks--service-incident-monitoring",
    ]);
  });

  it("C: ComputeHarbor is sufficiently funded with a confirmed application dependency", () => {
    const fund = fx.fundingSources.find((f) => f.id === "fund-infra")!;
    const charge = fx.vendorCharges.find((c) => c.vendorId === "vendor-computeharbor")!;
    expect(charge.fundingSourceId).toBe("fund-infra");
    expect(fund.availableCents!).toBeGreaterThan(charge.expectedCents!);
    expect(fx.edges.find((e) => e.fromNodeId === "node-vendor-computeharbor")?.reviewStatus).toBe("CONFIRMED");
  });

  it("D: MetricsRelay has UNKNOWN billing, no funding source, and no card", () => {
    expect(fx.vendors.find((v) => v.id === "vendor-metricsrelay")?.billingMethod).toBe("UNKNOWN");
    const charges = fx.vendorCharges.filter((c) => c.vendorId === "vendor-metricsrelay");
    expect(charges.length).toBeGreaterThan(0);
    for (const c of charges) expect(c.fundingSourceId).toBeNull();
    expect(fx.edges.some((e) => e.toNodeId === "node-vendor-metricsrelay")).toBe(false);
  });
});

describe("graph integrity and provenance", () => {
  it("every edge references existing nodes and evidence", () => {
    for (const e of fx.edges) {
      expect(nodes.has(e.fromNodeId), e.id).toBe(true);
      expect(nodes.has(e.toNodeId), e.id).toBe(true);
      expect(evidence.has(e.evidenceId), e.id).toBe(true);
    }
  });

  it("edge counts per review status", () => {
    const counts = Object.fromEntries(["CONFIRMED", "SUGGESTED", "REJECTED"].map((s) => [s, fx.edges.filter((e) => e.reviewStatus === s).length]));
    expect(counts).toEqual({ CONFIRMED: 14, SUGGESTED: 1, REJECTED: 0 });
    expect(fx.edges).toHaveLength(15);
    expect(fx.nodes).toHaveLength(18);
  });

  it("every edge passes the repository provenance gate", () => {
    for (const e of fx.edges) expect(checkEdgeEvidence(e.reviewStatus, evidence.get(e.evidenceId)!).ok, e.id).toBe(true);
  });

  it("no duplicate (from, to, relation) edges", () => {
    const keys = fx.edges.map((e) => `${e.fromNodeId}|${e.toNodeId}|${e.relation}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every record has its own evidence record; every evidence is used exactly once", () => {
    const records = [...fx.fundingSources, ...fx.paymentInstruments, ...fx.vendors, ...fx.vendorCharges, ...fx.transactions, ...fx.nodes, ...fx.edges];
    const refs = records.map((r) => r.evidenceId);
    for (const ref of refs) expect(evidence.has(ref), ref).toBe(true);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs.length).toBe(fx.evidence.length);
  });

  it("all evidence is FIXTURE / DEMO_FIXTURE with a synthetic disclaimer", () => {
    for (const ev of fx.evidence) {
      expect(ev).toMatchObject({ kind: "FIXTURE", classification: "DEMO_FIXTURE", verificationStatus: "UNVERIFIED" });
      expect(ev.excerpt).toMatch(/^SYNTHETIC DEMO FIXTURE/);
    }
    for (const c of fx.vendorCharges) expect(c.sourceClass).toBe("DEMO_FIXTURE");
  });

  it("financial nodes map to existing entities by node-<entityId>", () => {
    const entities = new Set([...fx.fundingSources, ...fx.paymentInstruments, ...fx.vendors].map((x) => entityNodeId(x.id)));
    for (const n of fx.nodes.filter((n) => ["FUND", "CARD", "VENDOR"].includes(n.kind))) {
      expect(entities.has(n.id), n.id).toBe(true);
    }
    expect(entities.size).toBe(fx.nodes.filter((n) => ["FUND", "CARD", "VENDOR"].includes(n.kind)).length);
  });

  it("every charge/transaction/card references existing vendors and funds", () => {
    const funds = byId(fx.fundingSources);
    const vendors = byId(fx.vendors);
    for (const c of fx.vendorCharges) {
      expect(vendors.has(c.vendorId)).toBe(true);
      if (c.fundingSourceId) expect(funds.has(c.fundingSourceId)).toBe(true);
    }
    for (const t of fx.transactions) {
      expect(vendors.has(t.vendorId)).toBe(true);
      if (t.fundingSourceId) expect(funds.has(t.fundingSourceId)).toBe(true);
    }
    for (const p of fx.paymentInstruments) if (p.fundingSourceId) expect(funds.has(p.fundingSourceId)).toBe(true);
  });

  it("contains no card-secret fields anywhere", () => {
    expect(findCardSecretKeys(raw)).toEqual([]);
    expect(JSON.stringify(raw)).not.toMatch(/\b\d{12,19}\b/);
  });
});

describe("getNow", () => {
  const real = new Date("2030-01-01T00:00:00Z");
  const realNow = () => real;

  it("uses DEMO_NOW in demo mode", () => {
    expect(getNowIso({ env: { DEMO_MODE: "true", DEMO_NOW: "2026-11-20T08:00:00Z" }, realNow })).toBe("2026-11-20T08:00:00Z");
  });

  it("defaults to the blueprint demo clock when DEMO_NOW is unset", () => {
    expect(getNowIso({ env: { DEMO_MODE: "true" }, realNow })).toBe(DEFAULT_DEMO_NOW);
  });

  it("uses real time outside demo mode, ignoring DEMO_NOW", () => {
    expect(getNow({ env: { DEMO_MODE: "false", DEMO_NOW: DEFAULT_DEMO_NOW }, realNow })).toBe(real);
    expect(getNow({ env: {}, realNow })).toBe(real);
  });

  it("fails loudly on an invalid DEMO_NOW instead of falling back", () => {
    expect(() => getNow({ env: { DEMO_MODE: "true", DEMO_NOW: "2026-11-17 16:00" }, realNow })).toThrow(InvalidDemoClockError);
    expect(() => getNow({ env: { DEMO_MODE: "true", DEMO_NOW: "2026-11-17T16:00:00" }, realNow })).toThrow(InvalidDemoClockError);
  });

  it("returns a fresh Date each call", () => {
    const env = { DEMO_MODE: "true" };
    expect(getNow({ env })).not.toBe(getNow({ env }));
  });
});

describe("getNow uses the shared demo-mode parser", () => {
  it("accepts DEMO_MODE=TRUE", () => {
    expect(getNowIso({ env: { DEMO_MODE: " TRUE " }, realNow: () => new Date(0) })).toBe(DEFAULT_DEMO_NOW);
  });
});
