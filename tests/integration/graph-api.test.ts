/** FS-07 backend: GET /api/graph + loadGraph against a throwaway seeded SQLite DB. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDbClient, type PrismaClient } from "@/lib/db";
import { seedNorthstarDemo } from "@/lib/demo/northstar";
import { GraphDataSchema, computeBlastRadius } from "@/lib/graph";
import { buildGraphData } from "@/lib/graph/load";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import type { Repositories } from "@/lib/repositories";
import { ApiErrorSchema, apiSuccessSchema } from "@/lib/schema";
import { getGraph } from "@/app/api/_lib/graph";

const ROOT = resolve(__dirname, "../..");
const DEMO = { DEMO_MODE: "true" } as const;
const Envelope = apiSuccessSchema(GraphDataSchema);

let dir: string;
let url: string;
let db: PrismaClient;
let repos: Repositories;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-graph-test-"));
  url = `file:${join(dir, "graph.db")}`;
  execFileSync(join(ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  db = createDbClient(url);
  await seedNorthstarDemo(db, { env: DEMO });
  repos = createReadOnlyRepositories(db);
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("buildGraphData", () => {
  it("returns the seeded graph with evidence display for every node and edge", async () => {
    const data = GraphDataSchema.parse(await buildGraphData(repos));
    expect(data.nodes).toHaveLength(18);
    expect(data.edges).toHaveLength(15);
    expect(data.nodes.map((n) => n.id)).toEqual([...data.nodes.map((n) => n.id)].sort());
    expect(data.edges.map((e) => e.id)).toEqual([...data.edges.map((e) => e.id)].sort());
    expect(Object.keys(data.evidence)).toHaveLength(33);
    for (const x of [...data.nodes, ...data.edges]) {
      expect(data.evidence[x.evidenceId], x.id).toMatchObject({
        id: x.evidenceId,
        classification: "DEMO_FIXTURE",
        verificationStatus: "UNVERIFIED",
        category: "synthetic",
        badge: { label: "DEMO DATA" },
      });
    }
    expect(data.unresolvedEvidenceIds).toEqual([]);
    expect(data.evidence["ev-edge-vendor-webhookworks--service-incident-monitoring"]!.excerpt).toMatch(/Impact is potential/);
  });

  it("flags MetricsRelay as needing mapping from canonical data; others are mapped", async () => {
    const { vendors } = await buildGraphData(repos);
    expect(vendors.map((v) => v.nodeId)).toEqual([
      "node-vendor-cloudcomms",
      "node-vendor-computeharbor",
      "node-vendor-metricsrelay",
      "node-vendor-webhookworks",
    ]);
    expect(vendors.find((v) => v.vendorId === "vendor-metricsrelay")).toEqual({
      nodeId: "node-vendor-metricsrelay",
      vendorId: "vendor-metricsrelay",
      name: "MetricsRelay",
      billingMethod: "UNKNOWN",
      needsMapping: true,
      needsMappingReasons: ["BILLING_METHOD_UNKNOWN", "CHARGE_WITHOUT_FUNDING_SOURCE", "NO_CONFIRMED_PAYMENT_EDGE"],
    });
    for (const v of vendors.filter((x) => x.vendorId !== "vendor-metricsrelay")) {
      expect(v, v.nodeId).toMatchObject({ needsMapping: false, needsMappingReasons: [], billingMethod: "CARD" });
    }
  });

  it("feeds the graph algorithms directly (hero paths unchanged)", async () => {
    const data = await buildGraphData(repos);
    const br = computeBlastRadius(data, "node-fund-auth");
    expect(br.confirmed.workflows.map((w) => w.nodeId)).toEqual(["node-workflow-account-login"]);
    expect(br.confirmed.outcomes.map((o) => o.nodeId)).toEqual(["node-outcome-customer-checkout"]);
    for (const p of br.confirmed.paths) for (const id of p.edgeEvidenceIds) expect(data.evidence[id]).toBeDefined();
  });

  it("reports unresolved evidence and vendor nodes without records instead of faking them", async () => {
    const data = await buildGraphData(repos);
    const fake = {
      ...repos,
      nodes: { ...repos.nodes, list: async () => [...data.nodes, { id: "node-vendor-ghost", kind: "VENDOR" as const, label: "Ghost", criticality: "LOW" as const, owner: null, evidenceId: "ev-missing" }] },
    } as Repositories;
    const res = await buildGraphData(fake);
    expect(res.unresolvedEvidenceIds).toEqual(["ev-missing"]);
    expect(res.evidence["ev-missing"]).toBeUndefined();
    expect(res.vendors.find((v) => v.nodeId === "node-vendor-ghost")).toMatchObject({
      vendorId: null,
      billingMethod: null,
      needsMapping: true,
      needsMappingReasons: ["NO_VENDOR_RECORD", "NO_CONFIRMED_PAYMENT_EDGE"],
    });
  });
});

describe("GET /api/graph", () => {
  it("handler returns a valid { data, meta } envelope", async () => {
    const res = await getGraph({ repos, env: DEMO });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = Envelope.parse(await res.json());
    expect(body.meta).toEqual({ workspaceMode: "DEMO", generatedAt: "2026-11-17T16:00:00Z", evaluatedAt: null });
    expect(body.data.edges.filter((e) => e.reviewStatus === "SUGGESTED").map((e) => e.id)).toEqual([
      "edge-service-product-analytics--workflow-growth-reporting",
    ]);
  });

  it("unexpected errors become a generic 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = { ...repos, edges: { ...repos.edges, list: () => Promise.reject(new Error("secret db path")) } } as Repositories;
    const res = await getGraph({ repos: broken, env: DEMO });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(ApiErrorSchema.parse(JSON.parse(text)).error).toEqual({ code: "INTERNAL_ERROR", message: "Internal error" });
    expect(text).not.toMatch(/secret/);
    spy.mockRestore();
  });

  it("route module and loadGraph() read the app DB via getDb()", async () => {
    const g = globalThis as unknown as { __failsafeDb?: PrismaClient };
    const prevUrl = process.env.DATABASE_URL;
    const prevDb = g.__failsafeDb;
    process.env.DATABASE_URL = url;
    g.__failsafeDb = undefined;
    try {
      const route = await import("@/app/api/graph/route");
      expect(route.dynamic).toBe("force-dynamic");
      const res = await route.GET();
      expect(res.status).toBe(200);
      expect(Envelope.parse(await res.json()).data.nodes).toHaveLength(18);
      const { loadGraph } = await import("@/lib/graph/load");
      const data = await loadGraph();
      expect(data).toEqual(await buildGraphData(repos));
    } finally {
      const created = (globalThis as unknown as { __failsafeDb?: PrismaClient }).__failsafeDb;
      await created?.$disconnect();
      g.__failsafeDb = prevDb;
      if (prevUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevUrl;
    }
  });
});
