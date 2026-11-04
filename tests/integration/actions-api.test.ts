/** FS-15 backend: approval-gated actions + audit trail against a throwaway seeded SQLite DB. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDbClient, type PrismaClient } from "@/lib/db";
import { ActionListDataSchema, ActionProposalViewSchema, ActionResponseDataSchema } from "@/lib/actions/schema";
import { resetNorthstarDemo } from "@/lib/demo/northstar";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import type { Repositories } from "@/lib/repositories";
import { ApiErrorSchema, apiSuccessSchema } from "@/lib/schema";
import { ScenarioRunDataSchema } from "@/lib/simulations/schema";
import {
  approveActionHandler,
  getActionHandler,
  listActionsHandler,
  proposeActionHandler,
  rejectActionHandler,
  submitActionHandler,
} from "@/app/api/_lib/actions";
import { runScenario } from "@/app/api/_lib/scenarios";

const ROOT = resolve(__dirname, "../..");
const DEMO = { DEMO_MODE: "true" } as const;
const NOW = "2026-11-17T16:00:00Z";
const HERO = "inc-charge-cloudcomms-20261119";
const Resp = apiSuccessSchema(ActionResponseDataSchema);
const plus600 = { kind: "INCREASE_AVAILABLE_ALLOCATION", fundingSourceId: "fund-auth", amountCents: 60000 } as const;
const proposal = {
  incidentId: HERO,
  kind: "INCREASE_AVAILABLE_ALLOCATION",
  payload: plus600,
  rationale: "Cover the modeled $450 shortfall before the 11-19 CloudComms charge.",
  proposedBy: "finance-ops",
};

let dir: string;
let db: PrismaClient;
let repos: Repositories;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-actions-test-"));
  const url = `file:${join(dir, "actions.db")}`;
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

const req = (body: unknown) =>
  new Request("http://localhost/api/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = (env: Record<string, string | undefined> = DEMO) => ({ db, env });
const propose = async (body: unknown = proposal, env?: Record<string, string | undefined>) => proposeActionHandler(req(body), ctx(env));
const submit = (id: string, by = "finance-ops") => submitActionHandler(req({ submittedBy: by }), id, ctx());
const approve = (id: string, body: unknown = { approver: "ops-lead", note: "Approved for the demo plan." }) => approveActionHandler(req(body), id, ctx());
const reject = (id: string, body: unknown = { reviewer: "ops-lead", reason: "Prefer rescheduling the charge instead." }) => rejectActionHandler(req(body), id, ctx());
const ok = async (res: Response) => Resp.parse(await res.json()).data;
const errorOf = async (res: Response) => ApiErrorSchema.parse(await res.json()).error;
/** Action audit events in recorded order (details.seq per action; the demo clock is fixed). */
const actionAudits = async () =>
  (await repos.auditEvents.list())
    .filter((a) => a.action.startsWith("action."))
    .sort((a, b) => {
      const d = (x: typeof a) => x.detailsJson as { actionId: string; seq: number };
      return d(a).actionId.localeCompare(d(b).actionId) || d(a).seq - d(b).seq;
    });

async function baseSnapshot() {
  return {
    fundingSources: await repos.fundingSources.list(),
    paymentInstruments: await repos.paymentInstruments.list(),
    vendors: await repos.vendors.list(),
    vendorCharges: await repos.vendorCharges.list(),
    transactions: await repos.transactions.list(),
    nodes: await repos.nodes.list(),
    edges: await repos.edges.list(),
    incidents: await repos.incidents.list(),
    evidence: await repos.evidence.list(),
    simulations: await repos.simulations.list(),
    workspaces: await repos.workspaces.list(),
  };
}

describe("full lifecycle", () => {
  it("propose -> submit -> approve: only the simulated plan changes; funds untouched", async () => {
    const before = await baseSnapshot();

    const p = await propose();
    expect(p.status).toBe(201);
    const created = await ok(p);
    expect(created.action).toMatchObject({
      state: "DRAFT",
      rationale: proposal.rationale,
      proposedBy: "finance-ops",
      proposedAt: NOW,
      simulated: true,
      decidedBy: null,
      lifecycle: { proposed: true, approvedInDemo: false, executedExternally: false },
      allowedTransitions: ["PENDING_APPROVAL", "REJECTED"],
      notice: "SIMULATION ONLY: No Ramp funds changed",
    });
    expect(created).toMatchObject({ idempotent: false, notice: "SIMULATION ONLY: No Ramp funds changed" });
    const id = created.action.id;

    expect((await ok(await submit(id))).action.state).toBe("PENDING_APPROVAL");
    const approved = await ok(await approve(id));
    expect(approved.action).toMatchObject({
      state: "APPROVED_FOR_DEMO",
      decidedBy: "ops-lead",
      lifecycle: { proposed: true, approvedInDemo: true, executedExternally: false },
      allowedTransitions: [],
    });
    expect(approved.action.history.map((h) => [h.action, h.actor, h.fromState, h.toState, h.text])).toEqual([
      ["action.proposed", "finance-ops", null, "DRAFT", proposal.rationale],
      ["action.submitted", "finance-ops", "DRAFT", "PENDING_APPROVAL", null],
      ["action.approved_for_demo", "ops-lead", "PENDING_APPROVAL", "APPROVED_FOR_DEMO", "Approved for the demo plan."],
    ]);
    for (const h of approved.action.history) expect(h.lifecycle.executedExternally).toBe(false);

    // Funds, charges, transactions, graph, incidents, evidence: byte-for-byte unchanged.
    expect(await baseSnapshot()).toEqual(before);
    expect((await repos.fundingSources.getById("fund-auth")).availableCents).toBe(200000);
    expect(JSON.stringify(approved)).not.toMatch(/"EXECUTED"|executed": ?true/);
  });

  it("audit coverage: every transition writes exactly one event with the incident as subject", async () => {
    const id = (await ok(await propose())).action.id;
    await submit(id);
    await approve(id);
    const audits = await actionAudits();
    expect(audits.map((a) => a.action)).toEqual(["action.proposed", "action.submitted", "action.approved_for_demo"]);
    for (const a of audits) {
      expect(a.subjectId).toBe(HERO);
      expect(a.detailsJson).toMatchObject({ notice: "SIMULATION ONLY: No Ramp funds changed", actionId: id, lifecycle: { executedExternally: false } });
    }
  });

  it("reject from DRAFT and from PENDING_APPROVAL records the reason", async () => {
    const a = (await ok(await propose())).action.id;
    expect((await ok(await reject(a))).action).toMatchObject({ state: "REJECTED", decidedBy: "ops-lead" });
    const b = (await ok(await propose())).action.id;
    await submit(b);
    const r = await ok(await reject(b));
    expect(r.action.history.at(-1)).toMatchObject({ action: "action.rejected", text: "Prefer rescheduling the charge instead." });
  });
});

describe("T-18: duplicate transitions are idempotent (no duplicate audit)", () => {
  it("approve twice, submit twice, reject twice", async () => {
    const id = (await ok(await propose())).action.id;
    await submit(id);
    const s2 = await ok(await submit(id));
    expect(s2).toMatchObject({ idempotent: true, auditEventId: null });
    await approve(id);
    const a2 = await approve(id, { approver: "someone-else" });
    expect(a2.status).toBe(200);
    expect(await ok(a2)).toMatchObject({ idempotent: true, auditEventId: null, action: { state: "APPROVED_FOR_DEMO", decidedBy: "ops-lead" } });
    expect((await actionAudits()).map((x) => x.action)).toEqual(["action.proposed", "action.submitted", "action.approved_for_demo"]);

    const r = (await ok(await propose())).action.id;
    await reject(r);
    expect(await ok(await reject(r))).toMatchObject({ idempotent: true, auditEventId: null });
    expect((await actionAudits()).filter((x) => x.action === "action.rejected")).toHaveLength(1);
  });
});

describe("T-19: forbidden transitions return 409 with a useful error", () => {
  it("approve a DRAFT, approve a REJECTED, reject an APPROVED, submit an APPROVED", async () => {
    const draft = (await ok(await propose())).action.id;
    const r1 = await approve(draft);
    expect(r1.status).toBe(409);
    expect(await errorOf(r1)).toMatchObject({ code: "INVALID_TRANSITION", details: { from: "DRAFT", to: "APPROVED_FOR_DEMO" } });

    await reject(draft);
    expect((await approve(draft)).status).toBe(409);

    const ap = (await ok(await propose())).action.id;
    await submit(ap);
    await approve(ap);
    expect((await reject(ap)).status).toBe(409);
    expect((await submit(ap)).status).toBe(409);
    expect(((await repos.actionProposals.getById(ap)).state)).toBe("APPROVED_FOR_DEMO");
  });
});

describe("validation", () => {
  it("missing approver -> 400; self-approval -> 400; nothing changes", async () => {
    const id = (await ok(await propose())).action.id;
    await submit(id);
    const audits = (await actionAudits()).length;
    for (const body of [{}, { approver: "" }, { approver: "   " }]) {
      const res = await approve(id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const self = await approve(id, { approver: "finance-ops" });
    expect(self.status).toBe(400);
    expect(await errorOf(self)).toMatchObject({ details: { reason: "SELF_APPROVAL" } });
    expect((await repos.actionProposals.getById(id)).state).toBe("PENDING_APPROVAL");
    expect((await actionAudits()).length).toBe(audits);
  });

  it("propose: 400 for invalid bodies or infeasible payloads; 404 for unknown incident/target", async () => {
    for (const body of ["{bad", { ...proposal, rationale: "short" }, { ...proposal, kind: "ASSIGN_ALTERNATE_FUND" }, { ...proposal, proposedBy: "" }]) {
      expect((await propose(body)).status, JSON.stringify(body)).toBe(400);
    }
    const infeasible = await propose({
      ...proposal,
      kind: "ASSIGN_ALTERNATE_FUND",
      payload: { kind: "ASSIGN_ALTERNATE_FUND", vendorChargeId: "charge-cloudcomms-20261119", fundingSourceId: "fund-auth" },
    });
    expect(infeasible.status).toBe(400);
    expect((await propose({ ...proposal, incidentId: "inc-nope" })).status).toBe(404);
    expect((await propose({ ...proposal, payload: { ...plus600, fundingSourceId: "fund-nope" } })).status).toBe(404);
    expect(await repos.actionProposals.list()).toEqual([]);
    expect(await actionAudits()).toEqual([]);
  });

  it("simulationId must exist, match the incident and the patch", async () => {
    const sim = ScenarioRunDataSchema.parse(
      (await (await runScenario(req({ incidentId: HERO, patch: plus600 }), ctx())).json()).data,
    ).simulation;
    const linked = await ok(await propose({ ...proposal, simulationId: sim.id }));
    expect(linked.action.simulationId).toBe(sim.id);
    expect((await propose({ ...proposal, simulationId: "sim-nope" })).status).toBe(404);
    expect((await propose({ ...proposal, payload: { ...plus600, amountCents: 1000 }, simulationId: sim.id })).status).toBe(400);
  });

  it("403 outside demo mode; 404 unknown action; 503 bad clock", async () => {
    expect((await propose(proposal, { DEMO_MODE: "false" })).status).toBe(403);
    expect((await submit("act-nope")).status).toBe(404);
    expect((await approve("act-nope")).status).toBe(404);
    expect((await propose(proposal, { DEMO_MODE: "true", DEMO_NOW: "bogus" })).status).toBe(503);
    expect(await repos.actionProposals.list()).toEqual([]);
  });
});

describe("reads", () => {
  it("GET /api/actions and /api/actions/[id]; history survives (stored server-side)", async () => {
    const id = (await ok(await propose())).action.id;
    await submit(id);
    const list = apiSuccessSchema(ActionListDataSchema).parse(
      await (await listActionsHandler(new Request(`http://localhost/api/actions?incidentId=${HERO}`), ctx())).json(),
    ).data;
    expect(list.actions.map((a) => [a.id, a.state])).toEqual([[id, "PENDING_APPROVAL"]]);
    expect(list.notice).toBe("SIMULATION ONLY: No Ramp funds changed");
    const one = apiSuccessSchema(ActionProposalViewSchema).parse(await (await getActionHandler(id, ctx())).json()).data;
    expect(one.history).toHaveLength(2);
    expect((await getActionHandler("act-nope", ctx())).status).toBe(404);
    expect((await listActionsHandler(new Request("http://localhost/api/actions?foo=1"), ctx())).status).toBe(400);
    expect((await listActionsHandler(new Request("http://localhost/api/actions?incidentId=inc-nope"), ctx())).status).toBe(404);
  });

  it("demo reset clears proposals and their audit trail", async () => {
    await propose();
    await resetNorthstarDemo(db, { env: DEMO });
    expect(await repos.actionProposals.list()).toEqual([]);
    expect(await actionAudits()).toEqual([]);
  });
});
