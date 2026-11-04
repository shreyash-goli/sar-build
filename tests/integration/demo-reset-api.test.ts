/** FS-17 backend: POST /api/demo/reset against a throwaway seeded SQLite DB. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbClient, type PrismaClient } from "@/lib/db";
import { seedNorthstarDemo } from "@/lib/demo/northstar";
import { DemoResetDataSchema } from "@/lib/demo/reset-schema";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { createRepositories, type Repositories } from "@/lib/repositories";
import { ApiErrorSchema, apiSuccessSchema } from "@/lib/schema";
import { demoResetHandler } from "@/app/api/_lib/demo-reset";

const ROOT = resolve(__dirname, "../..");
const DEMO = { DEMO_MODE: "true" } as const;
const Envelope = apiSuccessSchema(DemoResetDataSchema);

let dir: string;
let url: string;
let db: PrismaClient;
let repos: Repositories;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-reset-test-"));
  url = `file:${join(dir, "reset.db")}`;
  execFileSync(join(ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  db = createDbClient(url);
  repos = createReadOnlyRepositories(db);
  await seedNorthstarDemo(db, { env: DEMO });
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

let info: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  return () => info.mockRestore();
});

const reset = (headers: Record<string, string> = {}, env: Record<string, string | undefined> = DEMO, body?: string, base = "http://localhost:3000") =>
  demoResetHandler(new Request(`${base}/api/demo/reset`, { method: "POST", headers: { host: "localhost:3000", ...headers }, body }), { db, env });

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

describe("authorized local reset", () => {
  it("200 with cleared/recreated counts and regenerated incidents; logged server-side", async () => {
    const res = await reset({ origin: "http://localhost:3000", "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(200);
    const { data } = Envelope.parse(await res.json());
    expect(data.fixture).toEqual({ id: "northstar-demo", version: 1 });
    expect(data.recreated).toEqual({ workspaces: 1, evidence: 49, fundingSources: 3, paymentInstruments: 3, vendors: 4, vendorCharges: 3, transactions: 3, nodes: 18, edges: 15 });
    expect(data.cleared).toMatchObject({ workspaces: 1, nodes: 18, edges: 15, incidents: 4 });
    expect(data.incidents).toEqual({
      regenerated: 4,
      incidentIds: ["inc-charge-cloudcomms-20261119", "inc-charge-computeharbor-20261121", "inc-charge-metricsrelay-20261124", "inc-tx-webhookworks-20261116"],
      evaluatedAt: "2026-11-17T16:00:00Z",
    });
    expect(info).toHaveBeenCalledWith("[demo-reset]", expect.stringContaining('"incidents":4'));
  });

  it("T-20: two resets in a row yield identical logical state, also after user activity", async () => {
    // Some user activity that reset must clear.
    const writer = createRepositories(db, { writeGate: () => undefined, demoResetGate: () => undefined });
    await writer.fundingSources.update("fund-auth", { availableCents: 1 });
    await reset();
    const first = await snapshot();
    await reset();
    expect(await snapshot()).toEqual(first);
    expect((await repos.fundingSources.getById("fund-auth")).availableCents).toBe(200000);
    expect(first.simulations).toEqual([]);
    expect(first.auditEvents).toEqual([]);
  });

  it("accepts loopback hosts and allow-listed hosts; an empty {} body is fine", async () => {
    for (const host of ["127.0.0.1:3000", "[::1]:3000", "localhost"]) expect((await reset({ host })).status, host).toBe(200);
    expect((await reset({ host: "demo-box.lan:3000" }, { ...DEMO, DEMO_RESET_ALLOWED_HOSTS: "demo-box.lan, other.lan" })).status).toBe(200);
    expect((await reset({}, DEMO, "{}")).status).toBe(200);
  });

  it("allow-list entries are normalized like the Host header (scheme, port, case, IPv6 brackets)", async () => {
    const env = { ...DEMO, DEMO_RESET_ALLOWED_HOSTS: " Demo.Local:3000 , http://box.lan:8080/ ,[fd00::1]:3000" };
    const { allowedResetHosts } = await import("@/app/api/_lib/demo-reset");
    expect([...allowedResetHosts(env)].sort()).toEqual(["127.0.0.1", "::1", "box.lan", "demo.local", "fd00::1", "localhost"]);
    expect((await reset({ host: "demo.local:3000" }, env)).status).toBe(200);
    expect((await reset({ host: "DEMO.LOCAL" }, env)).status).toBe(200);
    expect((await reset({ host: "box.lan:3000", origin: "http://box.lan:3000" }, env)).status).toBe(200);
    expect((await reset({ host: "[fd00::1]:3000" }, env)).status).toBe(200);
    expect((await reset({ host: "evil.local:3000" }, env)).status).toBe(403);
  });

  it("wildcard entries are rejected, never treated as patterns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { allowedResetHosts } = await import("@/app/api/_lib/demo-reset");
    const env = { ...DEMO, DEMO_RESET_ALLOWED_HOSTS: "*, *.lan, demo?.lan, http://*:3000, box.lan" };
    expect([...allowedResetHosts(env)].sort()).toEqual(["127.0.0.1", "::1", "box.lan", "localhost"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("wildcard"), "*, *.lan, demo?.lan, http://*:3000");
    for (const host of ["anything.example", "demo.lan", "demo1.lan", "evil.com:3000"]) {
      expect((await reset({ host }, env)).status, host).toBe(403);
    }
    expect((await reset({ host: "box.lan" }, env)).status).toBe(200);
    expect((await reset({ host: "anything" }, { ...DEMO, DEMO_RESET_ALLOWED_HOSTS: "*" })).status).toBe(403);
    warn.mockRestore();
  });
});

describe("refusals (nothing changes)", () => {
  it("403 when DEMO_MODE is off, whatever the client sends", async () => {
    const before = await snapshot();
    for (const env of [{ DEMO_MODE: "false" }, {}, { DEMO_MODE: "" }]) {
      const res = await reset({ "x-demo-mode": "true" }, env);
      expect(res.status).toBe(403);
      expect(ApiErrorSchema.parse(await res.json()).error).toMatchObject({ code: "FORBIDDEN", message: "Demo reset requires DEMO_MODE=true on the server" });
    }
    expect(await snapshot()).toEqual(before);
  });

  it("403 for a non-local host, a cross-origin Origin, an opaque origin or a cross-site fetch", async () => {
    const before = await snapshot();
    const cases: Record<string, string>[] = [
      { host: "failsafe.example.com" },
      { host: "10.0.0.5:3000" },
      { host: "localhost.evil.com" },
      { origin: "https://evil.example" },
      { origin: "null" },
      { "sec-fetch-site": "cross-site" },
    ];
    for (const headers of cases) {
      const res = await reset(headers);
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("FORBIDDEN");
    }
    // An allow-list entry does not open other hosts.
    expect((await reset({ host: "evil.lan" }, { ...DEMO, DEMO_RESET_ALLOWED_HOSTS: "demo-box.lan" })).status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });

  it("400 for a request body (the endpoint takes none)", async () => {
    expect((await reset({}, DEMO, JSON.stringify({ force: true }))).status).toBe(400);
  });
});

describe("route module", () => {
  it("POST /api/demo/reset uses getDb() and process.env", async () => {
    const g = globalThis as unknown as { __failsafeDb?: PrismaClient };
    const prev = { url: process.env.DATABASE_URL, demo: process.env.DEMO_MODE, now: process.env.DEMO_NOW, db: g.__failsafeDb };
    process.env.DATABASE_URL = url;
    process.env.DEMO_MODE = "true";
    delete process.env.DEMO_NOW;
    g.__failsafeDb = undefined;
    try {
      const route = await import("@/app/api/demo/reset/route");
      const ok = await route.POST(new Request("http://localhost:3000/api/demo/reset", { method: "POST", headers: { host: "localhost:3000" } }));
      expect(ok.status).toBe(200);
      process.env.DEMO_MODE = "false";
      const off = await route.POST(new Request("http://localhost:3000/api/demo/reset", { method: "POST", headers: { host: "localhost:3000" } }));
      expect(off.status).toBe(403);
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
