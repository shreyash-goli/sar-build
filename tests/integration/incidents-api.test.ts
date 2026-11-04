/** FS-13 backend: incident list/detail read path against a throwaway seeded SQLite DB. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDbClient, type PrismaClient } from "@/lib/db";
import { resetNorthstarDemo } from "@/lib/demo/northstar";
import { IncidentSnapshotUnreadableError, buildIncidentDetail, buildIncidentList } from "@/lib/incidents/load";
import { IncidentDetailSchema, IncidentListDataSchema, parseIncidentQuery } from "@/lib/incidents/schema";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { NotFoundError, type Repositories } from "@/lib/repositories";
import { ApiErrorSchema, apiSuccessSchema } from "@/lib/schema";
import { getIncident, listIncidents } from "@/app/api/_lib/incidents";

const ROOT = resolve(__dirname, "../..");
const DEMO = { DEMO_MODE: "true" } as const;
const NOW = "2026-11-17T16:00:00Z";
const HERO = "inc-charge-cloudcomms-20261119";
const DECLINE = "inc-tx-webhookworks-20261116";
const UNKNOWN = "inc-charge-metricsrelay-20261124";
const HEALTHY = "inc-charge-computeharbor-20261121";
const ListEnvelope = apiSuccessSchema(IncidentListDataSchema);
const DetailEnvelope = apiSuccessSchema(IncidentDetailSchema);

let dir: string;
let url: string;
let db: PrismaClient;
let repos: Repositories;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-incidents-api-test-"));
  url = `file:${join(dir, "incidents-api.db")}`;
  execFileSync(join(ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  db = createDbClient(url);
  await resetNorthstarDemo(db, { env: DEMO });
  repos = createReadOnlyRepositories(db);
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("incident list", () => {
  it("lists all incidents ranked by severity with FORECAST vs OBSERVED_DECLINE signals", async () => {
    const d = IncidentListDataSchema.parse(await buildIncidentList(repos));
    expect(d.total).toBe(4);
    expect(d.unreadableIncidentIds).toEqual([]);
    expect(d.incidents.map((i) => [i.id, i.signal, i.severity, i.amountCents])).toEqual([
      [HERO, "FORECAST", "CRITICAL", 45000],
      [DECLINE, "OBSERVED_DECLINE", "HIGH", 29900],
      [UNKNOWN, "FORECAST", "UNKNOWN", null],
      [HEALTHY, "FORECAST", "LOW", null],
    ]);
    expect(d.incidents[0]).toMatchObject({
      vendorName: "CloudComms",
      dueInDays: 2,
      at: "2026-11-19T16:00:00Z",
      topWorkflow: { nodeId: "node-workflow-account-login", label: "Account login", criticality: "CRITICAL", owner: "Identity Platform" },
      confirmedPathCount: 2,
      sourceClasses: ["DEMO_FIXTURE"],
    });
  });

  it("filters by severity, status, category, signal and search; sorts", async () => {
    const ids = async (q: Parameters<typeof buildIncidentList>[1]) => (await buildIncidentList(repos, q)).incidents.map((i) => i.id);
    expect(await ids({ severity: "CRITICAL" })).toEqual([HERO]);
    expect(await ids({ status: "MONITORING" })).toEqual([HEALTHY]);
    expect(await ids({ category: "UNKNOWN_DATA" })).toEqual([UNKNOWN]);
    expect(await ids({ signal: "OBSERVED_DECLINE" })).toEqual([DECLINE]);
    expect(await ids({ q: "cloudcomms" })).toEqual([HERO]);
    expect(await ids({ q: "funding shortfall" })).toEqual([HERO]);
    expect(await ids({ q: "shortfall" })).toEqual([HERO, HEALTHY]);
    expect(await ids({ q: "nothing-matches" })).toEqual([]);
    expect(await ids({ sort: "due" })).toEqual([HERO, HEALTHY, UNKNOWN, DECLINE]);
  });

  it("parseIncidentQuery validates search params", () => {
    expect(parseIncidentQuery({ severity: "HIGH", q: "", sort: undefined })).toEqual({ ok: true, query: { severity: "HIGH" } });
    expect(parseIncidentQuery({ severity: "SEVERE" }).ok).toBe(false);
    expect(parseIncidentQuery({ foo: "bar" }).ok).toBe(false);
    expect(parseIncidentQuery({ status: ["OPEN", "RESOLVED"] }).ok).toBe(false);
  });
});

describe("incident detail (FS-13 done-when: reconstruct the $450)", () => {
  it("hero: calculation steps, exact chains, owners, evidence and caveats", async () => {
    const d = IncidentDetailSchema.parse(await buildIncidentDetail(repos, HERO));
    expect(d.calculation).toMatchObject({
      kind: "SHORTFALL",
      expectedCents: 245000,
      availableCents: 200000,
      committedBeforeCents: 0,
      effectiveAvailableCents: 200000,
      shortfallCents: 45000,
      marginCents: 0,
      dueInDays: 2,
      periodKeyUtc: "2026-11",
    });
    expect(d.calculation.kind === "SHORTFALL" && d.calculation.steps).toEqual([
      "Expected charge: $2,450.00 (charge-cloudcomms-20261119, due 2026-11-19)",
      "Available allocation: $2,000.00 (fund-auth, period 2026-11)",
      "Projected shortfall = max(0, $2,450.00 − $2,000.00) = $450.00",
      "Modeled margin after the charge: $0.00",
      "Due in 2 day(s): whole 24-hour periods from the evaluation time",
    ]);
    expect(d.confirmedChains).toHaveLength(2);
    expect(d.confirmedChains[1]!.nodes.map((n) => n.label)).toEqual([
      "Auth Infrastructure fund",
      "Auth virtual card",
      "CloudComms",
      "OTP gateway",
      "Account login",
      "Customer checkout",
    ]);
    expect(d.confirmedChains[1]!.edges.at(-1)).toMatchObject({ relation: "AFFECTS", dependencyStrength: "DEGRADED", reviewStatus: "CONFIRMED" });
    expect(d.possibleImpacts).toEqual([]);
    expect(d.impactComplete).toBe(true);
    expect(d.owners).toEqual([{ nodeId: "node-workflow-account-login", label: "Account login", criticality: "CRITICAL", owner: "Identity Platform" }]);
    expect(d.evidence.map((e) => e.id)).toContain("ev-charge-cloudcomms-20261119");
    for (const e of d.evidence) expect(e).toMatchObject({ classification: "DEMO_FIXTURE", badge: { label: "DEMO DATA" } });
    expect(d.missingEvidenceIds).toEqual([]);
    expect(d.ruleEvidenceId).toMatch(/^ev-rule-charge-cloudcomms-20261119-/);
    expect(d.caveats.join(" ")).toMatch(/whether the vendor would suspend service is unknown/);
    expect(d.evaluation.assertion.amountCents).toBe(45000);
  });

  it("hero timeline: availability observed, detected, then the projected charge date", async () => {
    const d = await buildIncidentDetail(repos, HERO);
    expect(d.timeline.map((t) => [t.at, t.kind, t.projected])).toEqual([
      ["2026-11-17T15:45:00Z", "AVAILABILITY_OBSERVED", false],
      [NOW, "FIRST_DETECTED", false],
      ["2026-11-19T16:00:00Z", "CHARGE_DUE", true],
    ]);
    expect(d.timeline[0]!.label).toBe('Available allocation of "Auth Infrastructure" observed: $2,000.00');
  });

  it("decline detail is an observed transaction decline, not an outage", async () => {
    const d = await buildIncidentDetail(repos, DECLINE);
    expect(d.signal).toBe("OBSERVED_DECLINE");
    expect(d.calculation).toEqual({ kind: "DECLINE", amountCents: 29900, occurredAt: "2026-11-16T09:12:00Z", reason: "SPEND_LIMIT", transactionId: "tx-webhookworks-20261116" });
    expect(d.caveats[0]).toBe("Observed transaction decline; vendor service impact unconfirmed. This is not a confirmed outage.");
    expect(d.timeline.map((t) => t.kind)).toEqual(["TRANSACTION_DECLINED", "FIRST_DETECTED"]);
  });

  it("unknown detail keeps known inputs and nulls (never $0)", async () => {
    const d = await buildIncidentDetail(repos, UNKNOWN);
    expect(d.calculation).toMatchObject({ kind: "UNKNOWN", expectedCents: 36000, availableCents: null, dueInDays: 7 });
    expect(d.calculation.kind === "UNKNOWN" && d.calculation.requestedMappings).toHaveLength(2);
    expect(d.amountCents).toBeNull();
  });

  it("missing graph records render as Unknown, not dropped", async () => {
    const fake = { ...repos, nodes: { ...repos.nodes, list: async () => (await repos.nodes.list()).filter((n) => n.id !== "node-service-otp-gateway") } } as Repositories;
    const d = await buildIncidentDetail(fake, HERO);
    expect(d.confirmedChains[0]!.nodes.find((n) => n.id === "node-service-otp-gateway")).toEqual({
      id: "node-service-otp-gateway",
      label: "Unknown (node-service-otp-gateway)",
      kind: null,
      criticality: null,
      owner: null,
    });
  });

  it("availability time and amount both come from the evaluation snapshot", async () => {
    const hero = await repos.incidents.getById(HERO);
    expect((hero.snapshotJson as { projection: { availabilityObservedAt: string } }).projection.availabilityObservedAt).toBe(
      "2026-11-17T15:45:00Z",
    );
    // A later change to the live fund row must not move the timeline's observation time.
    const fake = {
      ...repos,
      fundingSources: {
        ...repos.fundingSources,
        findById: async (id: string) => {
          const f = await repos.fundingSources.findById(id);
          return f && { ...f, observedAt: "2026-11-17T15:59:00Z", availableCents: 999999 };
        },
      },
    } as Repositories;
    const d = await buildIncidentDetail(fake, HERO);
    expect(d.timeline[0]).toEqual({
      at: "2026-11-17T15:45:00Z",
      kind: "AVAILABILITY_OBSERVED",
      label: 'Available allocation of "Auth Infrastructure" observed: $2,000.00',
      projected: false,
    });
  });

  it("an unreadable snapshot is a 500 INCIDENT_SNAPSHOT_UNREADABLE, not a 404", async () => {
    const fake = {
      ...repos,
      incidents: {
        ...repos.incidents,
        getById: async (id: string) => ({ ...(await repos.incidents.getById(id)), snapshotJson: { bogus: true } }),
      },
    } as Repositories;
    await expect(buildIncidentDetail(fake, HERO)).rejects.toBeInstanceOf(IncidentSnapshotUnreadableError);
    const res = await getIncident(HERO, { repos: fake, env: DEMO });
    expect(res.status).toBe(500);
    expect(ApiErrorSchema.parse(await res.json()).error).toEqual({
      code: "INTERNAL_ERROR",
      message: "Incident exists but its snapshot could not be read",
      details: { reason: "INCIDENT_SNAPSHOT_UNREADABLE", incidentId: HERO },
    });
  });

  it("FS-16: each golden incident carries a specific runbook with a next owner", async () => {
    const hero = await buildIncidentDetail(repos, HERO);
    expect(hero.runbook).toMatchObject({ ruleId: "runbook-v1", nextOwner: { role: "FINANCE", name: "Finance Ops" } });
    expect(hero.runbook.steps.map((s) => s.kind)).toEqual([
      "CONTACT_FUND_OWNER",
      "REQUEST_LIMIT_REVIEW",
      "VERIFY_ALTERNATE_PAYMENT",
      "CONTACT_SERVICE_OWNER",
      "MONITOR_VENDOR",
    ]);
    expect(hero.runbook.steps[0]!.title).toBe("Confirm current availability on Auth Infrastructure");
    expect(hero.runbook.steps[3]!.owner).toEqual({ role: "SERVICE_OWNER", name: "Identity Platform" });

    const decline = await buildIncidentDetail(repos, DECLINE);
    expect(decline.runbook.steps.map((s) => s.kind)[0]).toBe("CONTACT_FUND_OWNER");
    expect(decline.runbook.steps.find((s) => s.kind === "CONTACT_SERVICE_OWNER")!.owner.name).toBe("SRE");

    const unknown = await buildIncidentDetail(repos, UNKNOWN);
    expect(unknown.runbook.steps.map((s) => s.kind)).toEqual(["CONFIRM_BILLING_METHOD", "MAP_FUNDING_SOURCE", "CONTACT_SERVICE_OWNER", "MONITOR_VENDOR"]);
    expect(unknown.runbook.steps[2]!.detail).toMatch(/Weekly growth reporting/);

    expect((await buildIncidentDetail(repos, HEALTHY)).runbook.steps.map((s) => s.kind)).toEqual(["MONITOR_VENDOR"]);
  });

  it("unknown id is NotFound", async () => {
    await expect(buildIncidentDetail(repos, "inc-nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("GET /api/incidents[/id]", () => {
  const ctx = () => ({ repos, env: DEMO });

  it("list and detail envelopes", async () => {
    const list = await listIncidents(new Request("http://localhost/api/incidents?severity=CRITICAL"), ctx());
    expect(list.status).toBe(200);
    const lb = ListEnvelope.parse(await list.json());
    expect(lb.data.incidents.map((i) => i.id)).toEqual([HERO]);
    expect(lb.meta).toEqual({ workspaceMode: "DEMO", generatedAt: NOW, evaluatedAt: NOW });

    const det = await getIncident(HERO, ctx());
    expect(DetailEnvelope.parse(await det.json()).data.calculation.kind).toBe("SHORTFALL");
  });

  it("400 for bad queries, 404 for unknown ids, 503 for bad clock, generic 500", async () => {
    for (const q of ["severity=SEVERE", "foo=bar", "status=OPEN&status=RESOLVED"]) {
      const res = await listIncidents(new Request(`http://localhost/api/incidents?${q}`), ctx());
      expect(res.status, q).toBe(400);
    }
    const miss = await getIncident("inc-nope", ctx());
    expect(miss.status).toBe(404);
    expect(ApiErrorSchema.parse(await miss.json()).error.code).toBe("NOT_FOUND");
    expect((await getIncident("  ", ctx())).status).toBe(400);
    expect((await getIncident(HERO, { repos, env: { DEMO_MODE: "true", DEMO_NOW: "bogus" } })).status).toBe(503);

    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = { ...repos, incidents: { ...repos.incidents, list: () => Promise.reject(new Error("secret")) } } as Repositories;
    const res = await listIncidents(new Request("http://localhost/api/incidents"), { repos: broken, env: DEMO });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/secret/);
    spy.mockRestore();
  });

  it("route modules and loadIncidents/loadIncident read the app DB", async () => {
    const g = globalThis as unknown as { __failsafeDb?: PrismaClient };
    const prevUrl = process.env.DATABASE_URL;
    const prevDb = g.__failsafeDb;
    process.env.DATABASE_URL = url;
    g.__failsafeDb = undefined;
    try {
      const list = await import("@/app/api/incidents/route");
      const detail = await import("@/app/api/incidents/[id]/route");
      expect(ListEnvelope.parse(await (await list.GET(new Request("http://localhost/api/incidents"))).json()).data.total).toBe(4);
      const hit = await detail.GET(new Request(`http://localhost/api/incidents/${HERO}`), { params: Promise.resolve({ id: HERO }) });
      expect(hit.status).toBe(200);
      const miss = await detail.GET(new Request("http://localhost/api/incidents/x"), { params: Promise.resolve({ id: "x" }) });
      expect(miss.status).toBe(404);
      const { loadIncidents, loadIncident } = await import("@/lib/incidents/load");
      expect((await loadIncidents({ signal: "OBSERVED_DECLINE" })).incidents.map((i) => i.id)).toEqual([DECLINE]);
      expect((await loadIncident(HERO))?.calculation.kind).toBe("SHORTFALL");
      expect(await loadIncident("inc-nope")).toBeNull();
    } finally {
      const created = (globalThis as unknown as { __failsafeDb?: PrismaClient }).__failsafeDb;
      await created?.$disconnect();
      g.__failsafeDb = prevDb;
      if (prevUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevUrl;
    }
  });
});
