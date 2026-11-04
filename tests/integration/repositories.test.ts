/**
 * Repository integration tests against a throwaway SQLite file per run.
 * The schema is applied with `prisma migrate deploy` (the real migrations).
 * Never touches dev.db.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, type PrismaClient } from "@/lib/db";
import {
  ConflictError,
  NotFoundError,
  ProvenanceViolationError,
  ValidationError,
  createRepositories,
  type Repositories,
} from "@/lib/repositories";
import { WriteForbiddenError, assertWritesAllowed } from "@/lib/security/write-gate";

const NOW = "2026-11-17T16:00:00Z";
const ROOT = resolve(__dirname, "../..");

let dir: string;
let db: PrismaClient;
let repos: Repositories;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-repo-test-"));
  const url = `file:${join(dir, "test.db")}`;
  execFileSync(join(ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  db = createDbClient(url);
  repos = createRepositories(db, { writeGate: () => assertWritesAllowed({ env: { DEMO_MODE: "true" } }) });
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// Children before parents (evidence last: it is Restrict-referenced; cleaned with raw delete for tests only).
beforeEach(async () => {
  await db.auditEvent.deleteMany();
  await db.actionProposal.deleteMany();
  await db.simulation.deleteMany();
  await db.incident.deleteMany();
  await db.edge.deleteMany();
  await db.node.deleteMany();
  await db.transaction.deleteMany();
  await db.vendorCharge.deleteMany();
  await db.paymentInstrument.deleteMany();
  await db.vendor.deleteMany();
  await db.fundingSource.deleteMany();
  await db.workspace.deleteMany();
  await db.evidenceRecord.deleteMany();
});

const fixtureEvidence = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  kind: "FIXTURE",
  sourceSystem: "northstar-demo-seed",
  sourceId: id,
  capturedAt: NOW,
  observedAt: null,
  excerpt: null,
  path: null,
  contentHash: null,
  classification: "DEMO_FIXTURE",
  verificationStatus: "UNVERIFIED",
  ...overrides,
});

const fund = {
  id: "fund-auth",
  provider: "DEMO",
  externalFundId: "ext-fund-auth",
  name: "Auth Infrastructure",
  interval: "MONTHLY",
  limitCents: 500000,
  availableCents: 200000,
  observedAt: NOW,
  evidenceId: "ev-fund",
} as const;

const vendor = {
  id: "vendor-cloudcomms",
  name: "CloudComms",
  normalizedKey: "cloudcomms",
  billingMethod: "CARD",
  evidenceId: "ev-vendor",
} as const;

const node = (id: string, kind = "SERVICE") => ({
  id,
  kind,
  label: id,
  criticality: "HIGH",
  owner: null,
  evidenceId: "ev-node",
});

const edge = (overrides: Record<string, unknown> = {}) => ({
  id: "edge-1",
  fromNodeId: "n-vendor",
  toNodeId: "n-service",
  relation: "POWERS",
  dependencyStrength: "HARD",
  confidenceTier: "HIGH",
  reviewStatus: "CONFIRMED",
  evidenceId: "ev-edge",
  ...overrides,
});

async function seedBasics() {
  for (const id of ["ev-fund", "ev-vendor", "ev-node", "ev-edge", "ev-card", "ev-charge", "ev-tx", "ev-inc"]) {
    await repos.evidence.create(fixtureEvidence(id));
  }
  await repos.fundingSources.create(fund);
  await repos.vendors.create(vendor);
}

async function seedIncident() {
  await repos.incidents.create({
    id: "inc-1",
    scenarioKey: "A",
    status: "OPEN",
    severity: "HIGH",
    title: "Projected shortfall",
    firstSeenAt: NOW,
    updatedAt: NOW,
    primaryVendorId: vendor.id,
    detectionRule: "projected-shortfall-v1",
    snapshotJson: { shortfallCents: 45000, availableCents: null },
    evidenceId: "ev-inc",
  });
}

describe("CRUD round trips", () => {
  it("workspace create/read/update/delete", async () => {
    const created = await repos.workspaces.create({ id: "ws-1", name: "Northstar Labs", mode: "DEMO" });
    expect(await repos.workspaces.getById("ws-1")).toEqual(created);
    expect((await repos.workspaces.update("ws-1", { name: "Northstar Labs (demo)" })).name).toBe("Northstar Labs (demo)");
    expect(await repos.workspaces.list()).toHaveLength(1);
    await repos.workspaces.delete("ws-1");
    expect(await repos.workspaces.findById("ws-1")).toBeNull();
    await expect(repos.workspaces.getById("ws-1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("funding source, vendor, card, charge, transaction, node, edge, incident, simulation, proposal round-trip", async () => {
    await seedBasics();
    expect(await repos.fundingSources.getById(fund.id)).toEqual(fund);
    expect(await repos.vendors.findByNormalizedKey("cloudcomms")).toEqual(vendor);

    const card = {
      id: "card-auth",
      kind: "VIRTUAL_CARD",
      externalCardId: "card_ext_01",
      fundingSourceId: fund.id,
      status: "ACTIVE",
      evidenceId: "ev-card",
    } as const;
    expect(await repos.paymentInstruments.create(card)).toEqual(card);

    const charge = {
      id: "charge-1",
      vendorId: vendor.id,
      fundingSourceId: fund.id,
      expectedAt: "2026-11-19T00:00:00Z",
      expectedCents: 245000,
      status: "SCHEDULED",
      sourceClass: "DEMO_FIXTURE",
      evidenceId: "ev-charge",
    } as const;
    await repos.vendorCharges.create(charge);
    expect(await repos.vendorCharges.listByVendor(vendor.id)).toEqual([charge]);

    const tx = {
      id: "tx-1",
      providerEventId: "evt-1",
      vendorId: vendor.id,
      fundingSourceId: fund.id,
      occurredAt: NOW,
      amountCents: -245000,
      state: "REVERSED",
      reason: null,
      evidenceId: "ev-tx",
    } as const;
    expect(await repos.transactions.create(tx)).toEqual(tx);

    await repos.nodes.create(node("n-vendor", "VENDOR"));
    await repos.nodes.create(node("n-service"));
    expect(await repos.edges.create(edge())).toEqual(edge());

    await seedIncident();
    const inc = await repos.incidents.findByScenarioKey("A");
    expect(inc?.snapshotJson).toEqual({ shortfallCents: 45000, availableCents: null });

    const patch = { kind: "INCREASE_AVAILABLE_ALLOCATION", fundingSourceId: fund.id, amountCents: 60000 } as const;
    const sim = {
      id: "sim-1",
      incidentId: "inc-1",
      patchJson: patch,
      beforeJson: { shortfallCents: 45000 },
      afterJson: { shortfallCents: 0 },
      createdAt: NOW,
      createdBy: "demo-user",
      isDemo: true,
    };
    expect(await repos.simulations.create(sim)).toEqual(sim);
    expect(await repos.simulations.listByIncident("inc-1")).toEqual([sim]);

    const proposal = {
      id: "prop-1",
      incidentId: "inc-1",
      kind: "INCREASE_AVAILABLE_ALLOCATION",
      payloadJson: patch,
      state: "DRAFT",
      approver: null,
      simulated: true,
      createdAt: NOW,
    } as const;
    await repos.actionProposals.create(proposal);
    await repos.actionProposals.update("prop-1", { state: "PENDING_APPROVAL" });
    const approved = await repos.actionProposals.update("prop-1", { state: "APPROVED_FOR_DEMO", approver: "ops-lead" });
    expect(approved).toMatchObject({ state: "APPROVED_FOR_DEMO", approver: "ops-lead", simulated: true });
  });

  it("normalizes offset timestamps to UTC Z on read", async () => {
    const ev = await repos.evidence.create(fixtureEvidence("ev-off", { capturedAt: "2026-11-17T08:00:00-08:00" }));
    expect(ev.capturedAt).toBe(NOW);
  });

  it("supports amounts beyond the 32-bit range", async () => {
    await seedBasics();
    const big = 9_000_000_000_000; // $90B in cents
    const updated = await repos.fundingSources.update(fund.id, { limitCents: big });
    expect(updated.limitCents).toBe(big);
  });
});

describe("unknown money stays null through the database", () => {
  it("null availability/limit/expected amount round-trips as null, not 0", async () => {
    await seedBasics();
    await repos.fundingSources.update(fund.id, { availableCents: null, limitCents: null });
    const stored = await repos.fundingSources.getById(fund.id);
    expect(stored.availableCents).toBeNull();
    expect(stored.limitCents).toBeNull();

    const row = await db.fundingSource.findUnique({ where: { id: fund.id } });
    expect(row?.availableCents).toBeNull();

    await repos.vendorCharges.create({
      id: "charge-unknown",
      vendorId: vendor.id,
      fundingSourceId: null,
      expectedAt: "2026-11-19T00:00:00Z",
      expectedCents: null,
      status: "FORECAST",
      sourceClass: "UNKNOWN",
      evidenceId: "ev-charge",
    });
    expect((await repos.vendorCharges.getById("charge-unknown")).expectedCents).toBeNull();
  });

  it("rejects float cents and missing money keys at the repository boundary", async () => {
    await seedBasics();
    await expect(repos.fundingSources.update(fund.id, { availableCents: 10.5 })).rejects.toBeInstanceOf(ValidationError);
    const { availableCents: _omit, ...missing } = { ...fund, id: "fund-2", externalFundId: null };
    void _omit;
    await expect(repos.fundingSources.create(missing)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("unique constraints", () => {
  beforeEach(seedBasics);

  it("duplicate primary key", async () => {
    await expect(repos.vendors.create({ ...vendor, normalizedKey: "other" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("Vendor.normalizedKey", async () => {
    await expect(repos.vendors.create({ ...vendor, id: "vendor-2" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("FundingSource.externalFundId", async () => {
    await expect(repos.fundingSources.create({ ...fund, id: "fund-2" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("EvidenceRecord (sourceSystem, sourceId, capturedAt)", async () => {
    await expect(repos.evidence.create(fixtureEvidence("ev-dupe", { sourceId: "ev-fund" }))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("Edge (fromNodeId, toNodeId, relation)", async () => {
    await repos.nodes.create(node("n-vendor", "VENDOR"));
    await repos.nodes.create(node("n-service"));
    await repos.edges.create(edge());
    await expect(repos.edges.create(edge({ id: "edge-2" }))).rejects.toBeInstanceOf(ConflictError);
    // Same pair, different relation is a distinct edge.
    await expect(repos.edges.create(edge({ id: "edge-3", relation: "REQUIRES" }))).resolves.toBeTruthy();
  });

  it("Incident.scenarioKey", async () => {
    await seedIncident();
    await expect(
      repos.incidents.create({ ...(await repos.incidents.getById("inc-1")), id: "inc-2" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("Transaction.providerEventId with idempotent ingest", async () => {
    const tx = {
      id: "tx-1",
      providerEventId: "evt-1",
      vendorId: vendor.id,
      fundingSourceId: null,
      occurredAt: NOW,
      amountCents: 245000,
      state: "DECLINED",
      reason: "insufficient allocation",
      evidenceId: "ev-tx",
    } as const;
    expect((await repos.transactions.ingest(tx)).created).toBe(true);
    const replay = await repos.transactions.ingest({ ...tx, id: "tx-replay", occurredAt: "2026-11-17T16:00:00.000Z" });
    expect(replay).toEqual({ transaction: tx, created: false });
    await expect(repos.transactions.ingest({ ...tx, amountCents: 1 })).rejects.toBeInstanceOf(ConflictError);
    await expect(repos.transactions.create({ ...tx, id: "tx-2" })).rejects.toBeInstanceOf(ConflictError);
    expect(await repos.transactions.list()).toHaveLength(1);
  });

  it("foreign keys: missing references and protected evidence", async () => {
    await expect(
      repos.paymentInstruments.create({
        id: "card-x",
        kind: "VIRTUAL_CARD",
        externalCardId: null,
        fundingSourceId: "fund-missing",
        status: "ACTIVE",
        evidenceId: "ev-card",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    // Referenced evidence cannot be deleted (onDelete: Restrict).
    await expect(db.evidenceRecord.delete({ where: { id: "ev-fund" } })).rejects.toThrow();
  });
});

describe("append-only evidence and audit records (no update/delete helpers)", () => {
  it("expose no update or delete helpers", () => {
    for (const repo of [repos.evidence, repos.auditEvents, repos.simulations]) {
      expect("update" in repo).toBe(false);
      expect("delete" in repo).toBe(false);
      expect("upsert" in repo).toBe(false);
      expect(Object.isFrozen(repo)).toBe(true);
    }
  });

  it("re-creating an evidence record with the same id throws and keeps the original", async () => {
    await repos.evidence.create(fixtureEvidence("ev-1"));
    await expect(
      repos.evidence.create(
        fixtureEvidence("ev-1", { sourceId: "tampered", verificationStatus: "USER_VERIFIED", excerpt: "tampered" }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    const stored = await repos.evidence.getById("ev-1");
    expect(stored.verificationStatus).toBe("UNVERIFIED");
    expect(stored.excerpt).toBeNull();
  });

  it("re-creating an audit event with the same id throws and keeps the original", async () => {
    const event = { id: "audit-1", actor: "demo-user", action: "action.proposed", subjectId: "prop-1", detailsJson: { a: 1 }, at: NOW };
    expect(await repos.auditEvents.create(event)).toEqual(event);
    await expect(repos.auditEvents.create({ ...event, action: "action.approved_for_demo" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await repos.auditEvents.listBySubject("prop-1")).toEqual([event]);
  });
});

describe("edge provenance gate", () => {
  beforeEach(async () => {
    await seedBasics();
    await repos.nodes.create(node("n-vendor", "VENDOR"));
    await repos.nodes.create(node("n-service"));
    await repos.evidence.create(
      fixtureEvidence("ev-model", { kind: "MODEL", classification: "MODEL_SUGGESTED", sourceSystem: "llm" }),
    );
  });

  it("rejects storing a CONFIRMED edge on unreviewed MODEL_SUGGESTED evidence", async () => {
    await expect(repos.edges.create(edge({ evidenceId: "ev-model" }))).rejects.toBeInstanceOf(ProvenanceViolationError);
    expect(await repos.edges.list()).toHaveLength(0);
  });

  it("allows it as SUGGESTED, but blocks promotion to CONFIRMED via update", async () => {
    await repos.edges.create(edge({ evidenceId: "ev-model", reviewStatus: "SUGGESTED" }));
    await expect(repos.edges.update("edge-1", { reviewStatus: "CONFIRMED" })).rejects.toBeInstanceOf(
      ProvenanceViolationError,
    );
    expect((await repos.edges.getById("edge-1")).reviewStatus).toBe("SUGGESTED");
  });

  it("allows CONFIRMED once backed by USER_VERIFIED evidence (new append-only record)", async () => {
    await repos.edges.create(edge({ evidenceId: "ev-model", reviewStatus: "SUGGESTED" }));
    await repos.evidence.create(
      fixtureEvidence("ev-model-reviewed", {
        kind: "MODEL",
        classification: "MODEL_SUGGESTED",
        sourceSystem: "user-review",
        verificationStatus: "USER_VERIFIED",
      }),
    );
    const confirmed = await repos.edges.update("edge-1", { reviewStatus: "CONFIRMED", evidenceId: "ev-model-reviewed" });
    expect(confirmed.reviewStatus).toBe("CONFIRMED");
  });

  it("rejects a CONFIRMED edge on unverified RULE/DERIVED evidence", async () => {
    await repos.evidence.create(
      fixtureEvidence("ev-rule", { kind: "RULE", classification: "DERIVED", sourceSystem: "risk-engine" }),
    );
    await expect(repos.edges.create(edge({ evidenceId: "ev-rule" }))).rejects.toBeInstanceOf(ProvenanceViolationError);
  });

  it("rejects promotion SUGGESTED -> CONFIRMED by swapping in new unverified MANUAL evidence", async () => {
    await repos.edges.create(edge({ evidenceId: "ev-model", reviewStatus: "SUGGESTED" }));
    await repos.evidence.create(
      fixtureEvidence("ev-manual", { kind: "MANUAL", classification: "EXTERNAL_OBSERVED", sourceSystem: "ops-note" }),
    );
    await expect(
      repos.edges.update("edge-1", { reviewStatus: "CONFIRMED", evidenceId: "ev-manual" }),
    ).rejects.toBeInstanceOf(ProvenanceViolationError);
    // Even unverified fixture evidence cannot be used to promote.
    await expect(
      repos.edges.update("edge-1", { reviewStatus: "CONFIRMED", evidenceId: "ev-edge" }),
    ).rejects.toBeInstanceOf(ProvenanceViolationError);
    expect(await repos.edges.getById("edge-1")).toMatchObject({ reviewStatus: "SUGGESTED", evidenceId: "ev-model" });
  });

  it("rejects promotion REJECTED -> CONFIRMED without USER_VERIFIED evidence", async () => {
    await repos.edges.create(edge({ reviewStatus: "REJECTED" }));
    await expect(repos.edges.update("edge-1", { reviewStatus: "CONFIRMED" })).rejects.toBeInstanceOf(
      ProvenanceViolationError,
    );
  });

  it("still allows creating a CONFIRMED edge directly on DEMO_FIXTURE evidence (seed path)", async () => {
    await expect(repos.edges.create(edge())).resolves.toMatchObject({ reviewStatus: "CONFIRMED", evidenceId: "ev-edge" });
  });

  it("rejects edges citing nonexistent evidence", async () => {
    await expect(repos.edges.create(edge({ evidenceId: "ev-missing" }))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("action proposal creation states", () => {
  it.each(["APPROVED_FOR_DEMO", "REJECTED"] as const)("rejects creating a proposal as %s", async (state) => {
    await seedBasics();
    await seedIncident();
    await expect(
      repos.actionProposals.create({
        id: "prop-x",
        incidentId: "inc-1",
        kind: "MARK_DEPENDENCY_VERIFIED",
        payloadJson: { kind: "MARK_DEPENDENCY_VERIFIED", edgeId: "edge-1" },
        state,
        approver: "ops-lead",
        simulated: true,
        createdAt: NOW,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await repos.actionProposals.list()).toEqual([]);
  });

  it.each(["DRAFT", "PENDING_APPROVAL"] as const)("accepts creating a proposal as %s", async (state) => {
    await seedBasics();
    await seedIncident();
    await expect(
      repos.actionProposals.create({
        id: "prop-x",
        incidentId: "inc-1",
        kind: "MARK_DEPENDENCY_VERIFIED",
        payloadJson: { kind: "MARK_DEPENDENCY_VERIFIED", edgeId: "edge-1" },
        state,
        approver: null,
        simulated: true,
        createdAt: NOW,
      }),
    ).resolves.toMatchObject({ state });
  });
});

describe("incident deletion is demo-reset only", () => {
  it("incidents, simulations and proposals expose no generic delete", () => {
    expect("delete" in repos.incidents).toBe(false);
    expect("delete" in repos.actionProposals).toBe(false);
    expect("delete" in repos.simulations).toBe(false);
    expect(typeof repos.incidents.deleteForDemoReset).toBe("function");
  });

  it("deleteForDemoReset cascades to simulations and proposals and passes the write gate", async () => {
    await seedBasics();
    await seedIncident();
    await repos.simulations.create({
      id: "sim-1",
      incidentId: "inc-1",
      patchJson: { kind: "MARK_DEPENDENCY_VERIFIED", edgeId: "edge-1" },
      beforeJson: {},
      afterJson: {},
      createdAt: NOW,
      createdBy: "demo-user",
      isDemo: true,
    });
    await repos.actionProposals.create({
      id: "prop-1",
      incidentId: "inc-1",
      kind: "MARK_DEPENDENCY_VERIFIED",
      payloadJson: { kind: "MARK_DEPENDENCY_VERIFIED", edgeId: "edge-1" },
      state: "DRAFT",
      approver: null,
      simulated: true,
      createdAt: NOW,
    });

    const locked = createRepositories(db, { writeGate: () => assertWritesAllowed({ env: { DEMO_MODE: "false" } }) });
    await expect(locked.incidents.deleteForDemoReset("inc-1")).rejects.toBeInstanceOf(WriteForbiddenError);
    expect(await repos.simulations.list()).toHaveLength(1);

    await repos.incidents.deleteForDemoReset("inc-1");
    expect(await repos.incidents.findById("inc-1")).toBeNull();
    expect(await repos.simulations.list()).toEqual([]);
    expect(await repos.actionProposals.list()).toEqual([]);
    // Evidence is untouched by the cascade.
    expect(await repos.evidence.findById("ev-inc")).not.toBeNull();
  });
});

describe("action proposal transitions", () => {
  it("rejects invalid transitions with a conflict", async () => {
    await seedBasics();
    await seedIncident();
    await repos.actionProposals.create({
      id: "prop-1",
      incidentId: "inc-1",
      kind: "MARK_DEPENDENCY_VERIFIED",
      payloadJson: { kind: "MARK_DEPENDENCY_VERIFIED", edgeId: "edge-1" },
      state: "DRAFT",
      approver: null,
      simulated: true,
      createdAt: NOW,
    });
    await expect(
      repos.actionProposals.update("prop-1", { state: "APPROVED_FOR_DEMO", approver: "x" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await repos.actionProposals.update("prop-1", { state: "REJECTED" });
    await expect(repos.actionProposals.update("prop-1", { approver: "x" })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("write gate on repositories", () => {
  it("blocks every write when the gate denies, and nothing is stored", async () => {
    const locked = createRepositories(db, { writeGate: () => assertWritesAllowed({ env: { DEMO_MODE: "false" } }) });
    await expect(locked.evidence.create(fixtureEvidence("ev-x"))).rejects.toBeInstanceOf(WriteForbiddenError);
    await expect(locked.workspaces.create({ id: "ws", name: "N", mode: "DEMO" })).rejects.toBeInstanceOf(
      WriteForbiddenError,
    );
    expect(await locked.evidence.list()).toEqual([]);

    await repos.workspaces.create({ id: "ws", name: "N", mode: "DEMO" });
    await expect(locked.workspaces.update("ws", { name: "M" })).rejects.toBeInstanceOf(WriteForbiddenError);
    await expect(locked.workspaces.delete("ws")).rejects.toBeInstanceOf(WriteForbiddenError);
    expect((await locked.workspaces.getById("ws")).name).toBe("N");
  });
});
