/**
 * FS-05 evidence ledger + /api/sources tests against a throwaway seeded SQLite DB.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDbClient, type PrismaClient } from "@/lib/db";
import { seedNorthstarDemo } from "@/lib/demo/northstar";
import { NotFoundError, createRepositories, type Repositories } from "@/lib/repositories";
import {
  buildEvidenceLedger,
  getEvidenceLedgerEntry,
  resolveChargeEvidence,
  resolveEdgeEvidence,
  resolveEvidenceForSubject,
  resolveIncidentEvidence,
  resolveNodeEvidence,
} from "@/lib/provenance/ledger";
import { EvidenceLedgerEntrySchema, SourcesListDataSchema } from "@/lib/provenance/ledger-schema";
import { ApiErrorSchema, apiSuccessSchema } from "@/lib/schema";
import { WriteForbiddenError } from "@/lib/security/write-gate";
import { getSource, listSources } from "@/app/api/_lib/sources";
import { resetNorthstarDemo } from "@/lib/demo/northstar";
import { materializeIncidents } from "@/lib/incidents";
import { assertWritesAllowed } from "@/lib/security/write-gate";
import type { ApiContext } from "@/app/api/_lib/http";
import { getGraph } from "@/app/api/_lib/graph";

const ROOT = resolve(__dirname, "../..");
const DEMO = { DEMO_MODE: "true" } as const;
const NOW = "2026-11-17T16:00:00Z";

let dir: string;
let url: string;
let db: PrismaClient;
let repos: Repositories;
let ctx: ApiContext;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-sources-test-"));
  url = `file:${join(dir, "sources.db")}`;
  execFileSync(join(ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  db = createDbClient(url);
  await seedNorthstarDemo(db, { env: DEMO });
  repos = createRepositories(db, {
    writeGate: () => {
      throw new WriteForbiddenError("Read-only test");
    },
  });
  ctx = { repos, env: DEMO };
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const ListEnvelope = apiSuccessSchema(SourcesListDataSchema);
const DetailEnvelope = apiSuccessSchema(EvidenceLedgerEntrySchema);

describe("every seeded record resolves to existing evidence", () => {
  it("edges, nodes, funds, cards, vendors, charges and transactions", async () => {
    const groups = [
      ["EDGE", await repos.edges.list()],
      ["NODE", await repos.nodes.list()],
      ["FUNDING_SOURCE", await repos.fundingSources.list()],
      ["PAYMENT_INSTRUMENT", await repos.paymentInstruments.list()],
      ["VENDOR", await repos.vendors.list()],
      ["VENDOR_CHARGE", await repos.vendorCharges.list()],
      ["TRANSACTION", await repos.transactions.list()],
    ] as const;
    let resolved = 0;
    for (const [type, records] of groups) {
      expect(records.length, type).toBeGreaterThan(0);
      for (const r of records) {
        const res = await resolveEvidenceForSubject(repos, type, r.id);
        expect(res.evidence.id).toBe(r.evidenceId);
        expect(res.evidence.classification).toBe("DEMO_FIXTURE");
        resolved += 1;
      }
    }
    expect(resolved).toBe(49);
    expect((await repos.edges.list()).length).toBe(15);
  });

  it("named resolvers work and missing subjects are NotFound", async () => {
    expect((await resolveEdgeEvidence(repos, "edge-vendor-cloudcomms--service-otp-gateway")).evidence.id).toBe(
      "ev-edge-vendor-cloudcomms--service-otp-gateway",
    );
    expect((await resolveNodeEvidence(repos, "node-fund-auth")).evidence.id).toBe("ev-node-fund-auth");
    expect((await resolveChargeEvidence(repos, "charge-cloudcomms-20261119")).evidence.excerpt).toMatch(/sample billing configuration/);
    await expect(resolveIncidentEvidence(repos, "inc-missing")).rejects.toBeInstanceOf(NotFoundError);
    await expect(resolveEdgeEvidence(repos, "edge-missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("evidence ledger", () => {
  it("lists every evidence record with exactly the assertions it supports", async () => {
    const ledger = SourcesListDataSchema.parse(await buildEvidenceLedger(repos));
    // 49 fixture records + 4 DERIVED rule-evaluation records written by the risk engine (FS-11).
    expect(ledger.entries).toHaveLength(53);
    expect(ledger.unresolved).toEqual([]);
    expect(ledger.totals.total).toBe(53);
    expect(ledger.totals.byClassification).toEqual({
      DEMO_FIXTURE: 49, RAMP_SANDBOX: 0, EXTERNAL_OBSERVED: 0, MODEL_SUGGESTED: 0, DERIVED: 4, UNKNOWN: 0,
    });
    expect(ledger.totals.byVerificationStatus).toEqual({ UNVERIFIED: 53, USER_VERIFIED: 0, REJECTED: 0 });
    for (const e of ledger.entries) {
      expect(e.supports, e.id).toHaveLength(1);
      if (e.classification === "DEMO_FIXTURE") {
        expect(e.display).toMatchObject({ category: "synthetic", isSimulated: true, badge: { label: "DEMO DATA" } });
        expect(e).toMatchObject({ ruleLineage: [], lineageStatus: "NOT_APPLICABLE", lineageNote: null, recordedRule: null, derivedFromSimulatedInputs: false });
      } else {
        // DERIVED from demo inputs: classification stays DERIVED, but it carries the DEMO DATA badge.
        expect(e).toMatchObject({
          kind: "RULE",
          classification: "DERIVED",
          display: { category: "derived", isSimulated: false, badge: { label: "DEMO DATA" } },
          lineageStatus: "CURRENT",
          lineageNote: null,
          derivedFromSimulatedInputs: true,
        });
        expect(e.supports[0]!.subjectType).toBe("INCIDENT");
        expect(e.ruleLineage).toHaveLength(1);
        expect(e.recordedRule).toMatchObject({ ruleId: e.ruleLineage[0]!.ruleId, assertionId: e.ruleLineage[0]!.assertionId, fingerprint: e.contentHash });
      }
    }
    const ids = ledger.entries.map((e) => e.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("edge evidence describes the exact causal claim and review status", async () => {
    const entry = await getEvidenceLedgerEntry(repos, "ev-edge-workflow-account-login--outcome-customer-checkout");
    expect(entry.supports).toEqual([
      {
        subjectType: "EDGE",
        subjectId: "edge-workflow-account-login--outcome-customer-checkout",
        label: "Account login AFFECTS Customer checkout",
        edge: {
          fromNodeId: "node-workflow-account-login",
          toNodeId: "node-outcome-customer-checkout",
          relation: "AFFECTS",
          reviewStatus: "CONFIRMED",
        },
      },
    ]);
    const suggested = await getEvidenceLedgerEntry(repos, "ev-edge-service-product-analytics--workflow-growth-reporting");
    expect(suggested.supports[0]?.edge?.reviewStatus).toBe("SUGGESTED");
  });

  it("rule evidence for the hero incident carries real rule lineage (FS-11)", async () => {
    const hero = await repos.incidents.findByScenarioKey("charge:charge-cloudcomms-20261119");
    const entry = await getEvidenceLedgerEntry(repos, hero!.evidenceId);
    expect(entry).toMatchObject({ kind: "RULE", classification: "DERIVED", sourceSystem: "failsafe-risk-engine" });
    expect(entry.supports).toEqual([
      { subjectType: "INCIDENT", subjectId: hero!.id, label: "Projected $450.00 funding shortfall for CloudComms", edge: null },
    ]);
    expect(entry.ruleLineage).toHaveLength(1);
    expect(entry.ruleLineage[0]).toMatchObject({
      ruleId: "projected-shortfall-v1",
      assertionId: "risk-charge-charge-cloudcomms-20261119",
      evaluatedAt: NOW,
    });
    expect(entry.ruleLineage[0]!.inputs).toContain("evidence:ev-fund-auth");
    // Fixture evidence never gets lineage.
    expect((await getEvidenceLedgerEntry(repos, "ev-fund-auth")).ruleLineage).toEqual([]);
  });

  it("charge and transaction labels use formatted cents", async () => {
    expect((await getEvidenceLedgerEntry(repos, "ev-charge-cloudcomms-20261119")).supports[0]?.label).toBe(
      "CloudComms charge $2,450.00 expected 2026-11-19",
    );
    expect((await getEvidenceLedgerEntry(repos, "ev-tx-webhookworks-20261116")).supports[0]?.label).toBe(
      "WebhookWorks declined transaction $299.00 on 2026-11-16",
    );
  });

  it("filters by classification and verification status", async () => {
    expect((await buildEvidenceLedger(repos, { classification: "MODEL_SUGGESTED" })).entries).toEqual([]);
    expect((await buildEvidenceLedger(repos, { verificationStatus: "UNVERIFIED" })).entries).toHaveLength(53);
    expect((await buildEvidenceLedger(repos, { classification: "DEMO_FIXTURE" })).entries).toHaveLength(49);
  });

  it("never labels anything as Ramp-documented", async () => {
    expect(JSON.stringify(await buildEvidenceLedger(repos))).not.toMatch(/RAMP_DOCUMENTED|ramp[- ]documented/i);
  });
});

describe("API handlers", () => {
  it("GET /api/sources returns a valid { data, meta } envelope", async () => {
    const res = await listSources(new Request("http://localhost/api/sources"), ctx);
    expect(res.status).toBe(200);
    const body = ListEnvelope.parse(await res.json());
    expect(body.data.entries).toHaveLength(53);
    expect(body.meta).toEqual({ workspaceMode: "DEMO", generatedAt: NOW, evaluatedAt: null });
  });

  it("GET /api/sources supports filters and rejects bad queries with 400", async () => {
    const filtered = await listSources(new Request("http://localhost/api/sources?classification=DERIVED"), ctx);
    expect(ListEnvelope.parse(await filtered.json()).data.totals.total).toBe(4);
    for (const q of ["classification=RAMP_DOCUMENTED", "foo=bar", "classification=DEMO_FIXTURE&classification=DERIVED"]) {
      const res = await listSources(new Request(`http://localhost/api/sources?${q}`), ctx);
      expect(res.status, q).toBe(400);
      expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("BAD_REQUEST");
    }
  });

  it("GET /api/sources/[id] returns the entry, 404 for unknown ids", async () => {
    const ok = await getSource("ev-fund-auth", ctx);
    expect(ok.status).toBe(200);
    expect(DetailEnvelope.parse(await ok.json()).data.supports[0]).toMatchObject({
      subjectType: "FUNDING_SOURCE",
      subjectId: "fund-auth",
    });

    const missing = await getSource("ev-does-not-exist", ctx);
    expect(missing.status).toBe(404);
    const err = ApiErrorSchema.parse(await missing.json());
    expect(err.error.code).toBe("NOT_FOUND");

    expect((await getSource("   ", ctx)).status).toBe(400);
  });

  it("an invalid DEMO_NOW is a 503 NOT_CONFIGURED with a clear message (sources and graph)", async () => {
    const bad = { ...ctx, env: { DEMO_MODE: "true", DEMO_NOW: "bogus" } };
    for (const res of [await listSources(new Request("http://localhost/api/sources"), bad), await getSource("ev-fund-auth", bad), await getGraph(bad)]) {
      expect(res.status).toBe(503);
      expect(ApiErrorSchema.parse(await res.json()).error).toEqual({
        code: "NOT_CONFIGURED",
        message: "DEMO_NOW is not a valid ISO timestamp with timezone (e.g. 2026-11-17T16:00:00Z).",
      });
    }
  });

  it("unexpected errors become a generic 500 without internals", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = {
      ...ctx,
      repos: {
        ...repos,
        evidence: { ...repos.evidence, list: () => Promise.reject(new Error("SQLITE secret path /x/y at line 9")) },
      } as Repositories,
    };
    const res = await listSources(new Request("http://localhost/api/sources"), broken);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal error" } });
    expect(text).not.toMatch(/secret|stack|line 9/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("Next route modules", () => {
  it("GET route handlers serve the seeded DB through getDb()", async () => {
    const g = globalThis as unknown as { __failsafeDb?: PrismaClient };
    const prevUrl = process.env.DATABASE_URL;
    const prevDb = g.__failsafeDb;
    process.env.DATABASE_URL = url;
    g.__failsafeDb = undefined;
    try {
      const list = await import("@/app/api/sources/route");
      const detail = await import("@/app/api/sources/[id]/route");
      expect(list.dynamic).toBe("force-dynamic");

      const res = await list.GET(new Request("http://localhost/api/sources"));
      expect(res.status).toBe(200);
      expect(ListEnvelope.parse(await res.json()).data.entries).toHaveLength(53);

      const hit = await detail.GET(new Request("http://localhost/api/sources/ev-node-fund-auth"), {
        params: Promise.resolve({ id: "ev-node-fund-auth" }),
      });
      expect(DetailEnvelope.parse(await hit.json()).data.id).toBe("ev-node-fund-auth");

      const miss = await detail.GET(new Request("http://localhost/api/sources/nope"), { params: Promise.resolve({ id: "nope" }) });
      expect(miss.status).toBe(404);
      expect(ApiErrorSchema.safeParse(await miss.json()).success).toBe(true);
    } finally {
      const created = (globalThis as unknown as { __failsafeDb?: PrismaClient }).__failsafeDb;
      await created?.$disconnect();
      g.__failsafeDb = prevDb;
      if (prevUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevUrl;
    }
  });
});

describe("server-component convenience API", () => {
  it("listEvidenceSources / findEvidenceSource use the app DB, null for unknown ids", async () => {
    const g = globalThis as unknown as { __failsafeDb?: PrismaClient };
    const prevUrl = process.env.DATABASE_URL;
    const prevDb = g.__failsafeDb;
    process.env.DATABASE_URL = url;
    g.__failsafeDb = undefined;
    try {
      const { listEvidenceSources, findEvidenceSource } = await import("@/lib/provenance/ledger");
      expect((await listEvidenceSources()).entries).toHaveLength(53);
      expect((await listEvidenceSources({ classification: "DERIVED" })).entries).toHaveLength(4);
      expect((await listEvidenceSources({ classification: "MODEL_SUGGESTED" })).entries).toEqual([]);
      expect((await findEvidenceSource("ev-fund-auth"))?.supports[0]?.subjectId).toBe("fund-auth");
      expect(await findEvidenceSource("ev-nope")).toBeNull();
    } finally {
      const created = (globalThis as unknown as { __failsafeDb?: PrismaClient }).__failsafeDb;
      await created?.$disconnect();
      g.__failsafeDb = prevDb;
      if (prevUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevUrl;
    }
  });
});

describe("rule lineage status and simulated-input badges (FS-11/FS-05 seam)", () => {
  it("non-demo inputs and a live workspace give no badge and derivedFromSimulatedInputs false", async () => {
    const fake = {
      ...repos,
      evidence: {
        ...repos.evidence,
        list: async () => (await repos.evidence.list()).map((e) => (e.kind === "FIXTURE" ? { ...e, classification: "EXTERNAL_OBSERVED" as const } : e)),
      },
      workspaces: { ...repos.workspaces, list: async () => (await repos.workspaces.list()).map((w) => ({ ...w, mode: "RAMP_LIVE_READONLY" as const })) },
    } as Repositories;
    const ledger = await buildEvidenceLedger(fake, { classification: "DERIVED" });
    expect(ledger.entries).toHaveLength(4);
    for (const e of ledger.entries) expect(e).toMatchObject({ derivedFromSimulatedInputs: false, display: { badge: null }, lineageStatus: "CURRENT" });
  });

  it("a superseded evaluation keeps its recorded rule and says so, without claiming 'no lineage'", async () => {
    const writeRepos = createRepositories(db, { writeGate: () => assertWritesAllowed({ env: DEMO }), demoResetGate: () => undefined });
    const before = await repos.incidents.findByScenarioKey("charge:charge-cloudcomms-20261119");
    const oldEvidenceId = before!.evidenceId;
    try {
      await materializeIncidents(writeRepos, new Date("2026-11-18T04:00:00Z")); // changed evaluation -> new RULE record
      const after = await repos.incidents.findByScenarioKey("charge:charge-cloudcomms-20261119");
      expect(after!.evidenceId).not.toBe(oldEvidenceId);

      const old = await getEvidenceLedgerEntry(repos, oldEvidenceId);
      expect(old).toMatchObject({
        kind: "RULE",
        classification: "DERIVED",
        supports: [],
        ruleLineage: [],
        lineageStatus: "SUPERSEDED",
        lineageNote: "Superseded evaluation; not cited by a current incident",
        recordedRule: { ruleId: "projected-shortfall-v1", assertionId: "risk-charge-charge-cloudcomms-20261119", evaluatedAt: NOW },
        derivedFromSimulatedInputs: true, // inputs unknown once superseded: falls back to the DEMO workspace
        display: { badge: { label: "DEMO DATA" } },
      });
      expect(old.recordedRule!.fingerprint).toBe(old.contentHash);

      const current = await getEvidenceLedgerEntry(repos, after!.evidenceId);
      expect(current).toMatchObject({ lineageStatus: "CURRENT", lineageNote: null, derivedFromSimulatedInputs: true });
      expect(current.ruleLineage[0]!.evaluatedAt).toBe("2026-11-18T04:00:00Z");

      const listed = (await buildEvidenceLedger(repos, { classification: "DERIVED" })).entries;
      expect(listed.filter((e) => e.lineageStatus === "SUPERSEDED").map((e) => e.id)).toContain(oldEvidenceId);
    } finally {
      await resetNorthstarDemo(db, { env: DEMO });
    }
  });
});
