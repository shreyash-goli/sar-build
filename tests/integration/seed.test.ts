/**
 * FS-04 seed/reset integration tests against a throwaway SQLite file.
 * Never touches ./dev.db (asserted below).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, type PrismaClient } from "@/lib/db";
import { applyCliDemoDefault } from "@/lib/demo/cli-env";
import { DemoModeRequiredError, resetNorthstarDemo, seedNorthstarDemo } from "@/lib/demo/northstar";
import { loadNorthstarFixture, type DemoFixture } from "@/fixtures/northstar";
import { ConflictError, createRepositories, type Repositories } from "@/lib/repositories";
import { assertWritesAllowed } from "@/lib/security/write-gate";

const ROOT = resolve(__dirname, "../..");
const DEV_DB = join(ROOT, "dev.db");
const DEMO = { DEMO_MODE: "true" } as const;
const NOW = "2026-11-17T16:00:00Z";

function devDbFingerprint(): string | null {
  if (!existsSync(DEV_DB)) return null;
  const st = statSync(DEV_DB);
  return `${st.size}:${st.mtimeMs}:${createHash("sha256").update(readFileSync(DEV_DB)).digest("hex")}`;
}

let dir: string;
let db: PrismaClient;
let repos: Repositories;
let devDbBefore: string | null;

beforeAll(() => {
  devDbBefore = devDbFingerprint();
  dir = mkdtempSync(join(tmpdir(), "failsafe-seed-test-"));
  const url = `file:${join(dir, "seed.db")}`;
  execFileSync(join(ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  db = createDbClient(url);
  repos = createRepositories(db, {
    writeGate: () => assertWritesAllowed({ env: DEMO }),
    demoResetGate: () => undefined,
  });
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
  expect(devDbFingerprint()).toBe(devDbBefore);
});

beforeEach(async () => {
  await repos.demoReset.clearAllData();
});

async function snapshot() {
  return {
    workspaces: await repos.workspaces.list(),
    evidence: await repos.evidence.list(),
    fundingSources: await repos.fundingSources.list(),
    paymentInstruments: await repos.paymentInstruments.list(),
    vendors: await repos.vendors.list(),
    vendorCharges: await repos.vendorCharges.list(),
    transactions: await repos.transactions.list(),
    nodes: await repos.nodes.list(),
    edges: await repos.edges.list(),
    incidents: await repos.incidents.list(),
    simulations: await repos.simulations.list(),
    actionProposals: await repos.actionProposals.list(),
    auditEvents: await repos.auditEvents.list(),
  };
}

function expectGoldenState(s: Awaited<ReturnType<typeof snapshot>>) {
  expect(s.workspaces).toEqual([{ id: "ws-northstar", name: "Northstar Labs", mode: "DEMO" }]);
  expect(s.fundingSources).toHaveLength(3);
  expect(s.paymentInstruments).toHaveLength(3);
  expect(s.vendors).toHaveLength(4);
  expect(s.vendorCharges).toHaveLength(3);
  expect(s.transactions).toHaveLength(3);
  expect(s.nodes).toHaveLength(18);
  expect(s.edges).toHaveLength(15);
  expect(s.evidence).toHaveLength(49);
  const byStatus = (st: string) => s.edges.filter((e) => e.reviewStatus === st).length;
  expect([byStatus("CONFIRMED"), byStatus("SUGGESTED"), byStatus("REJECTED")]).toEqual([14, 1, 0]);

  expect(s.fundingSources.find((f) => f.id === "fund-auth")).toMatchObject({ limitCents: 400000, availableCents: 200000 });
  expect(s.vendorCharges.find((c) => c.id === "charge-cloudcomms-20261119")).toMatchObject({
    expectedCents: 245000,
    expectedAt: "2026-11-19T16:00:00Z",
    fundingSourceId: "fund-auth",
  });

  // Provenance: every record cites its own DEMO_FIXTURE evidence.
  const ev = new Map(s.evidence.map((e) => [e.id, e]));
  for (const e of s.evidence) expect(e).toMatchObject({ kind: "FIXTURE", classification: "DEMO_FIXTURE", verificationStatus: "UNVERIFIED" });
  const refs = [...s.fundingSources, ...s.paymentInstruments, ...s.vendors, ...s.vendorCharges, ...s.transactions, ...s.nodes, ...s.edges].map((r) => r.evidenceId);
  for (const r of refs) expect(ev.has(r), r).toBe(true);
  expect(new Set(refs).size).toBe(49);

  // Nothing generated-by-logic is precomputed.
  expect(s.incidents).toEqual([]);
  expect(s.simulations).toEqual([]);
  expect(s.actionProposals).toEqual([]);
  expect(s.auditEvents).toEqual([]);
}

const fixtureAsStored = () => {
  const fx = loadNorthstarFixture();
  return { evidence: fx.evidence, edges: fx.edges, nodes: fx.nodes };
};

describe("seed", () => {
  it("seeds the exact golden-path fixture", async () => {
    const summary = await seedNorthstarDemo(db, { env: DEMO });
    expect(summary.created).toEqual({
      workspaces: 1, evidence: 49, fundingSources: 3, paymentInstruments: 3, vendors: 4,
      vendorCharges: 3, transactions: 3, nodes: 18, edges: 15,
    });
    const s = await snapshot();
    expectGoldenState(s);
    // Stored records equal the fixture (sorted by id).
    const sortById = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
    const fx = fixtureAsStored();
    expect(s.evidence).toEqual(sortById(fx.evidence));
    expect(s.edges).toEqual(sortById(fx.edges));
    expect(s.nodes).toEqual(sortById(fx.nodes));
  });

  it("is idempotent: seeding twice creates nothing and changes nothing", async () => {
    await seedNorthstarDemo(db, { env: DEMO });
    const first = await snapshot();
    const second = await seedNorthstarDemo(db, { env: DEMO });
    expect(Object.values(second.created).every((n) => n === 0)).toBe(true);
    expect(second.unchanged.evidence).toBe(49);
    expect(await snapshot()).toEqual(first);
  });

  it("never overwrites drifted data; aborts atomically and points to reset", async () => {
    await seedNorthstarDemo(db, { env: DEMO });
    await repos.fundingSources.update("fund-auth", { availableCents: 123 });
    const before = await snapshot();
    await expect(seedNorthstarDemo(db, { env: DEMO })).rejects.toBeInstanceOf(ConflictError);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses when demo mode is off", async () => {
    await expect(seedNorthstarDemo(db, { env: { DEMO_MODE: "false" } })).rejects.toBeInstanceOf(DemoModeRequiredError);
    await expect(seedNorthstarDemo(db, { env: {} })).rejects.toBeInstanceOf(DemoModeRequiredError);
    expect((await snapshot()).evidence).toEqual([]);
  });

  it("is atomic: a failure mid-seed leaves the database unchanged", async () => {
    const good = loadNorthstarFixture();
    // A duplicate (from, to, relation) edge as the LAST record forces a unique-constraint failure
    // after every other row has been written inside the transaction.
    const bad: DemoFixture = { ...good, edges: [...good.edges, { ...good.edges[0]!, id: "edge-duplicate" }] };
    await expect(seedNorthstarDemo(db, { env: DEMO, fixture: bad })).rejects.toBeInstanceOf(ConflictError);
    const s = await snapshot();
    for (const rows of Object.values(s)) expect(rows).toEqual([]);
  });
});

describe("reset", () => {
  it("two resets yield identical IDs, amounts, edge counts and provenance", async () => {
    await seedNorthstarDemo(db, { env: DEMO });
    const seeded = await snapshot();
    const r1 = await resetNorthstarDemo(db, { env: DEMO });
    const afterFirst = await snapshot();
    const r2 = await resetNorthstarDemo(db, { env: DEMO });
    const afterSecond = await snapshot();
    expectGoldenState(afterSecond);
    expect(afterFirst).toEqual(seeded);
    expect(afterSecond).toEqual(afterFirst);
    expect(r1.seed.created).toEqual(r2.seed.created);
    expect(r2.cleared.evidence).toBe(49);
    expect(r2.regenerated).toEqual({ incidents: 0, simulations: 0, actionProposals: 0 });
  });

  it("clears incidents, simulations, proposals, audit events and drift, then restores the fixture", async () => {
    await seedNorthstarDemo(db, { env: DEMO });
    await repos.fundingSources.update("fund-auth", { availableCents: 999999 });
    await repos.incidents.create({
      id: "inc-1", scenarioKey: "A", status: "OPEN", severity: "HIGH", title: "Projected shortfall",
      firstSeenAt: NOW, updatedAt: NOW, primaryVendorId: "vendor-cloudcomms",
      detectionRule: "projected-shortfall-v1", snapshotJson: {}, evidenceId: "ev-fund-auth",
    });
    const patch = { kind: "INCREASE_AVAILABLE_ALLOCATION", fundingSourceId: "fund-auth", amountCents: 60000 } as const;
    await repos.simulations.create({
      id: "sim-1", incidentId: "inc-1", patchJson: patch, beforeJson: {}, afterJson: {},
      createdAt: NOW, createdBy: "demo-user", isDemo: true,
    });
    await repos.actionProposals.create({
      id: "prop-1", incidentId: "inc-1", kind: patch.kind, payloadJson: patch, state: "DRAFT",
      approver: null, simulated: true, createdAt: NOW,
    });
    await repos.auditEvents.create({ id: "audit-1", actor: "demo-user", action: "action.proposed", subjectId: "prop-1", detailsJson: {}, at: NOW });
    await repos.evidence.create({
      ...loadNorthstarFixture().evidence[0]!, id: "ev-user-added", sourceId: "user-added",
    });

    const r = await resetNorthstarDemo(db, { env: DEMO });
    expect(r.cleared).toMatchObject({ incidents: 1, simulations: 1, actionProposals: 1, auditEvents: 1, evidence: 50 });
    expectGoldenState(await snapshot());
  });

  it("refuses when demo mode is off and changes nothing", async () => {
    await seedNorthstarDemo(db, { env: DEMO });
    const before = await snapshot();
    for (const env of [{ DEMO_MODE: "false" }, {}, { DEMO_MODE: "1" }]) {
      await expect(resetNorthstarDemo(db, { env })).rejects.toBeInstanceOf(DemoModeRequiredError);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("is atomic: a failed reseed rolls back the clear", async () => {
    await seedNorthstarDemo(db, { env: DEMO });
    const before = await snapshot();
    const good = loadNorthstarFixture();
    const bad: DemoFixture = { ...good, edges: [...good.edges, { ...good.edges[0]!, id: "edge-duplicate" }] };
    await expect(resetNorthstarDemo(db, { env: DEMO, fixture: bad })).rejects.toBeInstanceOf(ConflictError);
    expect(await snapshot()).toEqual(before);
  });

  it("clearAllData requires the demo-reset gate even when writes are allowed", async () => {
    const adminOnly = createRepositories(db, {
      writeGate: () => undefined,
      demoResetGate: () => {
        throw new DemoModeRequiredError("Demo reset");
      },
    });
    await expect(adminOnly.demoReset.clearAllData()).rejects.toBeInstanceOf(DemoModeRequiredError);
  });
});

describe("CLI demo-mode default", () => {
  it("defaults only an unset DEMO_MODE, and only with the explicit flag", () => {
    const env1: Record<string, string | undefined> = {};
    expect(applyCliDemoDefault(["node", "seed.ts", "--default-demo-mode"], env1)).toBe("defaulted");
    expect(env1.DEMO_MODE).toBe("true");

    const env2: Record<string, string | undefined> = { DEMO_MODE: "false" };
    expect(applyCliDemoDefault(["node", "seed.ts", "--default-demo-mode"], env2)).toBe("inherited");
    expect(env2.DEMO_MODE).toBe("false");

    const env3: Record<string, string | undefined> = {};
    expect(applyCliDemoDefault(["node", "seed.ts"], env3)).toBe("inherited");
    expect(env3.DEMO_MODE).toBeUndefined();
  });

  it.each(["", "   "])("a blank DEMO_MODE (%j) is not defaulted, and reset then refuses without wiping", async (blank) => {
    await seedNorthstarDemo(db, { env: DEMO });
    const before = await snapshot();
    const env: Record<string, string | undefined> = { DEMO_MODE: blank };
    expect(applyCliDemoDefault(["node", "reset-demo.ts", "--default-demo-mode"], env)).toBe("inherited");
    expect(env.DEMO_MODE).toBe(blank);
    await expect(resetNorthstarDemo(db, { env })).rejects.toBeInstanceOf(DemoModeRequiredError);
    await expect(seedNorthstarDemo(db, { env })).rejects.toBeInstanceOf(DemoModeRequiredError);
    expect(await snapshot()).toEqual(before);
  });
});
