/**
 * FS-18 read-only Ramp adapter against a FAKE Ramp API (injected fetch; no network) and a
 * throwaway SQLite DB. Live sandbox sync is BLOCKED (no credentials) and is not attempted.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, type PrismaClient } from "@/lib/db";
import { resetNorthstarDemo } from "@/lib/demo/northstar";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { RampApiError, RampReadOnlyClient } from "@/lib/providers/ramp/client";
import { readRampConfig } from "@/lib/providers/ramp/config";
import { RampStatusSchema, RampSyncResultSchema } from "@/lib/providers/ramp/schema";
import { createRepositories, type Repositories } from "@/lib/repositories";
import { ApiErrorSchema, apiSuccessSchema } from "@/lib/schema";
import { rampStatusHandler, rampSyncHandler } from "@/app/api/_lib/ramp";

const ROOT = resolve(__dirname, "../..");
const BASE = "https://demo-api.ramp.com";
const RAMP_ENV = { DEMO_MODE: "true", RAMP_CLIENT_ID: "cid", RAMP_CLIENT_SECRET: "csecret" } as const;
const SyncEnvelope = apiSuccessSchema(RampSyncResultSchema);
const StatusEnvelope = apiSuccessSchema(RampStatusSchema);

let dir: string;
let url: string;
let db: PrismaClient;
let repos: Repositories;

// ---------- Fake Ramp API ----------
type FakeOpts = {
  tokenStatus?: number;
  failFirstDataWith401?: boolean;
  rateLimitOnce?: boolean;
  virtualStatus?: number;
  cardsWithPan?: boolean;
  pendingThenCleared?: "PENDING" | "CLEARED";
};
type Logged = { method: string; path: string; search: string; auth: string | null; body: string | null };

function fakeRamp(o: FakeOpts = {}) {
  const log: Logged[] = [];
  let issued = 0;
  let saw401 = false;
  let saw429 = false;
  const fund = { id: "f1", display_name: "Engineering tools", state: "ACTIVE", spending_restrictions: { interval: "MONTHLY", limit: { amount: 500000, currency_code: "USD" } }, balance: { total: { amount: 120000, currency_code: "USD" } } };
  const card = { id: "c1", display_name: "Eng SaaS card", state: "ACTIVE", fund_id: "f1", last_four: "4242", ...(o.cardsWithPan ? { card_number: "4242424242424242" } : {}) };
  const tx = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
    id,
    state,
    entity_amount: { value: 12000, currency: "USD" },
    user_transaction_time: "2026-11-15T12:00:00Z",
    merchant_id: "m-cloudco",
    merchant_name: "CloudCo",
    card_id: "c1",
    fund_id: "f1",
    ...extra,
  });
  const allPage1 = [tx("t1", "CLEARED"), tx("t2", o.pendingThenCleared ?? "PENDING", { entity_amount: { value: 3000, currency: "USD" } })];
  const allPage2 = [tx("t3", "CLEARED", { entity_amount: null }), tx("t4", "CLEARED", { entity_amount: { value: 999, currency: "EUR" } })];
  const declined = [tx("t9", "DECLINED", { decline_details: { reason: "INSUFFICIENT_FUNDS" }, entity_amount: { value: 45000, currency: "USD" } }), allPage1[0]];

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const f = (async (input: string, init: RequestInit = {}) => {
    const u = new URL(input);
    const headers = (init.headers ?? {}) as Record<string, string>;
    log.push({ method: init.method ?? "GET", path: u.pathname, search: u.search, auth: headers.authorization ?? null, body: (init.body as string) ?? null });
    if (u.origin !== BASE) return json({ error: "wrong host" }, 404);
    if (u.pathname === "/developer/v1/token") {
      if (init.method !== "POST") return json({}, 405);
      if (o.tokenStatus) return json({ error_v2: { error_code: "DEVELOPER_7012" } }, o.tokenStatus);
      issued += 1;
      return json({ access_token: `ramp_business_tok_${issued}`, token_type: "Bearer", expires_in: 864000, scope: "transactions:read cards:read funds:read" });
    }
    if ((init.method ?? "GET") !== "GET") return json({}, 405);
    if (o.failFirstDataWith401 && !saw401) {
      saw401 = true;
      return json({}, 401);
    }
    if (o.rateLimitOnce && !saw429) {
      saw429 = true;
      return json({}, 429, { "retry-after": "2" });
    }
    const state = u.searchParams.get("state");
    switch (u.pathname) {
      case "/developer/v1/funds":
        return json({ data: [fund], page: { next: null } });
      case "/developer/v1/cards/physical":
        return json({ data: [card], page: { next: null } });
      case "/developer/v1/cards/virtual":
        return o.virtualStatus ? json({}, o.virtualStatus) : json({ data: [], page: { next: null } });
      case "/developer/v1/transactions":
        if (state === "DECLINED") return json({ data: declined, page: { next: null } });
        if (u.searchParams.get("start") === "p2") return json({ data: allPage2, page: { next: null } });
        return json({ data: allPage1, page: { next: `${BASE}/developer/v1/transactions?state=ALL&page_size=100&start=p2` } });
      default:
        return json({}, 404);
    }
  }) as unknown as typeof fetch;
  return { fetch: f, log, tokensIssued: () => issued };
}

// ---------- DB helpers ----------
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-ramp-test-"));
  url = `file:${join(dir, "ramp.db")}`;
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

async function sandboxWorkspace() {
  const allow = () => undefined;
  const w = createRepositories(db, { writeGate: allow, demoResetGate: allow });
  await w.demoReset.clearAllData();
  await w.workspaces.create({ id: "ws-ramp-sandbox", name: "Ramp sandbox (read-only)", mode: "RAMP_SANDBOX" });
}
const sync = (fake: ReturnType<typeof fakeRamp>, env: Record<string, string | undefined> = RAMP_ENV, headers: Record<string, string> = {}, sleeps: number[] = []) =>
  rampSyncHandler(new Request("http://localhost/api/integrations/ramp/sync", { method: "POST", headers }), {
    db,
    env,
    fetch: fake.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
const counts = async () => ({
  funds: (await repos.fundingSources.list()).length,
  cards: (await repos.paymentInstruments.list()).length,
  vendors: (await repos.vendors.list()).length,
  transactions: (await repos.transactions.list()).length,
  nodes: (await repos.nodes.list()).length,
  edges: (await repos.edges.list()).length,
  evidence: (await repos.evidence.list()).length,
});

describe("gates (no request is made to Ramp)", () => {
  beforeEach(async () => {
    await resetNorthstarDemo(db, { env: { DEMO_MODE: "true" } });
  });

  it("not configured: 503 NOT_CONFIGURED and zero fetch calls", async () => {
    const fake = fakeRamp();
    const res = await sync(fake, { DEMO_MODE: "true" });
    expect(res.status).toBe(503);
    expect(ApiErrorSchema.parse(await res.json()).error).toMatchObject({
      code: "NOT_CONFIGURED",
      details: { reason: "RAMP_NOT_CONFIGURED", missing: ["RAMP_CLIENT_ID", "RAMP_CLIENT_SECRET"] },
    });
    expect(fake.log).toEqual([]);
  });

  it("configured but DEMO workspace: 409 (demo and Ramp data are never mixed)", async () => {
    const fake = fakeRamp();
    const res = await sync(fake);
    expect(res.status).toBe(409);
    expect(ApiErrorSchema.parse(await res.json()).error.message).toMatch(/pnpm ramp:init/);
    expect(fake.log).toEqual([]);
  });

  it("write gate: 403 without DEMO_MODE or a valid admin token", async () => {
    await sandboxWorkspace();
    const fake = fakeRamp();
    const env = { RAMP_CLIENT_ID: "cid", RAMP_CLIENT_SECRET: "csecret", ADMIN_TOKEN: "a-very-long-admin-token-1234" };
    expect((await sync(fake, env)).status).toBe(403);
    expect(fake.log).toEqual([]);
    expect((await sync(fake, env, { "x-failsafe-admin-token": "a-very-long-admin-token-1234" })).status).toBe(200);
  });

  it("only the sandbox host is supported: production and other hosts are NOT_CONFIGURED (no allow-list)", async () => {
    const prod = readRampConfig({ RAMP_CLIENT_ID: "a", RAMP_CLIENT_SECRET: "b", RAMP_API_BASE_URL: "https://api.ramp.com" });
    expect(prod).toMatchObject({ status: "NOT_CONFIGURED", missing: ["RAMP_API_BASE_URL"] });
    expect(prod.status === "NOT_CONFIGURED" && prod.reason).toMatch(/^Only the Ramp sandbox is supported in this MVP/);
    // The removed RAMP_ALLOW_BASE_URLS has no effect.
    expect(readRampConfig({ RAMP_CLIENT_ID: "a", RAMP_CLIENT_SECRET: "b", RAMP_API_BASE_URL: "https://api.ramp.com", RAMP_ALLOW_BASE_URLS: "https://api.ramp.com" }).status).toBe("NOT_CONFIGURED");
    expect(readRampConfig({ RAMP_CLIENT_ID: "a", RAMP_CLIENT_SECRET: "b", RAMP_API_BASE_URL: "https://demo-api.ramp.com/" })).toMatchObject({ status: "CONFIGURED", sandbox: true });
    // Through the API: 503 before any request, with the reason.
    await sandboxWorkspace();
    const fake = fakeRamp();
    const res = await sync(fake, { ...RAMP_ENV, RAMP_API_BASE_URL: "https://api.ramp.com" });
    expect(res.status).toBe(503);
    expect(ApiErrorSchema.parse(await res.json()).error.message).toMatch(/Only the Ramp sandbox is supported in this MVP/);
    expect(fake.log).toEqual([]);
    expect(readRampConfig({ RAMP_CLIENT_ID: "a", RAMP_CLIENT_SECRET: "b" })).toMatchObject({ status: "CONFIGURED", baseUrl: BASE, sandbox: true });
    expect(readRampConfig({ RAMP_CLIENT_ID: "a", RAMP_CLIENT_SECRET: "b", RAMP_API_BASE_URL: "http://demo-api.ramp.com" }).status).toBe("NOT_CONFIGURED");
  });
});

describe("sync against the fake API", () => {
  beforeEach(sandboxWorkspace);

  it("reads funds, cards and transactions (incl. declines); normalizes honestly; PARTIAL when something is skipped", async () => {
    const fake = fakeRamp({ virtualStatus: 404 });
    const res = await sync(fake);
    expect(res.status).toBe(200);
    const d = SyncEnvelope.parse(await res.json()).data;
    expect(d.label).toBe("READ-ONLY RAMP SANDBOX");
    expect(d.status).toBe("PARTIAL");
    expect(d.resources.funds).toMatchObject({ status: "OK", fetched: 1, created: 1 });
    expect(d.resources.cards).toMatchObject({ status: "PARTIAL", fetched: 1, created: 1 });
    expect(d.resources.cards.error).toMatch(/virtual: HTTP_ERROR/);
    expect(d.resources.transactions).toMatchObject({ status: "PARTIAL", fetched: 5, created: 3 });
    expect(d.resources.transactions.skipped).toEqual([
      { id: "t3", reason: "amount unknown (entity_amount is null)" },
      { id: "t4", reason: "amount not integer USD minor units (EUR)" },
    ]);

    const fundRow = await repos.fundingSources.getById("ramp-fund-f1");
    expect(fundRow).toMatchObject({ provider: "RAMP", externalFundId: "f1", interval: "MONTHLY", limitCents: 500000, availableCents: null });
    expect(await repos.paymentInstruments.getById("ramp-card-c1")).toMatchObject({ kind: "PHYSICAL_CARD", externalCardId: "c1", fundingSourceId: "ramp-fund-f1", status: "ACTIVE" });
    expect(await repos.vendors.getById("vendor-ramp-m-cloudco")).toMatchObject({ name: "CloudCo", billingMethod: "UNKNOWN" });
    const declined = await repos.transactions.getById("ramp-tx-t9");
    expect(declined).toMatchObject({ state: "DECLINED", reason: "INSUFFICIENT_FUNDS", amountCents: 45000, providerEventId: "t9", fundingSourceId: "ramp-fund-f1" });
    expect(await repos.transactions.findById("ramp-tx-t3")).toBeNull();

    const ev = await repos.evidence.getById(declined.evidenceId);
    expect(ev).toMatchObject({ kind: "API", classification: "RAMP_SANDBOX", sourceSystem: "ramp-sandbox", verificationStatus: "UNVERIFIED", observedAt: "2026-11-15T12:00:00Z" });
    expect(ev.excerpt).toMatch(/^Read-only Ramp sandbox read\./);

    // Graph: financial nodes only, links SUGGESTED (the business graph is not supplied by Ramp).
    const edges = await repos.edges.list();
    expect(edges.map((e) => [e.id, e.relation, e.reviewStatus]).sort()).toEqual([
      ["edge-ramp-card-c1--vendor-ramp-m-cloudco", "PAYS", "SUGGESTED"],
      ["edge-ramp-fund-f1--ramp-card-c1", "BACKS", "SUGGESTED"],
    ]);
    // Risk: the decline is an OBSERVED_DECLINE, UNKNOWN severity until dependencies are mapped.
    const inc = await repos.incidents.findByScenarioKey("transaction:ramp-tx-t9");
    expect(inc).toMatchObject({ severity: "UNKNOWN", detectionRule: "observed-decline-v1" });

    // Safety: only GETs to allow-listed paths plus ONE token POST; declines requested explicitly.
    expect(fake.log.filter((l) => l.method !== "GET").map((l) => l.path)).toEqual(["/developer/v1/token"]);
    expect(fake.log.some((l) => /vault/.test(l.path))).toBe(false);
    expect(fake.tokensIssued()).toBe(1);
    expect(fake.log.filter((l) => l.path === "/developer/v1/transactions").map((l) => new URLSearchParams(l.search).get("state"))).toEqual(["ALL", "ALL", "DECLINED"]);
    const tokenReq = fake.log.find((l) => l.path === "/developer/v1/token")!;
    expect(tokenReq.auth).toBe(`Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    expect(new URLSearchParams(tokenReq.body!).get("grant_type")).toBe("client_credentials");
    expect(new URLSearchParams(tokenReq.body!).get("scope")).toBe("transactions:read cards:read funds:read");
    expect(new URLSearchParams(tokenReq.body!).get("scope")).not.toMatch(/vault/);
  });

  it("re-sync is idempotent; a changed record is updated with NEW evidence (old kept)", async () => {
    await sync(fakeRamp());
    const before = await counts();
    const again = SyncEnvelope.parse(await (await sync(fakeRamp())).json()).data;
    expect(again.resources.funds).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(again.resources.transactions).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
    expect(await counts()).toEqual(before);

    const oldEvidence = (await repos.transactions.getById("ramp-tx-t2")).evidenceId;
    const changed = SyncEnvelope.parse(await (await sync(fakeRamp({ pendingThenCleared: "CLEARED" }))).json()).data;
    expect(changed.resources.transactions).toMatchObject({ updated: 1 });
    const t2 = await repos.transactions.getById("ramp-tx-t2");
    expect(t2.state).toBe("CLEARED");
    expect(t2.evidenceId).not.toBe(oldEvidence);
    expect(await repos.evidence.findById(oldEvidence)).not.toBeNull();
  });

  it("401 refreshes the token once; 429 honours Retry-After", async () => {
    const f401 = fakeRamp({ failFirstDataWith401: true });
    expect(SyncEnvelope.parse(await (await sync(f401)).json()).data.resources.funds.status).toBe("OK");
    expect(f401.tokensIssued()).toBe(2);

    const sleeps: number[] = [];
    const f429 = fakeRamp({ rateLimitOnce: true });
    expect(SyncEnvelope.parse(await (await sync(f429, RAMP_ENV, {}, sleeps)).json()).data.resources.funds.status).toBe("OK");
    expect(sleeps).toEqual([2000]);
  });

  it("card payloads containing PAN-like fields are refused, not stored", async () => {
    const d = SyncEnvelope.parse(await (await sync(fakeRamp({ cardsWithPan: true }))).json()).data;
    expect(d.resources.cards.status).toBe("FAILED");
    expect(d.resources.cards.error).toMatch(/SECRET_FIELDS/);
    expect(await repos.paymentInstruments.list()).toEqual([]);
  });

  it("token failure: FAILED, nothing synced, never reported as success", async () => {
    const res = await sync(fakeRamp({ tokenStatus: 401 }));
    expect(res.status).toBe(502);
    const d = SyncEnvelope.parse(await res.json()).data;
    expect(d.status).toBe("FAILED");
    for (const r of Object.values(d.resources)) expect(r).toMatchObject({ status: "FAILED", created: 0 });
    expect(d.incidents).toBeNull();
    expect((await counts()).transactions).toBe(0);
  });
});

describe("client guard", () => {
  it("refuses page.next to another host or a non-allow-listed path", async () => {
    const cfg = readRampConfig(RAMP_ENV);
    if (cfg.status !== "CONFIGURED") throw new Error("expected configured");
    const evilNext = (async (input: string, init: RequestInit = {}) => {
      const u = new URL(input);
      if (u.pathname === "/developer/v1/token") return new Response(JSON.stringify({ access_token: "t", expires_in: 100 }), { status: 200 });
      void init;
      return new Response(JSON.stringify({ data: [], page: { next: "https://evil.example/developer/v1/funds" } }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(new RampReadOnlyClient(cfg, { fetch: evilNext }).listAll("/developer/v1/funds")).rejects.toMatchObject({ code: "BLOCKED_REQUEST" });
    const vaultNext = (async (input: string) => {
      const u = new URL(input);
      if (u.pathname === "/developer/v1/token") return new Response(JSON.stringify({ access_token: "t", expires_in: 100 }), { status: 200 });
      return new Response(JSON.stringify({ data: [], page: { next: `${BASE}/developer/v1/cards/vault` } }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(new RampReadOnlyClient(cfg, { fetch: vaultNext }).listAll("/developer/v1/cards/physical")).rejects.toBeInstanceOf(RampApiError);
  });
});

describe("status endpoint", () => {
  it("NOT_CONFIGURED -> blocked; configured + DEMO -> blocked with ramp:init hint; after sync -> lastSync", async () => {
    await resetNorthstarDemo(db, { env: { DEMO_MODE: "true" } });
    const off = StatusEnvelope.parse(await (await rampStatusHandler({ db, env: { DEMO_MODE: "true" } })).json()).data;
    expect(off).toMatchObject({ status: "NOT_CONFIGURED", missing: ["RAMP_CLIENT_ID", "RAMP_CLIENT_SECRET"], syncAllowed: false, workspaceMode: "DEMO", lastSync: null });
    const demo = StatusEnvelope.parse(await (await rampStatusHandler({ db, env: RAMP_ENV })).json()).data;
    expect(demo).toMatchObject({ status: "CONFIGURED", sandbox: true, host: "demo-api.ramp.com", syncAllowed: false });
    expect(demo.syncBlockedReason).toMatch(/pnpm ramp:init/);
    expect(JSON.stringify(demo)).not.toMatch(/csecret|cid/);

    await sandboxWorkspace();
    await sync(fakeRamp());
    const after = StatusEnvelope.parse(await (await rampStatusHandler({ db, env: RAMP_ENV })).json()).data;
    expect(after).toMatchObject({ syncAllowed: true, workspaceMode: "RAMP_SANDBOX", lastSync: { status: "PARTIAL" } }); // t3/t4 skipped -> honest PARTIAL
  });
});

describe("pnpm ramp:init", () => {
  it("requires --confirm; then leaves an empty RAMP_SANDBOX workspace", async () => {
    await resetNorthstarDemo(db, { env: { DEMO_MODE: "true" } });
    const run = (args: string[]) =>
      spawnSync(join(ROOT, "node_modules/.bin/tsx"), ["scripts/ramp-init.ts", ...args], { cwd: ROOT, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
    expect(run([]).status).toBe(1);
    expect((await repos.workspaces.list())[0]!.mode).toBe("DEMO");
    const ok = run(["--confirm"]);
    expect(ok.status, ok.stderr).toBe(0);
    expect(await repos.workspaces.list()).toEqual([{ id: "ws-ramp-sandbox", name: "Ramp sandbox (read-only)", mode: "RAMP_SANDBOX" }]);
    expect(await counts()).toEqual({ funds: 0, cards: 0, vendors: 0, transactions: 0, nodes: 0, edges: 0, evidence: 0 });
  }, 60_000);
});
