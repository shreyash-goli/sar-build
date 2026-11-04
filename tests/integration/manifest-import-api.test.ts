/** FS-09 backend: POST /api/imports/manifest against a throwaway seeded SQLite DB. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SAMPLE_REPO_FILES, SAMPLE_REPO_SERVICE_NODE_ID } from "@/fixtures/sample-repo";
import { createDbClient, type PrismaClient } from "@/lib/db";
import { resetNorthstarDemo } from "@/lib/demo/northstar";
import { computeBlastRadius } from "@/lib/graph";
import { buildGraphData } from "@/lib/graph/load";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { ManifestImportDataSchema } from "@/lib/providers/import-schema";
import { MAX_MANIFEST_BYTES } from "@/lib/providers/manifest-import";
import type { Repositories } from "@/lib/repositories";
import { ApiErrorSchema, apiSuccessSchema } from "@/lib/schema";
import { importManifestHandler } from "@/app/api/_lib/imports";
import { getEvidenceLedgerEntry } from "@/lib/provenance/ledger";
import { createRepositories } from "@/lib/repositories";
import { reviewEdgeHandler } from "@/app/api/_lib/graph-review";

const ROOT = resolve(__dirname, "../..");
const DEMO = { DEMO_MODE: "true" } as const;
const Envelope = apiSuccessSchema(ManifestImportDataSchema);
const CC_EDGE = "edge-vendor-cloudcomms--service-incident-monitoring";
const CH_EDGE = "edge-vendor-computeharbor--service-incident-monitoring";
const WW_EDGE = "edge-vendor-webhookworks--service-incident-monitoring";

let dir: string;
let url: string;
let db: PrismaClient;
let repos: Repositories;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-manifest-test-"));
  url = `file:${join(dir, "manifest.db")}`;
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

const sample = { serviceNodeId: SAMPLE_REPO_SERVICE_NODE_ID, importedBy: "platform-eng", files: SAMPLE_REPO_FILES };
const post = (body: unknown, env: Record<string, string | undefined> = DEMO) =>
  importManifestHandler(
    new Request("http://localhost/api/imports/manifest", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }),
    { db, env },
  );
const ok = async (res: Response) => {
  expect(res.status).toBe(201);
  return Envelope.parse(await res.json()).data;
};
const severities = async () => (await repos.incidents.list()).map((i) => [i.id, i.severity, i.status]);
const counts = async () => ({ edges: (await repos.edges.list()).length, evidence: (await repos.evidence.list()).length });

describe("importing the sample repository", () => {
  it("suggests edges with MANIFEST evidence; reports duplicates, unmatched and unrecognized", async () => {
    const d = await ok(await post(sample));
    expect(d.files.map((f) => [f.filename, f.format, f.findings])).toEqual([
      ["package.json", "PACKAGE_JSON", 4],
      ["docker-compose.yml", "DOCKER_COMPOSE", 2],
      ["main.tf", "TERRAFORM", 2],
    ]);
    expect(d.suggested.map((s) => [s.edgeId, s.vendorName, s.source.filename, s.source.token])).toEqual([
      [CC_EDGE, "CloudComms", "package.json", "@cloudcomms/sdk"],
      [CH_EDGE, "ComputeHarbor", "main.tf", "computeharbor/computeharbor"],
    ]);
    expect(d.duplicates.map((x) => [x.edgeId, x.existingStatus])).toEqual([
      [WW_EDGE, "CONFIRMED"], // already in the fixture graph
      [CH_EDGE, "SUGGESTED"], // the provider block repeats main.tf's required_providers entry
    ]);
    expect(d.unmatched.map((u) => [u.provider.id, u.reason])).toEqual([["twilio", "No vendor record for Twilio in this workspace"]]);
    expect(d.unrecognizedCount).toBe(3); // express, pino, postgres (no unparsed compose lines in the sample)
    expect(d.notice).toMatch(/^Suggestions only/);

    const edge = await repos.edges.getById(CC_EDGE);
    expect(edge).toMatchObject({ reviewStatus: "SUGGESTED", relation: "POWERS", dependencyStrength: "OPTIONAL", confidenceTier: "LOW" });
    const ev = await repos.evidence.getById(edge.evidenceId);
    expect(ev).toMatchObject({
      kind: "MANIFEST",
      classification: "DEMO_FIXTURE", // fictional DEMO workspace: synthetic evidence is always DEMO_FIXTURE
      verificationStatus: "UNVERIFIED",
      sourceSystem: "manifest-import",
      path: "package.json",
      contentHash: d.files[0]!.sha256,
    });
    expect(ev.excerpt).toMatch(/^Fictional sample file\. package\.json references "@cloudcomms\/sdk"/);
    expect(ev.excerpt).toMatch(/not proof it is production-critical or card-funded/);
    // Sources ledger: DEMO DATA badge, never "Observed" without a demo label.
    const entry = await getEvidenceLedgerEntry(repos, ev.id);
    expect(entry).toMatchObject({ kind: "MANIFEST", classification: "DEMO_FIXTURE", display: { category: "synthetic", badge: { label: "DEMO DATA" } } });
    expect((await buildGraphData(repos)).evidence[ev.id]).toMatchObject({ kind: "MANIFEST" });
  });

  it("never affects confirmed risk until reviewed; appears as a possible impact", async () => {
    const before = await severities();
    const blastBefore = computeBlastRadius(await buildGraphData(repos), "node-fund-auth");
    await ok(await post(sample));
    expect(await severities()).toEqual(before);
    const after = computeBlastRadius(await buildGraphData(repos), "node-fund-auth");
    expect(after.confirmed).toEqual(blastBefore.confirmed);
    expect(after.possible.onlyPossibleNodeIds).toContain("node-workflow-oncall-escalation");
    expect(after.possible.unconfirmedEdgeIds).toEqual([CC_EDGE]);
  });

  it("writes one audit event", async () => {
    const d = await ok(await post(sample));
    const audit = await repos.auditEvents.getById(d.auditEventId);
    expect(audit).toMatchObject({ action: "manifest.imported", actor: "platform-eng", subjectId: SAMPLE_REPO_SERVICE_NODE_ID });
    expect(audit.detailsJson).toMatchObject({ suggestedEdgeIds: [CC_EDGE, CH_EDGE], unmatched: ["twilio"], unrecognizedCount: 3 });
  });
});

describe("classification outside the DEMO workspace", () => {
  it("user-supplied manifests are EXTERNAL_OBSERVED; bundled sample content is still called out as fictional", async () => {
    const raw = createRepositories(db, { writeGate: () => undefined, demoResetGate: () => undefined });
    const [ws] = await raw.workspaces.list();
    await raw.workspaces.update(ws!.id, { mode: "RAMP_SANDBOX" });

    const custom = { filename: "package.json", content: JSON.stringify({ name: "svc", dependencies: { "@cloudcomms/sdk": "3.0.0" } }) };
    const d = await ok(await post({ ...sample, files: [custom] }));
    const ev = await repos.evidence.getById(d.suggested[0]!.evidenceId);
    expect(ev).toMatchObject({ kind: "MANIFEST", classification: "EXTERNAL_OBSERVED", verificationStatus: "UNVERIFIED" });
    expect(ev.excerpt).not.toMatch(/Fictional sample file/);
    const entry = await getEvidenceLedgerEntry(repos, ev.id);
    expect(entry).toMatchObject({ classification: "EXTERNAL_OBSERVED", display: { category: "observed", badge: null } });
  });

  it("the bundled sample imported outside DEMO is EXTERNAL_OBSERVED but labelled as a fictional sample", async () => {
    const raw = createRepositories(db, { writeGate: () => undefined, demoResetGate: () => undefined });
    const [ws] = await raw.workspaces.list();
    await raw.workspaces.update(ws!.id, { mode: "RAMP_SANDBOX" });
    const d = await ok(await post(sample));
    const ev = await repos.evidence.getById(d.suggested.find((s) => s.edgeId === CC_EDGE)!.evidenceId);
    expect(ev.classification).toBe("EXTERNAL_OBSERVED");
    expect(ev.excerpt).toMatch(/^Fictional sample file\./);
  });
});

describe("deduplication", () => {
  it("re-importing creates nothing new", async () => {
    await ok(await post(sample));
    const before = await counts();
    const again = await ok(await post(sample));
    expect(again.suggested).toEqual([]);
    expect(again.duplicates.map((x) => [x.edgeId, x.existingStatus])).toEqual([
      [CC_EDGE, "SUGGESTED"],
      [WW_EDGE, "CONFIRMED"],
      [CH_EDGE, "SUGGESTED"],
      [CH_EDGE, "SUGGESTED"],
    ]);
    expect(await counts()).toEqual(before);
  });

  it("a reviewer's REJECT is respected on re-import", async () => {
    await ok(await post(sample));
    const rej = await reviewEdgeHandler(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ decision: "REJECT", reviewer: "sre-lead", justification: "Incident monitoring pages via WebhookWorks only." }) }),
      CC_EDGE,
      { db, env: DEMO },
    );
    expect(rej.status).toBe(200);
    const again = await ok(await post(sample));
    expect(again.duplicates.find((x) => x.edgeId === CC_EDGE)!.existingStatus).toBe("REJECTED");
    expect((await repos.edges.getById(CC_EDGE)).reviewStatus).toBe("REJECTED");
  });
});

describe("unparsed references", () => {
  it("compose anchors/aliases count toward unrecognizedCount", async () => {
    const d = await ok(
      await post({ ...sample, files: [{ filename: "compose.yml", content: "services:\n  a:\n    image: *shared\n  b:\n    image: postgres:16\n" }] }),
    );
    expect(d.unrecognizedCount).toBe(2); // *shared (unparsed) + postgres (no taxonomy match)
    expect(d.suggested).toEqual([]);
  });
});

describe("rejections (nothing is written)", () => {
  const assertUnchanged = async (before: Awaited<ReturnType<typeof counts>>) => {
    expect(await counts()).toEqual(before);
    expect((await repos.auditEvents.list()).filter((a) => a.action === "manifest.imported")).toEqual([]);
  };

  it("malformed, oversize, path-like, unsupported or duplicate files reject the whole import", async () => {
    const before = await counts();
    const cases: [unknown, string | null][] = [
      // Two valid files plus one malformed file: the whole import is rejected before any write.
      [{ ...sample, files: [SAMPLE_REPO_FILES[1], SAMPLE_REPO_FILES[2], { filename: "package.json", content: "{" }] }, "MANIFEST_MALFORMED"],
      [{ ...sample, files: [SAMPLE_REPO_FILES[0], { filename: "main.tf", content: "{" }].concat([{ filename: "other.json", content: "{}" }]) }, "MANIFEST_UNSUPPORTED_FORMAT"],
      [{ ...sample, files: [{ filename: "package.json", content: "{" }] }, "MANIFEST_MALFORMED"],
      [{ ...sample, files: [{ filename: "package.json", content: " ".repeat(MAX_MANIFEST_BYTES + 1) }] }, "MANIFEST_TOO_LARGE"],
      [{ ...sample, files: [{ filename: "../package.json", content: "{}" }] }, "MANIFEST_INVALID_FILENAME"],
      [{ ...sample, files: [{ filename: "requirements.txt", content: "twilio" }] }, "MANIFEST_UNSUPPORTED_FORMAT"],
    ];
    for (const [body, reason] of cases) {
      const res = await post(body);
      expect(res.status, JSON.stringify(reason)).toBe(400);
      if (reason) expect(ApiErrorSchema.parse(await res.json()).error.details).toMatchObject({ reason });
    }
    await assertUnchanged(before);
  });

  it("400 for invalid requests (extra url/path fields, too many files, wrong node kind); 404; 403", async () => {
    const before = await counts();
    for (const body of [
      { ...sample, url: "https://example.com/repo" },
      { ...sample, files: [{ filename: "package.json", content: "{}", path: "/etc/passwd" }] },
      { ...sample, files: [] },
      { ...sample, files: Array.from({ length: 6 }, (_, i) => ({ filename: `m${i}.tf`, content: "" })) },
      { ...sample, files: [SAMPLE_REPO_FILES[0], SAMPLE_REPO_FILES[0]] },
      { ...sample, serviceNodeId: "node-fund-auth" },
      { ...sample, importedBy: "" },
      "{nope",
    ]) {
      expect((await post(body)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect((await post({ ...sample, serviceNodeId: "node-nope" })).status).toBe(404);
    expect((await post(sample, { DEMO_MODE: "false" })).status).toBe(403);
    // Demo mode is checked before the body is read: even garbage is a 403, not a 400.
    expect((await post("{not json", { DEMO_MODE: "false" })).status).toBe(403);
    await assertUnchanged(before);
  });
});

describe("route module", () => {
  it("POST /api/imports/manifest uses getDb()", async () => {
    const g = globalThis as unknown as { __failsafeDb?: PrismaClient };
    const prev = { url: process.env.DATABASE_URL, demo: process.env.DEMO_MODE, now: process.env.DEMO_NOW, db: g.__failsafeDb };
    process.env.DATABASE_URL = url;
    process.env.DEMO_MODE = "true";
    delete process.env.DEMO_NOW;
    g.__failsafeDb = undefined;
    try {
      const route = await import("@/app/api/imports/manifest/route");
      const res = await route.POST(new Request("http://localhost/api/imports/manifest", { method: "POST", body: JSON.stringify(sample) }));
      expect(res.status).toBe(201);
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
