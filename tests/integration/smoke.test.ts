/**
 * FS-21 smoke + hardening regression suite, run through the REAL route modules
 * (src/app/api/**\/route.ts) against a seeded throwaway SQLite DB. No network.
 *
 * 1. Every GET route returns the `{ data, meta }` envelope.
 * 2. Write-route auth table: every POST route is refused (403) without DEMO_MODE / admin
 *    token, and refuses cross-origin browser writes, with nothing written.
 * 3. Body limits: oversized JSON bodies are refused before parsing (declared or streamed).
 * 4. DB failures: every API family answers a generic 500 without stack traces or secrets,
 *    and the server log line is redacted.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { createDbClient, type PrismaClient } from "@/lib/db";
import { resetNorthstarDemo } from "@/lib/demo/northstar";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { checkProvenance } from "@/lib/provenance/check";
import { ApiErrorSchema, ApiMetaSchema, apiSuccessSchema } from "@/lib/schema";
import { MAX_JSON_BODY_BYTES } from "@/app/api/_lib/request";
import { MAX_IMPORT_REQUEST_BYTES } from "@/app/api/_lib/imports";

import * as actionById from "@/app/api/actions/[id]/route";
import * as actionApprove from "@/app/api/actions/[id]/approve/route";
import * as actionReject from "@/app/api/actions/[id]/reject/route";
import * as actionSubmit from "@/app/api/actions/[id]/submit/route";
import * as actionPropose from "@/app/api/actions/propose/route";
import * as actionsList from "@/app/api/actions/route";
import * as alertAck from "@/app/api/alerts/[id]/ack/route";
import * as alertSnooze from "@/app/api/alerts/[id]/snooze/route";
import * as alertsList from "@/app/api/alerts/route";
import * as dashboard from "@/app/api/dashboard/route";
import * as demoReset from "@/app/api/demo/reset/route";
import * as edgeReview from "@/app/api/graph/edges/[id]/review/route";
import * as graph from "@/app/api/graph/route";
import * as manifestImport from "@/app/api/imports/manifest/route";
import * as incidentById from "@/app/api/incidents/[id]/route";
import * as incidentsList from "@/app/api/incidents/route";
import * as aiStatus from "@/app/api/integrations/ai/status/route";
import * as rampStatus from "@/app/api/integrations/ramp/status/route";
import * as rampSync from "@/app/api/integrations/ramp/sync/route";
import * as scenariosList from "@/app/api/scenarios/route";
import * as scenarioRun from "@/app/api/scenarios/run/route";
import * as sourceById from "@/app/api/sources/[id]/route";
import * as sourcesList from "@/app/api/sources/route";

const ROOT = resolve(__dirname, "../..");
const HERO = "inc-charge-cloudcomms-20261119";
const SECRET = "supersecret-db-token-7f3a91";
const Envelope = apiSuccessSchema(z.unknown());
const g = globalThis as unknown as { __failsafeDb?: PrismaClient };
const ENV_KEYS = ["DATABASE_URL", "DEMO_MODE", "DEMO_NOW", "ADMIN_TOKEN", "RAMP_CLIENT_ID", "RAMP_CLIENT_SECRET", "LLM_API_KEY", "LLM_MODEL", "TRUST_PROXY"] as const;

let dir: string;
let url: string;
let db: PrismaClient;
const savedEnv: Record<string, string | undefined> = {};
let savedDb: PrismaClient | undefined;

type Params = { params: Promise<{ id: string }> };
const p = (o: { id: string }): Params => ({ params: Promise.resolve(o) });
const get = (path: string) => new Request(`http://localhost${path}`);
const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-smoke-test-"));
  url = `file:${join(dir, "smoke.db")}`;
  execFileSync(join(ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  db = createDbClient(url);
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  savedDb = g.__failsafeDb;
}, 60_000);

afterAll(async () => {
  g.__failsafeDb = savedDb;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.DATABASE_URL = url;
  process.env.DEMO_MODE = "true";
  process.env.DEMO_NOW = "2026-11-17T16:00:00Z";
  g.__failsafeDb = db; // route modules use getDb()
  await resetNorthstarDemo(db, { env: { DEMO_MODE: "true", DEMO_NOW: "2026-11-17T16:00:00Z" } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const repos = () => createReadOnlyRepositories(db);
const writeCount = async () => {
  const r = repos();
  return { audit: (await r.auditEvents.list()).length, evidence: (await r.evidence.list()).length, sims: (await r.simulations.list()).length };
};

async function proposeOne(): Promise<string> {
  const res = await actionPropose.POST(
    post("/api/actions/propose", {
      incidentId: HERO,
      kind: "INCREASE_AVAILABLE_ALLOCATION",
      payload: { kind: "INCREASE_AVAILABLE_ALLOCATION", fundingSourceId: "fund-auth", amountCents: 60000 },
      rationale: "Cover the modeled $450 shortfall before the charge.",
      proposedBy: "finance-ops",
    }),
  );
  expect(res.status).toBe(201);
  return (Envelope.parse(await res.json()).data as { action: { id: string } }).action.id;
}

describe("1. every GET route returns the { data, meta } envelope", () => {
  it("all 12 GET routes", async () => {
    const actionId = await proposeOne();
    const evidenceId = (await repos().evidence.list())[0]!.id;
    const calls: [string, () => Promise<Response>][] = [
      ["GET /api/dashboard", () => dashboard.GET()],
      ["GET /api/graph", () => graph.GET()],
      ["GET /api/incidents", () => incidentsList.GET(get("/api/incidents"))],
      ["GET /api/incidents/[id]", () => incidentById.GET(get(`/api/incidents/${HERO}`), p({ id: HERO }))],
      ["GET /api/sources", () => sourcesList.GET(get("/api/sources"))],
      ["GET /api/sources/[id]", () => sourceById.GET(get(`/api/sources/${evidenceId}`), p({ id: evidenceId }))],
      ["GET /api/scenarios", () => scenariosList.GET(get("/api/scenarios"))],
      ["GET /api/actions", () => actionsList.GET(get("/api/actions"))],
      ["GET /api/actions/[id]", () => actionById.GET(get(`/api/actions/${actionId}`), p({ id: actionId }))],
      ["GET /api/alerts", () => alertsList.GET(get("/api/alerts"))],
      ["GET /api/integrations/ai/status", () => aiStatus.GET()],
      ["GET /api/integrations/ramp/status", () => rampStatus.GET()],
    ];
    for (const [name, call] of calls) {
      const res = await call();
      expect(res.status, name).toBe(200);
      expect(res.headers.get("cache-control"), name).toBe("no-store");
      const env = Envelope.parse(await res.json());
      expect(env.data, name).not.toBeNull();
      expect(ApiMetaSchema.parse(env.meta).workspaceMode, name).toBe("DEMO");
    }
  });

  it("unknown ids are a 404 error envelope, not a crash", async () => {
    for (const res of [
      await incidentById.GET(get("/api/incidents/inc-nope"), p({ id: "inc-nope" })),
      await sourceById.GET(get("/api/sources/ev-nope"), p({ id: "ev-nope" })),
      await actionById.GET(get("/api/actions/act-nope"), p({ id: "act-nope" })),
    ]) {
      expect(res.status).toBe(404);
      expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("NOT_FOUND");
    }
  });

  it("the seeded demo passes the provenance checker (zero dangling assertions)", async () => {
    const report = await checkProvenance(db);
    expect(report.ok).toBe(true);
  });
});

// Route -> gate. `gate` names the server check that protects it.
const WRITE_ROUTES: { route: string; gate: string; call: (r: Request) => Promise<Response>; path: string }[] = [
  { route: "POST /api/actions/propose", gate: "DEMO_MODE", path: "/api/actions/propose", call: (r) => actionPropose.POST(r) },
  { route: "POST /api/actions/[id]/submit", gate: "DEMO_MODE", path: "/api/actions/a/submit", call: (r) => actionSubmit.POST(r, p({ id: "act-x" })) },
  { route: "POST /api/actions/[id]/approve", gate: "DEMO_MODE", path: "/api/actions/a/approve", call: (r) => actionApprove.POST(r, p({ id: "act-x" })) },
  { route: "POST /api/actions/[id]/reject", gate: "DEMO_MODE", path: "/api/actions/a/reject", call: (r) => actionReject.POST(r, p({ id: "act-x" })) },
  { route: "POST /api/alerts/[id]/ack", gate: "DEMO_MODE", path: "/api/alerts/a/ack", call: (r) => alertAck.POST(r, p({ id: "alert-x" })) },
  { route: "POST /api/alerts/[id]/snooze", gate: "DEMO_MODE", path: "/api/alerts/a/snooze", call: (r) => alertSnooze.POST(r, p({ id: "alert-x" })) },
  { route: "POST /api/graph/edges/[id]/review", gate: "DEMO_MODE", path: "/api/graph/edges/e/review", call: (r) => edgeReview.POST(r, p({ id: "edge-x" })) },
  { route: "POST /api/imports/manifest", gate: "DEMO_MODE", path: "/api/imports/manifest", call: (r) => manifestImport.POST(r) },
  { route: "POST /api/scenarios/run", gate: "DEMO_MODE", path: "/api/scenarios/run", call: (r) => scenarioRun.POST(r) },
  { route: "POST /api/integrations/ramp/sync", gate: "DEMO_MODE or ADMIN_TOKEN", path: "/api/integrations/ramp/sync", call: (r) => rampSync.POST(r) },
  { route: "POST /api/demo/reset", gate: "DEMO_MODE + local same-origin", path: "/api/demo/reset", call: (r) => demoReset.POST(r) },
];
const JSON_WRITE_ROUTES = WRITE_ROUTES.filter((w) => !/ramp\/sync|demo\/reset|imports\/manifest/.test(w.route));

describe("2. write-route auth table", () => {
  it("covers every POST route module", () => {
    expect(WRITE_ROUTES).toHaveLength(11);
  });

  it("every write route is 403 without DEMO_MODE and without a valid admin token; nothing is written", async () => {
    delete process.env.DEMO_MODE;
    process.env.RAMP_CLIENT_ID = "cid"; // so Ramp sync reaches its write gate (not 503 NOT_CONFIGURED)
    process.env.RAMP_CLIENT_SECRET = "csecret";
    process.env.ADMIN_TOKEN = "a-very-long-admin-token-1234";
    const before = await writeCount();
    for (const w of WRITE_ROUTES) {
      for (const headers of [{}, { "x-failsafe-admin-token": "wrong-token-wrong-token" }] as Record<string, string>[]) {
        const res = await w.call(post(w.path, { anything: true }, headers));
        expect(res.status, `${w.route} ${JSON.stringify(headers)}`).toBe(403);
        expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("FORBIDDEN");
      }
    }
    expect(await writeCount()).toEqual(before);
  });

  it("every write route refuses cross-origin / cross-site browser requests (CSRF), even in demo mode", async () => {
    const before = await writeCount();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    process.env.RAMP_CLIENT_ID = "cid";
    process.env.RAMP_CLIENT_SECRET = "csecret";
    for (const w of WRITE_ROUTES) {
      for (const headers of [{ origin: "https://evil.example" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }, { origin: "http://localhost:9999" }, { origin: "https://evil.example", "x-forwarded-host": "evil.example" }] as Record<string, string>[]) {
        const res = await w.call(post(w.path, {}, headers));
        expect(res.status, `${w.route} ${JSON.stringify(headers)}`).toBe(403);
      }
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await writeCount()).toEqual(before);
  });

  it("X-Forwarded-Host counts only with TRUST_PROXY=true", async () => {
    const run = () =>
      scenarioRun.POST(
        post(
          "/api/scenarios/run",
          { incidentId: HERO, patch: { kind: "INCREASE_AVAILABLE_ALLOCATION", fundingSourceId: "fund-auth", amountCents: 60000 } },
          { origin: "https://demo.example.app", "x-forwarded-host": "demo.example.app" },
        ),
      );
    expect((await run()).status).toBe(403);
    process.env.TRUST_PROXY = "true";
    try {
      expect((await run()).status).toBe(201);
    } finally {
      delete process.env.TRUST_PROXY;
    }
  });

  it("same-origin browser requests are accepted (Origin matches Host)", async () => {
    const res = await scenarioRun.POST(
      post("/api/scenarios/run", { incidentId: HERO, patch: { kind: "INCREASE_AVAILABLE_ALLOCATION", fundingSourceId: "fund-auth", amountCents: 60000 } }, { origin: "http://localhost", "sec-fetch-site": "same-origin" }),
    );
    expect(res.status).toBe(201);
  });
});

describe("3. body size limits", () => {
  const big = { padding: "x".repeat(MAX_JSON_BODY_BYTES + 10) };

  it("every JSON write route refuses a body over the limit before parsing", async () => {
    const before = await writeCount();
    for (const w of JSON_WRITE_ROUTES) {
      const res = await w.call(post(w.path, big));
      expect(res.status, w.route).toBe(400);
      expect(ApiErrorSchema.parse(await res.json()).error).toMatchObject({ details: { reason: "BODY_TOO_LARGE", limitBytes: MAX_JSON_BODY_BYTES } });
    }
    expect(await writeCount()).toEqual(before);
  });

  it("a streamed body with no Content-Length is cut off at the limit", async () => {
    const chunk = new TextEncoder().encode("x".repeat(4096));
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 1;
        if (pulled > 1000) c.close();
        else c.enqueue(chunk);
      },
    });
    const req = new Request("http://localhost/api/scenarios/run", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    const res = await scenarioRun.POST(req);
    expect(res.status).toBe(400);
    expect(pulled).toBeLessThan(20); // stopped reading early (16 KiB / 4 KiB chunks)
  });

  it("a declared Content-Length over the limit is refused without reading (manifest import has its own larger limit)", async () => {
    const res = await manifestImport.POST(
      new Request("http://localhost/api/imports/manifest", { method: "POST", headers: { "content-length": String(MAX_IMPORT_REQUEST_BYTES + 1) }, body: "{}" }),
    );
    expect(res.status).toBe(400);
    expect(ApiErrorSchema.parse(await res.json()).error.details).toMatchObject({ reason: "MANIFEST_TOO_LARGE" });
  });
});

describe("4. DB failures never leak stack traces or secrets", () => {
  /** A Prisma-like client whose every call fails with a secret-bearing, stack-like message. */
  function brokenDb(): PrismaClient {
    const fail = () => {
      const e = new Error(`SQLITE_CANTOPEN: unable to open libsql://db.example/x?authToken=${SECRET} (Bearer ${SECRET})\n    at Object.<anonymous> (/Users/someone/app/node_modules/@prisma/client/runtime.js:1:1)`);
      (e as { code?: string }).code = "P1001";
      throw e;
    };
    const callable: object = new Proxy(function () {}, {
      get: (_t, prop) => (prop === "then" ? undefined : callable),
      apply: fail,
    });
    return new Proxy({}, { get: (_t, prop) => (prop === "then" ? undefined : callable) }) as PrismaClient;
  }

  it("one route per API family: generic 500 body, redacted log", async () => {
    g.__failsafeDb = brokenDb();
    process.env.RAMP_CLIENT_ID = "cid";
    process.env.RAMP_CLIENT_SECRET = "csecret";
    process.env.ADMIN_TOKEN = SECRET; // its exact value is redacted too
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(" "));
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const families: [string, () => Promise<Response>][] = [
      ["dashboard", () => dashboard.GET()],
      ["graph", () => graph.GET()],
      ["graph review", () => edgeReview.POST(post("/x", { decision: "CONFIRM", reviewer: "sre-lead", justification: "Checked the call path in code." }), p({ id: "edge-x" }))],
      ["incidents", () => incidentsList.GET(get("/api/incidents"))],
      ["incident", () => incidentById.GET(get(`/api/incidents/${HERO}`), p({ id: HERO }))],
      ["sources", () => sourcesList.GET(get("/api/sources"))],
      ["scenarios", () => scenariosList.GET(get("/api/scenarios"))],
      ["scenario run", () => scenarioRun.POST(post("/x", { incidentId: HERO, patch: { kind: "INCREASE_AVAILABLE_ALLOCATION", fundingSourceId: "fund-auth", amountCents: 100 } }))],
      ["actions", () => actionsList.GET(get("/api/actions"))],
      ["alerts", () => alertsList.GET(get("/api/alerts"))],
      ["alert ack", () => alertAck.POST(post("/x", { actor: "ops-lead" }), p({ id: "alert-x" }))],
      ["manifest import", () => manifestImport.POST(post("/x", { serviceNodeId: "node-service-x", importedBy: "platform-eng", files: [{ filename: "package.json", content: "{}" }] }))],
      ["ai status", () => aiStatus.GET()],
      ["ramp status", () => rampStatus.GET()],
      ["ramp sync", () => rampSync.POST(post("/x"))],
      ["demo reset", () => demoReset.POST(new Request("http://localhost/api/demo/reset", { method: "POST" }))],
    ];
    for (const [name, call] of families) {
      const res = await call();
      const text = await res.text();
      expect(res.status, name).toBe(500);
      expect(JSON.parse(text), name).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal error" } });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logged.length).toBeGreaterThanOrEqual(families.length);
    for (const line of logged) {
      expect(line).not.toContain(SECRET);
      expect(line).toMatch(/^\[api\] Error \[P1001\]: SQLITE_CANTOPEN/);
    }
  });
});
