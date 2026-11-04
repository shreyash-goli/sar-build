/** FS-11 incident builder against a throwaway seeded SQLite DB (seed runs the risk engine). */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, type PrismaClient } from "@/lib/db";
import { resetNorthstarDemo } from "@/lib/demo/northstar";
import { materializeIncidents, nextIncidentStatus, type IncidentSnapshot } from "@/lib/incidents";
import { createRepositories, type Repositories } from "@/lib/repositories";
import { RiskEvaluationSchema, type Incident } from "@/lib/schema";
import { WriteForbiddenError, assertWritesAllowed } from "@/lib/security/write-gate";

const ROOT = resolve(__dirname, "../..");
const DEMO = { DEMO_MODE: "true" } as const;
const NOW = new Date("2026-11-17T16:00:00Z");
const HERO = "inc-charge-cloudcomms-20261119";
const DECLINE = "inc-tx-webhookworks-20261116";
const HEALTHY = "inc-charge-computeharbor-20261121";
const UNKNOWN = "inc-charge-metricsrelay-20261124";

let dir: string;
let db: PrismaClient;
let repos: Repositories;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-incidents-test-"));
  const url = `file:${join(dir, "incidents.db")}`;
  execFileSync(join(ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  db = createDbClient(url);
  repos = createRepositories(db, { writeGate: () => assertWritesAllowed({ env: DEMO }), demoResetGate: () => undefined });
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// Every test starts from a fresh reset (fixture + engine-generated incidents).
beforeEach(async () => {
  await resetNorthstarDemo(db, { env: DEMO });
});

const snap = (i: Incident) => i.snapshotJson as unknown as IncidentSnapshot;
const counts = async () => ({ incidents: (await repos.incidents.list()).length, evidence: (await repos.evidence.list()).length });

describe("materialized incidents", () => {
  it("reset produces the four golden incidents with stable IDs and keys", async () => {
    const incidents = await repos.incidents.list();
    expect(incidents.map((i) => [i.id, i.scenarioKey, i.severity, i.status, i.detectionRule])).toEqual([
      [HERO, "charge:charge-cloudcomms-20261119", "CRITICAL", "OPEN", "projected-shortfall-v1"],
      [HEALTHY, "charge:charge-computeharbor-20261121", "LOW", "MONITORING", "projected-shortfall-v1"],
      [UNKNOWN, "charge:charge-metricsrelay-20261124", "UNKNOWN", "OPEN", "projected-shortfall-v1"],
      [DECLINE, "transaction:tx-webhookworks-20261116", "HIGH", "OPEN", "observed-decline-v1"],
    ]);
    for (const i of incidents) {
      expect(i.firstSeenAt).toBe("2026-11-17T16:00:00Z");
      const s = snap(i);
      expect(s.version).toBe(1);
      expect(s).toMatchObject({ previousSeverity: null, escalated: false });
      expect(RiskEvaluationSchema.safeParse(s.evaluation).success).toBe(true);
      expect(s.missingEvidenceIds).toEqual([]);
      expect(s.evidenceSnapshot.map((e) => `evidence:${e.id}`).sort()).toEqual([...s.evaluation.assertion.inputs].sort());
      const ev = await repos.evidence.getById(i.evidenceId);
      expect(ev).toMatchObject({ kind: "RULE", classification: "DERIVED", sourceSystem: "failsafe-risk-engine", contentHash: s.fingerprint });
    }
  });

  it("hero incident: $450 CRITICAL with the exact login and checkout paths", async () => {
    const hero = await repos.incidents.getById(HERO);
    expect(hero).toMatchObject({ title: "Projected $450.00 funding shortfall for CloudComms", primaryVendorId: "vendor-cloudcomms" });
    const s = snap(hero);
    expect(s.evaluation).toMatchObject({ category: "PROJECTED_SHORTFALL", severity: "CRITICAL", confidence: "HIGH" });
    expect(s.evaluation.assertion.amountCents).toBe(45000);
    expect(s.impact.confirmedPathIds).toHaveLength(2);
    expect(s.impact.confirmedPathIds[0]).toMatch(/edge-service-otp-gateway--workflow-account-login$/);
    expect(s.impact.confirmedPathIds[1]).toMatch(/edge-workflow-account-login--outcome-customer-checkout$/);
    expect(s.projection).toMatchObject({ status: "SCORED", expectedCents: 245000, availableCents: 200000, shortfallCents: 45000, dueInDays: 2 });
  });

  it("T-06: the WebhookWorks decline is its own OBSERVED_DECLINE incident, not an outage", async () => {
    const d = await repos.incidents.getById(DECLINE);
    expect(d.title).toBe("Observed transaction decline: WebhookWorks $299.00");
    expect(snap(d).evaluation).toMatchObject({ category: "OBSERVED_DECLINE", severity: "HIGH", confidence: "MEDIUM" });
    expect(snap(d).evaluation.assertion.limitations[0]).toMatch(/vendor service impact unconfirmed/);
    expect(snap(d).transaction?.id).toBe("tx-webhookworks-20261116");
  });
});

describe("T-13: reruns never duplicate", () => {
  it("an unchanged rerun writes nothing", async () => {
    const before = await counts();
    const incidentsBefore = await repos.incidents.list();
    const r = await materializeIncidents(repos, NOW);
    expect(r).toMatchObject({ findings: 4, created: [], updated: [], resolved: [], ruleEvidenceCreated: [] });
    expect(r.unchanged).toHaveLength(4);
    expect(await counts()).toEqual(before);
    expect(await repos.incidents.list()).toEqual(incidentsBefore);
  });

  it("a later evaluation updates in place and appends (never rewrites) rule evidence", async () => {
    const heroBefore = await repos.incidents.getById(HERO);
    const later = new Date("2026-11-18T04:00:00Z"); // dueInDays 2 -> 1
    const r = await materializeIncidents(repos, later);
    expect(r.created).toEqual([]);
    expect(r.updated).toContain(HERO);
    expect((await repos.incidents.list()).length).toBe(4);
    const hero = await repos.incidents.getById(HERO);
    expect(hero.firstSeenAt).toBe(heroBefore.firstSeenAt);
    expect(hero.updatedAt).toBe("2026-11-18T04:00:00Z");
    expect(hero.evidenceId).not.toBe(heroBefore.evidenceId);
    expect(await repos.evidence.findById(heroBefore.evidenceId)).not.toBeNull(); // old evaluation kept
    expect(snap(hero).evaluation.reasons[0]!.daysUntil).toBe(1);
    // Running the later evaluation again is a no-op.
    const again = await materializeIncidents(repos, later);
    expect(again).toMatchObject({ created: [], updated: [], ruleEvidenceCreated: [] });
  });

  it("two resets yield identical incidents and rule evidence IDs", async () => {
    const a = await repos.incidents.list();
    await resetNorthstarDemo(db, { env: DEMO });
    expect(await repos.incidents.list()).toEqual(a);
  });
});

describe("status transitions", () => {
  it("resolves when the risk clears, and reopens when it returns", async () => {
    await repos.fundingSources.update("fund-auth", { availableCents: 260000 });
    await materializeIncidents(repos, NOW);
    const cleared = await repos.incidents.getById(HERO);
    expect(cleared).toMatchObject({ severity: "LOW", status: "RESOLVED" });
    expect(snap(cleared).evaluation.category).toBe("NO_RISK");

    await repos.fundingSources.update("fund-auth", { availableCents: 200000 });
    await materializeIncidents(repos, NOW);
    expect(await repos.incidents.getById(HERO)).toMatchObject({ severity: "CRITICAL", status: "OPEN" });
    expect((await repos.incidents.list()).length).toBe(4);
  });

  it("keeps a human ACKNOWLEDGED status while the risk persists", async () => {
    await repos.incidents.update(HERO, { status: "ACKNOWLEDGED" });
    const r = await materializeIncidents(repos, NOW);
    expect(r.unchanged).toContain(HERO);
    expect((await repos.incidents.getById(HERO)).status).toBe("ACKNOWLEDGED");
  });

  it("re-opens an ACKNOWLEDGED incident when severity escalates, recording previousSeverity", async () => {
    // Step 1: lower login to HIGH -> hero becomes HIGH (still OPEN).
    await repos.nodes.update("node-workflow-account-login", { criticality: "HIGH" });
    await materializeIncidents(repos, NOW);
    expect(await repos.incidents.getById(HERO)).toMatchObject({ severity: "HIGH", status: "OPEN" });
    expect(snap(await repos.incidents.getById(HERO))).toMatchObject({ previousSeverity: "CRITICAL", escalated: false });

    // Step 2: a human acknowledges; de-escalation would keep the ack, escalation re-opens.
    await repos.incidents.update(HERO, { status: "ACKNOWLEDGED" });
    await repos.nodes.update("node-workflow-account-login", { criticality: "CRITICAL" });
    const r = await materializeIncidents(repos, NOW);
    expect(r.updated).toContain(HERO);
    const hero = await repos.incidents.getById(HERO);
    expect(hero).toMatchObject({ severity: "CRITICAL", status: "OPEN" });
    expect(snap(hero)).toMatchObject({ previousSeverity: "HIGH", escalated: true });

    // An unchanged rerun keeps the recorded escalation and writes nothing.
    const again = await materializeIncidents(repos, NOW);
    expect(again.unchanged).toContain(HERO);
    expect(snap(await repos.incidents.getById(HERO))).toMatchObject({ previousSeverity: "HIGH", escalated: true });
  });

  it("keeps ACKNOWLEDGED when severity de-escalates while still risky", async () => {
    await repos.incidents.update(HERO, { status: "ACKNOWLEDGED" });
    await repos.nodes.update("node-workflow-account-login", { criticality: "HIGH" });
    await materializeIncidents(repos, NOW);
    const hero = await repos.incidents.getById(HERO);
    expect(hero).toMatchObject({ severity: "HIGH", status: "ACKNOWLEDGED" });
    expect(snap(hero)).toMatchObject({ previousSeverity: "CRITICAL", escalated: false });
  });

  it("resolves incidents whose subject is no longer evaluated", async () => {
    await repos.vendorCharges.update("charge-metricsrelay-20261124", { status: "CANCELLED" });
    const r = await materializeIncidents(repos, NOW);
    expect(r.resolved).toEqual([UNKNOWN]);
    const inc = await repos.incidents.getById(UNKNOWN);
    expect(inc.status).toBe("RESOLVED");
    expect(snap(inc).resolution).toBe("SUBJECT_NO_LONGER_EVALUATED");
    expect((await materializeIncidents(repos, NOW)).resolved).toEqual([]);
  });

  it("transition table", () => {
    expect(nextIncidentStatus(null, "CRITICAL")).toBe("OPEN");
    expect(nextIncidentStatus(null, "UNKNOWN")).toBe("OPEN");
    expect(nextIncidentStatus(null, "LOW")).toBe("MONITORING");
    expect(nextIncidentStatus("OPEN", "LOW")).toBe("RESOLVED");
    expect(nextIncidentStatus("ACKNOWLEDGED", "HIGH")).toBe("ACKNOWLEDGED");
    expect(nextIncidentStatus("ACKNOWLEDGED", "CRITICAL", "HIGH")).toBe("OPEN");
    expect(nextIncidentStatus("ACKNOWLEDGED", "HIGH", "CRITICAL")).toBe("ACKNOWLEDGED");
    expect(nextIncidentStatus("ACKNOWLEDGED", "MEDIUM", "UNKNOWN")).toBe("OPEN");
    expect(nextIncidentStatus("ACKNOWLEDGED", "HIGH", "HIGH")).toBe("ACKNOWLEDGED");
    expect(nextIncidentStatus("ACKNOWLEDGED", "LOW")).toBe("RESOLVED");
    expect(nextIncidentStatus("MONITORING", "MEDIUM")).toBe("OPEN");
    expect(nextIncidentStatus("MONITORING", "LOW")).toBe("MONITORING");
    expect(nextIncidentStatus("RESOLVED", "HIGH")).toBe("OPEN");
    expect(nextIncidentStatus("RESOLVED", "LOW")).toBe("RESOLVED");
  });
});

describe("write protection", () => {
  it("a denying write gate blocks materialization and nothing is written", async () => {
    await repos.fundingSources.update("fund-auth", { availableCents: 260000 });
    const before = await counts();
    const heroBefore = await repos.incidents.getById(HERO);
    const locked = createRepositories(db, { writeGate: () => assertWritesAllowed({ env: { DEMO_MODE: "false" } }) });
    await expect(materializeIncidents(locked, NOW)).rejects.toBeInstanceOf(WriteForbiddenError);
    expect(await counts()).toEqual(before);
    expect(await repos.incidents.getById(HERO)).toEqual(heroBefore);
  });
});
