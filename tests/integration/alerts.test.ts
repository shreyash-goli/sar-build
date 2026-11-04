/** FS-20 in-app alerts against a throwaway seeded SQLite DB. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, type PrismaClient } from "@/lib/db";
import { AlertListDataSchema, AlertResponseDataSchema } from "@/lib/alerts/schema";
import { resetNorthstarDemo, seedNorthstarDemo } from "@/lib/demo/northstar";
import { materializeIncidents } from "@/lib/incidents";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { createRepositories, type Repositories } from "@/lib/repositories";
import { ApiErrorSchema, apiSuccessSchema } from "@/lib/schema";
import { ackAlertHandler, listAlertsHandler, snoozeAlertHandler } from "@/app/api/_lib/alerts";

const ROOT = resolve(__dirname, "../..");
const DEMO = { DEMO_MODE: "true" } as const;
const NOW = new Date("2026-11-17T16:00:00Z");
const HERO = "inc-charge-cloudcomms-20261119";
const ListEnvelope = apiSuccessSchema(AlertListDataSchema);
const RespEnvelope = apiSuccessSchema(AlertResponseDataSchema);

let dir: string;
let url: string;
let db: PrismaClient;
let repos: Repositories;
let writer: Repositories;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-alerts-test-"));
  url = `file:${join(dir, "alerts.db")}`;
  execFileSync(join(ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  db = createDbClient(url);
  repos = createReadOnlyRepositories(db);
  writer = createRepositories(db, { writeGate: () => undefined, demoResetGate: () => undefined });
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetNorthstarDemo(db, { env: DEMO });
});

const list = async (qs = "", env: Record<string, string | undefined> = DEMO) =>
  ListEnvelope.parse(await (await listAlertsHandler(new Request(`http://localhost/api/alerts${qs}`), { db, env })).json()).data;
const post = (path: "ack" | "snooze", id: string, body: unknown, env: Record<string, string | undefined> = DEMO) =>
  (path === "ack" ? ackAlertHandler : snoozeAlertHandler)(
    new Request(`http://localhost/api/alerts/${id}/${path}`, { method: "POST", body: JSON.stringify(body) }),
    id,
    { db, env },
  );
const heroAlerts = async () => (await repos.alerts.listByIncident(HERO)).reverse(); // oldest first

describe("alert creation", () => {
  it("a reset creates one CREATED alert per risky incident (healthy LOW is not alerted)", async () => {
    const all = await repos.alerts.list();
    expect(all.map((a) => [a.incidentId, a.kind, a.severity]).sort()).toEqual([
      ["inc-charge-cloudcomms-20261119", "CREATED", "CRITICAL"],
      ["inc-charge-metricsrelay-20261124", "CREATED", "UNKNOWN"],
      ["inc-tx-webhookworks-20261116", "CREATED", "HIGH"],
    ]);
    const hero = all.find((a) => a.incidentId === HERO)!;
    expect(hero).toMatchObject({
      title: "New CRITICAL risk: Projected $450.00 funding shortfall for CloudComms",
      source: "risk-engine:projected-shortfall-v1",
      owner: "Identity Platform",
      link: `/incidents/${HERO}`,
      status: "OPEN",
      previousSeverity: null,
      category: "PROJECTED_SHORTFALL",
      createdAt: "2026-11-17T16:00:00Z",
    });
    expect(hero.message).toBe("The risk engine opened a CRITICAL-severity incident: projected shortfall.");
    // Article agrees and the word is not duplicated (was "a UNKNOWN unknown data incident").
    expect(all.find((a) => a.severity === "UNKNOWN")!.message).toBe("The risk engine opened an UNKNOWN-severity incident: unknown data.");
    const view = await list();
    expect(view.counts).toEqual({ active: 3, snoozed: 0, acknowledged: 0, total: 3 });
    expect(view.notice).toBe("In-app only: no external notification sent");
    expect(view).toMatchObject({ clockFrozen: true, snoozeHint: null }); // nothing snoozed yet
    for (const a of view.alerts) expect(a).toMatchObject({ channel: "IN_APP", notice: "In-app only: no external notification sent", displayState: "ACTIVE" });
    expect(view.alerts.map((a) => a.seq)).toEqual([...view.alerts.map((a) => a.seq)].sort((x, y) => y - x));
  });

  it("the same input evaluated twice produces one alert", async () => {
    const before = await repos.alerts.list();
    await materializeIncidents(writer, NOW);
    await materializeIncidents(writer, NOW);
    await seedNorthstarDemo(db, { env: DEMO });
    expect(await repos.alerts.list()).toEqual(before);
  });
});

describe("transition timeline", () => {
  it("a changed risk adds exactly one new entry per change (resolve, reopen, resolve again)", async () => {
    await writer.fundingSources.update("fund-auth", { availableCents: 260000 }); // the +$600 change, applied to base data in a test DB
    await materializeIncidents(writer, NOW);
    await materializeIncidents(writer, NOW); // duplicate evaluation: no extra alert
    let tl = await heroAlerts();
    expect(tl.map((a) => [a.kind, a.previousSeverity, a.severity])).toEqual([
      ["CREATED", null, "CRITICAL"],
      ["RESOLVED", "CRITICAL", "LOW"],
    ]);
    expect(tl[1]).toMatchObject({ title: "Risk resolved: Projected $450.00 funding shortfall for CloudComms", previousCategory: "PROJECTED_SHORTFALL", category: "NO_RISK" });

    await writer.fundingSources.update("fund-auth", { availableCents: 200000 });
    await materializeIncidents(writer, NOW);
    await writer.fundingSources.update("fund-auth", { availableCents: 260000 });
    await materializeIncidents(writer, NOW);
    tl = await heroAlerts();
    expect(tl.map((a) => a.kind)).toEqual(["CREATED", "RESOLVED", "REOPENED", "RESOLVED"]);
    expect(tl[2]).toMatchObject({ title: "Risk returned (CRITICAL): Projected $450.00 funding shortfall for CloudComms", previousSeverity: "LOW", severity: "CRITICAL" });
    expect(new Set(tl.map((a) => a.alertKey)).size).toBe(4); // a recurring transition is a new entry, not suppressed
  });

  it("QA repro: a risk returning after resolution at the same severity raises REOPENED (never silent)", async () => {
    const CH = "inc-charge-computeharbor-20261121";
    // Escalate ComputeHarbor: availability below its $11,800 charge (due in 4 days, CRITICAL login reachable -> HIGH).
    await writer.fundingSources.update("fund-infra", { availableCents: 1000000 });
    await materializeIncidents(writer, NOW);
    expect(await repos.incidents.getById(CH)).toMatchObject({ severity: "HIGH", status: "OPEN" });
    // The charge clears -> subject no longer evaluated -> RESOLVED.
    await writer.vendorCharges.update("charge-computeharbor-20261121", { status: "CLEARED" });
    await materializeIncidents(writer, NOW);
    expect(await repos.incidents.getById(CH)).toMatchObject({ severity: "HIGH", status: "RESOLVED" });
    // Scheduled again: same severity (HIGH) and category -> REOPENED.
    await writer.vendorCharges.update("charge-computeharbor-20261121", { status: "SCHEDULED" });
    await materializeIncidents(writer, NOW);
    expect(await repos.incidents.getById(CH)).toMatchObject({ severity: "HIGH", status: "OPEN" });
    const tl = (await repos.alerts.listByIncident(CH)).reverse();
    expect(tl.map((a) => [a.kind, a.previousSeverity, a.severity])).toEqual([
      ["ESCALATED", "LOW", "HIGH"],
      ["RESOLVED", "HIGH", "HIGH"],
      ["REOPENED", "HIGH", "HIGH"],
    ]);
    expect(tl[2]!.title).toMatch(/^Risk returned \(HIGH\): /);
    // T-13: evaluating the same input again adds nothing.
    await materializeIncidents(writer, NOW);
    expect(await repos.alerts.listByIncident(CH)).toHaveLength(3);
  });

  it("de-escalation and subject-no-longer-evaluated resolution", async () => {
    await writer.nodes.update("node-workflow-account-login", { criticality: "HIGH" });
    await materializeIncidents(writer, NOW);
    expect((await heroAlerts()).at(-1)).toMatchObject({ kind: "DEESCALATED", previousSeverity: "CRITICAL", severity: "HIGH" });

    await writer.vendorCharges.update("charge-metricsrelay-20261124", { status: "CANCELLED" });
    await materializeIncidents(writer, NOW);
    const m = await repos.alerts.listByIncident("inc-charge-metricsrelay-20261124");
    expect(m[0]).toMatchObject({ kind: "RESOLVED", previousSeverity: "UNKNOWN" });
  });
});

describe("ack and snooze (demo, audited)", () => {
  it("ack hides the alert from the active view; repeat is idempotent", async () => {
    const hero = (await heroAlerts())[0]!;
    const res = await post("ack", hero.id, { actor: "ops-lead" });
    expect(res.status).toBe(200);
    const d = RespEnvelope.parse(await res.json()).data;
    expect(d).toMatchObject({ idempotent: false, alert: { status: "ACKNOWLEDGED", acknowledgedBy: "ops-lead", acknowledgedAt: "2026-11-17T16:00:00Z", displayState: "ACKNOWLEDGED" } });
    const audit = await repos.auditEvents.getById(d.auditEventId!);
    expect(audit).toMatchObject({ action: "alert.acknowledged", actor: "ops-lead", subjectId: hero.id });

    const again = RespEnvelope.parse(await (await post("ack", hero.id, { actor: "someone" })).json()).data;
    expect(again).toMatchObject({ idempotent: true, auditEventId: null, alert: { acknowledgedBy: "ops-lead" } });

    const v = await list();
    expect(v.counts).toEqual({ active: 2, snoozed: 0, acknowledged: 1, total: 3 });
    expect(v.alerts.map((a) => a.id)).not.toContain(hero.id);
    expect((await list("?view=all")).alerts.map((a) => a.id)).toContain(hero.id);
  });

  it("snooze hides until the demo clock passes snoozedUntil", async () => {
    const hero = (await heroAlerts())[0]!;
    const d = RespEnvelope.parse(await (await post("snooze", hero.id, { actor: "ops-lead", until: "2026-11-17T18:00:00Z" })).json()).data;
    expect(d.alert).toMatchObject({ snoozedUntil: "2026-11-17T18:00:00Z", snoozedBy: "ops-lead", displayState: "SNOOZED" });
    expect((await repos.auditEvents.getById(d.auditEventId!)).action).toBe("alert.snoozed");

    expect((await list()).alerts.map((a) => a.id)).not.toContain(hero.id);
    const snoozedList = await list();
    expect(snoozedList.counts.snoozed).toBe(1);
    // Frozen demo clock: the UI gets an explicit hint that snoozes won't expire on their own.
    expect(snoozedList.clockFrozen).toBe(true);
    expect(snoozedList.snoozeHint).toMatch(/demo clock is fixed at 2026-11-17T16:00:00Z/);
    // Later demo clock: the snooze has expired and the alert is active again.
    const later = await list("", { DEMO_MODE: "true", DEMO_NOW: "2026-11-17T18:00:01Z" });
    expect(later.alerts.find((a) => a.id === hero.id)!.displayState).toBe("ACTIVE");
    // Same snooze again: idempotent.
    expect(RespEnvelope.parse(await (await post("snooze", hero.id, { actor: "x", until: "2026-11-17T18:00:00Z" })).json()).data.idempotent).toBe(true);
  });

  it("validation: past or >30-day snooze 400; snoozing an acknowledged alert 409; 404; 403", async () => {
    const [hero, other] = [(await heroAlerts())[0]!, (await repos.alerts.listByIncident("inc-tx-webhookworks-20261116"))[0]!];
    expect((await post("snooze", hero.id, { actor: "a", until: "2026-11-17T15:00:00Z" })).status).toBe(400);
    expect((await post("snooze", hero.id, { actor: "a", until: "2026-12-30T00:00:00Z" })).status).toBe(400);
    expect((await post("snooze", hero.id, { actor: "a", until: "tomorrow" })).status).toBe(400);
    expect((await post("ack", hero.id, {})).status).toBe(400);
    await post("ack", other.id, { actor: "ops-lead" });
    const conflict = await post("snooze", other.id, { actor: "a", until: "2026-11-17T18:00:00Z" });
    expect(conflict.status).toBe(409);
    expect(ApiErrorSchema.parse(await conflict.json()).error.code).toBe("INVALID_TRANSITION");
    expect((await post("ack", "alert-nope", { actor: "a" })).status).toBe(404);
    expect((await post("ack", hero.id, { actor: "a" }, { DEMO_MODE: "false" })).status).toBe(403);
    expect((await repos.alerts.getById(hero.id)).status).toBe("OPEN");
  });

  it("list query validation and per-incident filter", async () => {
    expect((await list(`?incidentId=${HERO}`)).alerts.map((a) => a.incidentId)).toEqual([HERO]);
    expect((await listAlertsHandler(new Request("http://localhost/api/alerts?view=bogus"), { db, env: DEMO })).status).toBe(400);
    expect((await listAlertsHandler(new Request("http://localhost/api/alerts?incidentId=inc-nope"), { db, env: DEMO })).status).toBe(404);
  });
});

describe("demo reset", () => {
  it("clears alerts (and their ack/snooze state) and regenerates fresh CREATED alerts", async () => {
    const hero = (await heroAlerts())[0]!;
    await post("ack", hero.id, { actor: "ops-lead" });
    await writer.fundingSources.update("fund-auth", { availableCents: 260000 });
    await materializeIncidents(writer, NOW);
    expect((await repos.alerts.list()).length).toBe(4);
    await resetNorthstarDemo(db, { env: DEMO });
    const after = await repos.alerts.list();
    expect(after).toHaveLength(3);
    expect(after.every((a) => a.kind === "CREATED" && a.status === "OPEN")).toBe(true);
    expect(after.map((a) => a.id)).not.toContain(hero.id);
  });
});

describe("route modules", () => {
  it("GET /api/alerts and POST ack use getDb()", async () => {
    const g = globalThis as unknown as { __failsafeDb?: PrismaClient };
    const prev = { url: process.env.DATABASE_URL, demo: process.env.DEMO_MODE, now: process.env.DEMO_NOW, db: g.__failsafeDb };
    process.env.DATABASE_URL = url;
    process.env.DEMO_MODE = "true";
    delete process.env.DEMO_NOW;
    g.__failsafeDb = undefined;
    try {
      const listRoute = await import("@/app/api/alerts/route");
      const ackRoute = await import("@/app/api/alerts/[id]/ack/route");
      const res = await listRoute.GET(new Request("http://localhost/api/alerts"));
      const data = ListEnvelope.parse(await res.json()).data;
      expect(data.counts.active).toBe(3);
      const id = data.alerts[0]!.id;
      const ack = await ackRoute.POST(new Request(`http://localhost/api/alerts/${id}/ack`, { method: "POST", body: JSON.stringify({ actor: "ops" }) }), {
        params: Promise.resolve({ id }),
      });
      expect(ack.status).toBe(200);
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
