/** FS-08 backend: reviewing SUGGESTED edges against a throwaway seeded SQLite DB. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, type PrismaClient } from "@/lib/db";
import { resetNorthstarDemo } from "@/lib/demo/northstar";
import { EdgeReviewDataSchema, computeBlastRadius } from "@/lib/graph";
import { buildGraphData } from "@/lib/graph/load";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import type { Repositories } from "@/lib/repositories";
import { ApiErrorSchema, apiSuccessSchema } from "@/lib/schema";
import { reviewEdgeHandler } from "@/app/api/_lib/graph-review";

const ROOT = resolve(__dirname, "../..");
const DEMO = { DEMO_MODE: "true" } as const;
const NOW = "2026-11-17T16:00:00Z";
const EDGE = "edge-service-product-analytics--workflow-growth-reporting";
const OLD_EV = `ev-${EDGE}`;
const METRICS_NODE = "node-vendor-metricsrelay";
const GROWTH = "node-workflow-growth-reporting";
const Envelope = apiSuccessSchema(EdgeReviewDataSchema);
const justification = "Growth team confirmed the weekly report reads product analytics.";

let dir: string;
let url: string;
let db: PrismaClient;
let repos: Repositories;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-graph-review-test-"));
  url = `file:${join(dir, "review.db")}`;
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

const review = (body: unknown, id = EDGE, env: Record<string, string | undefined> = DEMO) =>
  reviewEdgeHandler(
    new Request(`http://localhost/api/graph/edges/${id}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    id,
    { db, env },
  );
const blast = async (start = METRICS_NODE) => computeBlastRadius(await buildGraphData(repos), start);
const reviewAudits = async () => (await repos.auditEvents.list()).filter((a) => a.action.startsWith("graph.edge."));

describe("CONFIRM", () => {
  it("appends USER_VERIFIED MANUAL evidence from the justification and moves the workflow into the confirmed blast radius", async () => {
    const oldEvidence = await repos.evidence.getById(OLD_EV);
    expect((await blast()).confirmed.workflows).toEqual([]);
    expect((await blast()).possible.onlyPossibleNodeIds).toEqual([GROWTH]);

    const res = await review({ decision: "CONFIRM", reviewer: "growth-lead", justification });
    expect(res.status).toBe(200);
    const { data } = Envelope.parse(await res.json());
    expect(data.edge).toMatchObject({ id: EDGE, reviewStatus: "CONFIRMED", evidenceId: data.evidence.id });
    expect(data.previousEvidenceId).toBe(OLD_EV);
    expect(data.evidence).toMatchObject({
      kind: "MANUAL",
      classification: "DEMO_FIXTURE",
      verificationStatus: "USER_VERIFIED",
      sourceSystem: "failsafe-graph-review",
      capturedAt: NOW,
    });
    expect(data.evidence.excerpt).toBe(
      `Reviewer growth-lead confirmed "Product analytics REQUIRES Weekly growth reporting": ${justification} (prior evidence: ${OLD_EV})`,
    );
    // The prior evidence is untouched (append-only).
    expect(await repos.evidence.getById(OLD_EV)).toEqual(oldEvidence);

    const b = await blast();
    expect(b.confirmed.workflows.map((w) => w.nodeId)).toEqual([GROWTH]);
    expect(b.possible.paths).toEqual([]);

    // The graph read path exposes the new evidence with its method.
    const g = await buildGraphData(repos);
    expect(g.evidence[data.evidence.id]).toMatchObject({ kind: "MANUAL", verificationStatus: "USER_VERIFIED", sourceSystem: "failsafe-graph-review" });
    expect(g.edges.find((e) => e.id === EDGE)!.reviewStatus).toBe("CONFIRMED");

    // The risk engine re-ran: MetricsRelay's impact changed (still UNKNOWN_DATA: billing/funding are still missing).
    expect(data.incidents.updated).toContain("inc-charge-metricsrelay-20261124");
    const inc = await repos.incidents.getById("inc-charge-metricsrelay-20261124");
    expect(inc.severity).toBe("UNKNOWN");
    expect((inc.snapshotJson as { impact: { confirmedWorkflows: { nodeId: string }[] } }).impact.confirmedWorkflows.map((w) => w.nodeId)).toEqual([GROWTH]);
  });

  it("writes one audit event (graph.edge.confirmed, subject = edge)", async () => {
    const { data } = Envelope.parse(await (await review({ decision: "CONFIRM", reviewer: "growth-lead", justification })).json());
    const audits = await reviewAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ id: data.auditEventId, action: "graph.edge.confirmed", actor: "growth-lead", subjectId: EDGE, at: NOW });
    expect(audits[0]!.detailsJson).toMatchObject({
      decision: "CONFIRM",
      fromStatus: "SUGGESTED",
      toStatus: "CONFIRMED",
      justification,
      previousEvidenceId: OLD_EV,
      newEvidenceId: data.evidence.id,
    });
  });
});

describe("CONFIRM outside the DEMO workspace", () => {
  it("classifies the reviewer attestation as UNKNOWN (never EXTERNAL_OBSERVED); MANUAL + USER_VERIFIED carry the meaning", async () => {
    const { createRepositories } = await import("@/lib/repositories");
    const raw = createRepositories(db, { writeGate: () => undefined, demoResetGate: () => undefined });
    const [ws] = await raw.workspaces.list();
    await raw.workspaces.update(ws!.id, { mode: "RAMP_SANDBOX" });
    const { data } = Envelope.parse(await (await review({ decision: "CONFIRM", reviewer: "growth-lead", justification })).json());
    expect(data.evidence).toMatchObject({ kind: "MANUAL", classification: "UNKNOWN", verificationStatus: "USER_VERIFIED" });
    expect(data.edge.reviewStatus).toBe("CONFIRMED");
    // A USER_VERIFIED edge is confirmed; the UNKNOWN classification is still flagged for review in display metadata.
    const g = await buildGraphData(repos);
    expect(g.evidence[data.evidence.id]).toMatchObject({ classification: "UNKNOWN", kind: "MANUAL", verificationStatus: "USER_VERIFIED" });
  });
});

describe("REJECT", () => {
  it("sets REJECTED, keeps the evidence, removes the possible impact, and audits", async () => {
    const res = await review({ decision: "REJECT", reviewer: "growth-lead", justification: "Weekly report no longer uses analytics." });
    const { data } = Envelope.parse(await res.json());
    expect(data.edge).toMatchObject({ reviewStatus: "REJECTED", evidenceId: OLD_EV });
    expect(data.evidence.id).toBe(OLD_EV);
    const b = await blast();
    expect(b.confirmed.workflows).toEqual([]);
    expect(b.possible.paths).toEqual([]);
    expect(b.possible.onlyPossibleNodeIds).toEqual([]);
    const audits = await reviewAudits();
    expect(audits.map((a) => [a.action, a.subjectId])).toEqual([["graph.edge.rejected", EDGE]]);
    expect(audits[0]!.detailsJson).toMatchObject({ newEvidenceId: null, toStatus: "REJECTED" });
  });
});

describe("errors (nothing is written)", () => {
  it("409 for a repeat review or a non-SUGGESTED edge (repeats are not silent no-ops)", async () => {
    await review({ decision: "CONFIRM", reviewer: "growth-lead", justification });
    const again = await review({ decision: "CONFIRM", reviewer: "growth-lead", justification });
    expect(again.status).toBe(409);
    expect(ApiErrorSchema.parse(await again.json()).error).toMatchObject({ code: "INVALID_TRANSITION", details: { currentStatus: "CONFIRMED" } });
    expect((await review({ decision: "REJECT", reviewer: "x", justification }, "edge-fund-auth--card-auth")).status).toBe(409);
    expect(await reviewAudits()).toHaveLength(1);
  });

  it("400 for invalid bodies; 404 unknown edge; 403 outside demo mode", async () => {
    const before = { evidence: (await repos.evidence.list()).length, edge: await repos.edges.getById(EDGE) };
    for (const body of [
      "{bad",
      {},
      { decision: "CONFIRM", reviewer: "growth-lead" },
      { decision: "CONFIRM", reviewer: "growth-lead", justification: "short" },
      { decision: "CONFIRM", reviewer: "", justification },
      { decision: "APPROVE", reviewer: "growth-lead", justification },
      { decision: "CONFIRM", reviewer: "growth-lead", justification, reviewStatus: "CONFIRMED" },
    ]) {
      expect((await review(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await review({ decision: "CONFIRM", reviewer: "growth-lead", justification }, "edge-nope")).status).toBe(404);
    expect((await review({ decision: "CONFIRM", reviewer: "growth-lead", justification }, EDGE, { DEMO_MODE: "false" })).status).toBe(403);
    expect((await repos.evidence.list()).length).toBe(before.evidence);
    expect(await repos.edges.getById(EDGE)).toEqual(before.edge);
    expect(await reviewAudits()).toEqual([]);
  });
});

describe("route module", () => {
  it("POST /api/graph/edges/[id]/review uses getDb()", async () => {
    const g = globalThis as unknown as { __failsafeDb?: PrismaClient };
    const prev = { url: process.env.DATABASE_URL, demo: process.env.DEMO_MODE, now: process.env.DEMO_NOW, db: g.__failsafeDb };
    process.env.DATABASE_URL = url;
    process.env.DEMO_MODE = "true";
    delete process.env.DEMO_NOW;
    g.__failsafeDb = undefined;
    try {
      const route = await import("@/app/api/graph/edges/[id]/review/route");
      const res = await route.POST(
        new Request(`http://localhost/api/graph/edges/${EDGE}/review`, {
          method: "POST",
          body: JSON.stringify({ decision: "REJECT", reviewer: "growth-lead", justification: "Not a real dependency." }),
        }),
        { params: Promise.resolve({ id: EDGE }) },
      );
      expect(res.status).toBe(200);
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
