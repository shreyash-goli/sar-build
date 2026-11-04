/** FS-12 backend: Overview metrics from engine results, against a throwaway SQLite DB. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbClient, type PrismaClient } from "@/lib/db";
import { DashboardDataSchema } from "@/lib/dashboard/schema";
import { buildDashboardData } from "@/lib/dashboard/load";
import { resetNorthstarDemo } from "@/lib/demo/northstar";
import { loadNorthstarFixture, type DemoFixture } from "@/fixtures/northstar";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import type { Repositories } from "@/lib/repositories";
import { ApiErrorSchema, apiSuccessSchema } from "@/lib/schema";
import { getDashboard } from "@/app/api/_lib/dashboard";

const ROOT = resolve(__dirname, "../..");
const DEMO = { DEMO_MODE: "true" } as const;
const NOW = "2026-11-17T16:00:00Z";
const Envelope = apiSuccessSchema(DashboardDataSchema);

let dir: string;
let url: string;
let db: PrismaClient;
let repos: Repositories;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-dashboard-test-"));
  url = `file:${join(dir, "dashboard.db")}`;
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

const withFixture = (mut: (fx: DemoFixture) => void): DemoFixture => {
  const fx = structuredClone(loadNorthstarFixture());
  mut(fx);
  return fx;
};

describe("golden overview", () => {
  it("derives every metric from engine incidents", async () => {
    const d = DashboardDataSchema.parse(await buildDashboardData(repos, DEMO));
    expect(d.workspaceMode).toBe("DEMO");
    expect(d.lastChangedAt).toBe(NOW);
    expect(d.resultsEvaluatedAt).toBe(NOW);
    expect(d).not.toHaveProperty("lastEvaluatedAt");
    expect(d.metrics.potentialShortfall.definition).toMatch(/Only shortfalls due within the 14-day scoring window are counted; later ones are monitored, not counted\./);
    expect(d.metrics.atRiskWorkflows).toMatchObject({ value: 2, workflowIds: ["node-workflow-account-login", "node-workflow-oncall-escalation"] });
    expect(d.metrics.unresolvedExposures).toMatchObject({
      value: 2,
      incidentIds: ["inc-charge-cloudcomms-20261119", "inc-tx-webhookworks-20261116"],
    });
    expect(d.metrics.potentialShortfall).toMatchObject({
      knownCents: 45000,
      incidentIds: ["inc-charge-cloudcomms-20261119"],
      unknownCount: 1,
      unknownIncidentIds: ["inc-charge-metricsrelay-20261124"],
    });
    for (const m of Object.values(d.metrics)) expect(m.definition.length).toBeGreaterThan(40);
    expect(d.unreadableIncidentIds).toEqual([]);
  });

  it("ranks exposures and keeps healthy subjects separate", async () => {
    const d = await buildDashboardData(repos, DEMO);
    expect(d.exposures.map((e) => [e.incidentId, e.severity, e.amountCents, e.dueInDays])).toEqual([
      ["inc-charge-cloudcomms-20261119", "CRITICAL", 45000, 2],
      ["inc-tx-webhookworks-20261116", "HIGH", 29900, null],
      ["inc-charge-metricsrelay-20261124", "UNKNOWN", null, 7],
    ]);
    expect(d.exposures[0]).toMatchObject({
      category: "PROJECTED_SHORTFALL",
      vendorName: "CloudComms",
      at: "2026-11-19T16:00:00Z",
      topWorkflow: { nodeId: "node-workflow-account-login", label: "Account login", criticality: "CRITICAL" },
      confirmedPathCount: 2,
    });
    expect(d.exposures[1]).toMatchObject({ category: "OBSERVED_DECLINE", at: "2026-11-16T09:12:00Z", vendorName: "WebhookWorks" });
    expect(d.healthy).toEqual([
      { incidentId: "inc-charge-computeharbor-20261121", vendorId: "vendor-computeharbor", vendorName: "ComputeHarbor", marginCents: 1020000, dueInDays: 4 },
    ]);
  });

  it("top impacted workflows, forecast series and freshness", async () => {
    const d = await buildDashboardData(repos, DEMO);
    expect(d.topImpactedWorkflows.map((w) => [w.nodeId, w.worstSeverity, w.incidentIds])).toEqual([
      ["node-workflow-account-login", "CRITICAL", ["inc-charge-cloudcomms-20261119"]],
      ["node-workflow-oncall-escalation", "HIGH", ["inc-tx-webhookworks-20261116"]],
    ]);
    const cc = d.forecast.find((f) => f.vendorId === "vendor-cloudcomms")!;
    expect(cc.points).toEqual([
      { at: "2026-10-19T16:00:00Z", amountCents: 231500, kind: "CLEARED", sourceId: "tx-cloudcomms-20261019" },
      { at: "2026-11-19T16:00:00Z", amountCents: 245000, kind: "SCHEDULED", sourceId: "charge-cloudcomms-20261119" },
    ]);
    expect(d.forecast.find((f) => f.vendorId === "vendor-webhookworks")!.points).toEqual([]); // declines are not cleared history
    expect(d.forecast.find((f) => f.vendorId === "vendor-metricsrelay")!.points[0]).toMatchObject({ kind: "FORECAST", amountCents: 36000 });
    expect(d.freshness).toEqual({
      latestSourceCapturedAt: NOW,
      latestFundObservedAt: "2026-11-17T15:45:00Z",
      sourceEvidenceCount: 49,
      byClassification: { DEMO_FIXTURE: 49, RAMP_SANDBOX: 0, EXTERNAL_OBSERVED: 0, MODEL_SUGGESTED: 0, DERIVED: 0, UNKNOWN: 0 },
    });
  });
});

describe("FS-12 done-when: changing the fixture and resetting changes the right totals", () => {
  it("lower availability raises the known potential shortfall", async () => {
    await resetNorthstarDemo(db, { env: DEMO, fixture: withFixture((fx) => (fx.fundingSources.find((f) => f.id === "fund-auth")!.availableCents = 100000)) });
    const d = await buildDashboardData(repos, DEMO);
    expect(d.metrics.potentialShortfall.knownCents).toBe(145000);
    expect(d.exposures[0]!.amountCents).toBe(145000);
  });

  it("enough availability removes the shortfall, the exposure and the at-risk workflow", async () => {
    await resetNorthstarDemo(db, { env: DEMO, fixture: withFixture((fx) => (fx.fundingSources.find((f) => f.id === "fund-auth")!.availableCents = 260000)) });
    const d = await buildDashboardData(repos, DEMO);
    expect(d.metrics.potentialShortfall).toMatchObject({ knownCents: 0, incidentIds: [], unknownCount: 1 });
    expect(d.metrics.unresolvedExposures).toMatchObject({ value: 1, incidentIds: ["inc-tx-webhookworks-20261116"] });
    expect(d.metrics.atRiskWorkflows.workflowIds).toEqual(["node-workflow-oncall-escalation"]);
    expect(d.healthy.map((h) => h.incidentId)).toContain("inc-charge-cloudcomms-20261119");
  });

  it("a known shortfall outside the 14-day window (LOW / MONITORING) is never counted as an exposure", async () => {
    await resetNorthstarDemo(db, {
      env: DEMO,
      fixture: withFixture((fx) => {
        fx.fundingSources.find((f) => f.id === "fund-auth")!.interval = "TOTAL";
        fx.vendorCharges.find((c) => c.id === "charge-cloudcomms-20261119")!.expectedAt = "2026-12-10T16:00:00Z";
      }),
    });
    const hero = await repos.incidents.getById("inc-charge-cloudcomms-20261119");
    expect(hero).toMatchObject({ severity: "LOW", status: "MONITORING" });
    const d = await buildDashboardData(repos, DEMO);
    expect(d.metrics.potentialShortfall).toMatchObject({ knownCents: 0, incidentIds: [] });
    expect(d.metrics.unresolvedExposures.incidentIds).toEqual(["inc-tx-webhookworks-20261116"]);
    expect(d.metrics.atRiskWorkflows.workflowIds).toEqual(["node-workflow-oncall-escalation"]);
    expect(d.exposures.map((e) => e.incidentId)).not.toContain("inc-charge-cloudcomms-20261119");
  });

  it("an unknown hero amount is counted as unknown, never added as $0", async () => {
    await resetNorthstarDemo(db, { env: DEMO, fixture: withFixture((fx) => (fx.vendorCharges.find((c) => c.id === "charge-cloudcomms-20261119")!.expectedCents = null)) });
    const d = await buildDashboardData(repos, DEMO);
    expect(d.metrics.potentialShortfall).toMatchObject({ knownCents: 0, unknownCount: 2 });
    expect(d.metrics.potentialShortfall.unknownIncidentIds).toContain("inc-charge-cloudcomms-20261119");
    expect(d.exposures.find((e) => e.incidentId === "inc-charge-cloudcomms-20261119")!.amountCents).toBeNull();
  });
});

describe("timestamps", () => {
  it("lastChangedAt (max updatedAt) and resultsEvaluatedAt (snapshot evaluation time) are distinct", async () => {
    const fake = {
      ...repos,
      incidents: {
        ...repos.incidents,
        list: async () =>
          (await repos.incidents.list()).map((i) =>
            i.id === "inc-charge-metricsrelay-20261124" ? { ...i, updatedAt: "2026-11-17T18:00:00Z" } : i,
          ),
      },
    } as Repositories;
    const d = await buildDashboardData(fake, DEMO);
    expect(d.lastChangedAt).toBe("2026-11-17T18:00:00Z");
    expect(d.resultsEvaluatedAt).toBe(NOW);
  });
});

describe("robustness", () => {
  it("unreadable snapshots are excluded and listed, not counted", async () => {
    const fake = {
      ...repos,
      incidents: {
        ...repos.incidents,
        list: async () => (await repos.incidents.list()).map((i) => (i.id === "inc-charge-cloudcomms-20261119" ? { ...i, snapshotJson: { bogus: true } } : i)),
      },
    } as Repositories;
    const d = await buildDashboardData(fake, DEMO);
    expect(d.unreadableIncidentIds).toEqual(["inc-charge-cloudcomms-20261119"]);
    expect(d.metrics.potentialShortfall.knownCents).toBe(0);
  });

  it("resolved incidents are not active", async () => {
    const fake = {
      ...repos,
      incidents: { ...repos.incidents, list: async () => (await repos.incidents.list()).map((i) => ({ ...i, status: "RESOLVED" as const })) },
    } as Repositories;
    const d = await buildDashboardData(fake, DEMO);
    expect(d.metrics).toMatchObject({ atRiskWorkflows: { value: 0 }, unresolvedExposures: { value: 0 }, potentialShortfall: { knownCents: 0, unknownCount: 0 } });
    expect(d.exposures).toEqual([]);
  });
});

describe("GET /api/dashboard", () => {
  it("returns the envelope with meta.evaluatedAt = resultsEvaluatedAt", async () => {
    const res = await getDashboard({ repos, env: DEMO });
    expect(res.status).toBe(200);
    const body = Envelope.parse(await res.json());
    expect(body.meta).toEqual({ workspaceMode: "DEMO", generatedAt: NOW, evaluatedAt: NOW });
    expect(body.data.metrics.potentialShortfall.knownCents).toBe(45000);
  });

  it("invalid DEMO_NOW -> 503; unexpected errors -> generic 500", async () => {
    const bad = await getDashboard({ repos, env: { DEMO_MODE: "true", DEMO_NOW: "bogus" } });
    expect(bad.status).toBe(503);
    expect(ApiErrorSchema.parse(await bad.json()).error.code).toBe("NOT_CONFIGURED");

    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = { ...repos, incidents: { ...repos.incidents, list: () => Promise.reject(new Error("secret")) } } as Repositories;
    const res = await getDashboard({ repos: broken, env: DEMO });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/secret/);
    spy.mockRestore();
  });

  it("route module and loadDashboard() read the app DB", async () => {
    const g = globalThis as unknown as { __failsafeDb?: PrismaClient };
    const prevUrl = process.env.DATABASE_URL;
    const prevDb = g.__failsafeDb;
    process.env.DATABASE_URL = url;
    g.__failsafeDb = undefined;
    try {
      const route = await import("@/app/api/dashboard/route");
      expect(route.dynamic).toBe("force-dynamic");
      const res = await route.GET();
      expect(Envelope.parse(await res.json()).data.metrics.unresolvedExposures.value).toBe(2);
      const { loadDashboard } = await import("@/lib/dashboard/load");
      expect(await loadDashboard(DEMO)).toEqual(await buildDashboardData(repos, DEMO));
    } finally {
      const created = (globalThis as unknown as { __failsafeDb?: PrismaClient }).__failsafeDb;
      await created?.$disconnect();
      g.__failsafeDb = prevDb;
      if (prevUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevUrl;
    }
  });
});
