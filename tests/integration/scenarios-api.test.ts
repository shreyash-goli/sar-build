/** FS-14 backend: POST /api/scenarios/run + GET /api/scenarios against a throwaway seeded SQLite DB. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, type PrismaClient } from "@/lib/db";
import { resetNorthstarDemo } from "@/lib/demo/northstar";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import type { Repositories } from "@/lib/repositories";
import { ApiErrorSchema, apiSuccessSchema } from "@/lib/schema";
import { ScenarioListDataSchema, ScenarioRunDataSchema } from "@/lib/simulations/schema";
import { listScenarios, runScenario } from "@/app/api/_lib/scenarios";

const ROOT = resolve(__dirname, "../..");
const DEMO = { DEMO_MODE: "true" } as const;
const NOW = "2026-11-17T16:00:00Z";
const HERO = "inc-charge-cloudcomms-20261119";
const RunEnvelope = apiSuccessSchema(ScenarioRunDataSchema);
const ListEnvelope = apiSuccessSchema(ScenarioListDataSchema);
const plus600 = { kind: "INCREASE_AVAILABLE_ALLOCATION", fundingSourceId: "fund-auth", amountCents: 60000 };

let dir: string;
let url: string;
let db: PrismaClient;
let repos: Repositories;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-scenarios-test-"));
  url = `file:${join(dir, "scenarios.db")}`;
  execFileSync(join(ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  db = createDbClient(url);
  repos = createReadOnlyRepositories(db);
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetNorthstarDemo(db, { env: DEMO });
});

const post = (body: unknown, env: Record<string, string | undefined> = DEMO) =>
  runScenario(
    new Request("http://localhost/api/scenarios/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { db, env },
  );
const list = (qs = "", env: Record<string, string | undefined> = DEMO) =>
  listScenarios(new Request(`http://localhost/api/scenarios${qs}`), { db, env });

/** Every table except the two a simulation may append to. */
async function baseSnapshot() {
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
    actionProposals: await repos.actionProposals.list(),
  };
}

describe("POST /api/scenarios/run", () => {
  it("T-02: +$600 returns a SIMULATION ONLY result with the modeled numbers", async () => {
    const res = await post({ incidentId: HERO, patch: plus600 });
    expect(res.status).toBe(201);
    const { data, meta } = RunEnvelope.parse(await res.json());
    expect(meta).toMatchObject({ workspaceMode: "DEMO", generatedAt: NOW });
    expect(data.simulation).toMatchObject({ incidentId: HERO, isDemo: true, label: "SIMULATION ONLY", createdAt: NOW, createdBy: "demo-user", patch: plus600 });
    const r = data.simulation.result;
    expect(r.focus.before).toMatchObject({ severity: "CRITICAL", availableCents: 200000, shortfallCents: 45000 });
    expect(r.focus.after).toMatchObject({ category: "NO_RISK", severity: "LOW", availableCents: 260000, shortfallCents: 0, marginCents: 15000 });
    expect(r.assumptions).toContain("Modeled change; no Ramp funds or card limits were changed");
  });

  it("T-03: base records are untouched; only one Simulation and one AuditEvent are appended", async () => {
    const before = await baseSnapshot();
    const simsBefore = await repos.simulations.list();
    const auditBefore = await repos.auditEvents.list();
    const res = await post({ incidentId: HERO, patch: plus600 });
    const { data } = RunEnvelope.parse(await res.json());
    expect(await baseSnapshot()).toEqual(before);
    expect((await repos.fundingSources.getById("fund-auth")).availableCents).toBe(200000);

    const sims = await repos.simulations.list();
    expect(sims).toHaveLength(simsBefore.length + 1);
    const stored = await repos.simulations.getById(data.simulation.id);
    expect(stored).toMatchObject({ incidentId: HERO, isDemo: true, createdBy: "demo-user", patchJson: plus600 });
    expect(stored.afterJson).toEqual(data.simulation.result);

    const audits = await repos.auditEvents.list();
    expect(audits).toHaveLength(auditBefore.length + 1);
    const audit = await repos.auditEvents.getById(data.auditEventId);
    expect(audit).toMatchObject({ actor: "demo-user", action: "simulation.run", subjectId: HERO, at: NOW });
    expect(audit.detailsJson).toMatchObject({
      label: "SIMULATION ONLY",
      simulationId: data.simulation.id,
      focus: { severityBefore: "CRITICAL", severityAfter: "LOW" },
    });
  });

  it("re-running the same patch appends a new record and audit event (no dedupe, by design)", async () => {
    const a = RunEnvelope.parse(await (await post({ incidentId: HERO, patch: plus600 })).json()).data;
    const b = RunEnvelope.parse(await (await post({ incidentId: HERO, patch: plus600 })).json()).data;
    expect(a.simulation.id).not.toBe(b.simulation.id);
    expect(a.auditEventId).not.toBe(b.auditEventId);
    expect(b.simulation.result).toEqual(a.simulation.result);
    expect(await repos.simulations.listByIncident(HERO)).toHaveLength(2);
    expect((await repos.auditEvents.listBySubject(HERO)).filter((e) => e.action === "simulation.run")).toHaveLength(2);
  });

  it("400 for malformed or invalid requests; nothing is written", async () => {
    const cases: unknown[] = [
      "{not json",
      {},
      { incidentId: HERO },
      { incidentId: HERO, patch: { ...plus600, amountCents: -1 } },
      { incidentId: HERO, patch: { ...plus600, amountCents: 0 } },
      { incidentId: HERO, patch: { ...plus600, amountCents: 600.5 } },
      { incidentId: HERO, patch: { ...plus600, riskScore: 0 } },
      { incidentId: HERO, patch: plus600, severity: "LOW" },
      { incidentId: HERO, patch: { kind: "MOVE_MONEY", fundingSourceId: "fund-auth" } },
    ];
    for (const body of cases) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("BAD_REQUEST");
    }
    expect(await repos.simulations.list()).toEqual([]);
  });

  it("400 with details for infeasible patches; 404 for unknown incidents or targets", async () => {
    const same = await post({ incidentId: HERO, patch: { kind: "ASSIGN_ALTERNATE_FUND", vendorChargeId: "charge-cloudcomms-20261119", fundingSourceId: "fund-auth" } });
    expect(same.status).toBe(400);
    expect(ApiErrorSchema.parse(await same.json()).error.details).toMatchObject({ field: "patch.fundingSourceId" });
    const confirmedEdge = await post({ incidentId: HERO, patch: { kind: "MARK_DEPENDENCY_VERIFIED", edgeId: "edge-fund-auth--card-auth" } });
    expect(confirmedEdge.status).toBe(400);

    const noIncident = await post({ incidentId: "inc-nope", patch: plus600 });
    expect(noIncident.status).toBe(404);
    const noFund = await post({ incidentId: HERO, patch: { ...plus600, fundingSourceId: "fund-nope" } });
    expect(noFund.status).toBe(404);
    expect(ApiErrorSchema.parse(await noFund.json()).error).toMatchObject({ code: "NOT_FOUND", details: { field: "patch.fundingSourceId" } });
    expect(await repos.simulations.list()).toEqual([]);
    expect(await repos.auditEvents.list()).toEqual([]);
  });

  it("403 outside demo mode; 503 for an invalid demo clock; nothing is written", async () => {
    const off = await post({ incidentId: HERO, patch: plus600 }, { DEMO_MODE: "false" });
    expect(off.status).toBe(403);
    expect(ApiErrorSchema.parse(await off.json()).error.code).toBe("FORBIDDEN");
    const bad = await post({ incidentId: HERO, patch: plus600 }, { DEMO_MODE: "true", DEMO_NOW: "bogus" });
    expect(bad.status).toBe(503);
    expect(await repos.simulations.list()).toEqual([]);
  });

  it("demo reset clears simulations (incident cascade) and their audit events", async () => {
    await post({ incidentId: HERO, patch: plus600 });
    await resetNorthstarDemo(db, { env: DEMO });
    expect(await repos.simulations.list()).toEqual([]);
    expect(await repos.auditEvents.list()).toEqual([]);
  });
});

describe("GET /api/scenarios", () => {
  it("lists simulations newest first, optionally per incident", async () => {
    await post({ incidentId: HERO, patch: plus600 });
    await post({ incidentId: HERO, patch: { ...plus600, amountCents: 40000 } });
    const res = await list(`?incidentId=${HERO}`);
    expect(res.status).toBe(200);
    const body = ListEnvelope.parse(await res.json());
    expect(body.data.simulations).toHaveLength(2);
    expect(body.data.unreadableSimulationIds).toEqual([]);
    for (const s of body.data.simulations) expect(s.label).toBe("SIMULATION ONLY");
    expect(ListEnvelope.parse(await (await list()).json()).data.simulations).toHaveLength(2);
    expect(ListEnvelope.parse(await (await list("?incidentId=inc-tx-webhookworks-20261116")).json()).data.simulations).toEqual([]);
  });

  it("400 for bad params, 404 for unknown incidents", async () => {
    expect((await list("?foo=bar")).status).toBe(400);
    expect((await list(`?incidentId=${HERO}&incidentId=${HERO}`)).status).toBe(400);
    expect((await list("?incidentId=inc-nope")).status).toBe(404);
  });
});

describe("Next route modules", () => {
  it("POST /api/scenarios/run and GET /api/scenarios use getDb()", async () => {
    const g = globalThis as unknown as { __failsafeDb?: PrismaClient };
    const prev = { url: process.env.DATABASE_URL, demo: process.env.DEMO_MODE, now: process.env.DEMO_NOW, db: g.__failsafeDb };
    process.env.DATABASE_URL = url;
    process.env.DEMO_MODE = "true";
    delete process.env.DEMO_NOW;
    g.__failsafeDb = undefined;
    try {
      const runRoute = await import("@/app/api/scenarios/run/route");
      const listRoute = await import("@/app/api/scenarios/route");
      const res = await runRoute.POST(
        new Request("http://localhost/api/scenarios/run", { method: "POST", body: JSON.stringify({ incidentId: HERO, patch: plus600 }) }),
      );
      expect(res.status).toBe(201);
      const listed = await listRoute.GET(new Request(`http://localhost/api/scenarios?incidentId=${HERO}`));
      expect(ListEnvelope.parse(await listed.json()).data.simulations).toHaveLength(1);
    } finally {
      const created = (globalThis as unknown as { __failsafeDb?: PrismaClient }).__failsafeDb;
      await created?.$disconnect();
      g.__failsafeDb = prev.db;
      for (const [k, v] of [["DATABASE_URL", prev.url], ["DEMO_MODE", prev.demo], ["DEMO_NOW", prev.now]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
