import { describe, expect, it } from "vitest";
import {
  ACTION_AUDIT,
  ApproveActionRequestSchema,
  ProposeActionRequestSchema,
  RejectActionRequestSchema,
  SIMULATION_ONLY_NOTICE,
  SubmitActionRequestSchema,
} from "@/lib/actions/schema";
import { historyFor, toView } from "@/lib/actions/view";
import type { ActionProposal, AuditEvent } from "@/lib/schema";

const patch = { kind: "INCREASE_AVAILABLE_ALLOCATION", fundingSourceId: "fund-auth", amountCents: 60000 } as const;
const propose = {
  incidentId: "inc-charge-cloudcomms-20261119",
  kind: "INCREASE_AVAILABLE_ALLOCATION",
  payload: patch,
  rationale: "Cover the $450 modeled shortfall before the 11-19 charge.",
  proposedBy: "finance-ops",
} as const;

describe("request schemas", () => {
  it("propose requires a rationale, a proposer and kind = payload.kind; rejects client scores", () => {
    expect(ProposeActionRequestSchema.safeParse(propose).success).toBe(true);
    expect(ProposeActionRequestSchema.safeParse({ ...propose, rationale: "too short" }).success).toBe(false);
    expect(ProposeActionRequestSchema.safeParse({ ...propose, rationale: undefined }).success).toBe(false);
    expect(ProposeActionRequestSchema.safeParse({ ...propose, proposedBy: "  " }).success).toBe(false);
    expect(ProposeActionRequestSchema.safeParse({ ...propose, kind: "ASSIGN_ALTERNATE_FUND" }).success).toBe(false);
    expect(ProposeActionRequestSchema.safeParse({ ...propose, riskScore: 0 }).success).toBe(false);
    expect(ProposeActionRequestSchema.safeParse({ ...propose, payload: { ...patch, amountCents: -1 } }).success).toBe(false);
  });

  it("approve requires an approver; reject requires a reviewer and a reason", () => {
    expect(ApproveActionRequestSchema.safeParse({}).success).toBe(false);
    expect(ApproveActionRequestSchema.safeParse({ approver: "" }).success).toBe(false);
    expect(ApproveActionRequestSchema.safeParse({ approver: "ops-lead" }).success).toBe(true);
    expect(ApproveActionRequestSchema.safeParse({ approver: "ops-lead", state: "EXECUTED" }).success).toBe(false);
    expect(RejectActionRequestSchema.safeParse({ reviewer: "ops-lead" }).success).toBe(false);
    expect(RejectActionRequestSchema.safeParse({ reviewer: "ops-lead", reason: "Prefer rescheduling the charge." }).success).toBe(true);
    expect(SubmitActionRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("view and history", () => {
  const p: ActionProposal = {
    id: "act-1",
    incidentId: propose.incidentId,
    kind: "INCREASE_AVAILABLE_ALLOCATION",
    payloadJson: patch,
    state: "PENDING_APPROVAL",
    approver: null,
    simulated: true,
    createdAt: "2026-11-17T16:00:00Z",
  };
  const ev = (id: string, action: string, actor: string, from: string | null, to: string, text: string | null, actionId = "act-1"): AuditEvent => ({
    id,
    actor,
    action,
    subjectId: propose.incidentId,
    at: "2026-11-17T16:00:00Z",
    detailsJson: {
      notice: SIMULATION_ONLY_NOTICE,
      actionId,
      seq: { a1: 1, a2: 2, x1: 1, s1: 1 }[id as "a1"] ?? 1,
      incidentId: propose.incidentId,
      fromState: from,
      toState: to,
      text,
      simulationId: null,
      lifecycle: { proposed: true, approvedInDemo: to === "APPROVED_FOR_DEMO", executedExternally: false },
    },
  });
  const audits = [
    // Stored order is irrelevant: history is ordered by the recorded seq.
    ev("a2", ACTION_AUDIT.submitted, "finance-ops", "DRAFT", "PENDING_APPROVAL", null),
    ev("a1", ACTION_AUDIT.proposed, "finance-ops", null, "DRAFT", propose.rationale),
    ev("x1", ACTION_AUDIT.proposed, "someone", null, "DRAFT", "another action entirely", "act-2"),
    { ...ev("s1", "simulation.run", "demo-user", null, "DRAFT", null), detailsJson: { label: "SIMULATION ONLY" } },
  ];

  it("history contains only this action's transitions, oldest first", () => {
    expect(historyFor("act-1", audits).map((h) => [h.auditEventId, h.fromState, h.toState])).toEqual([
      ["a1", null, "DRAFT"],
      ["a2", "DRAFT", "PENDING_APPROVAL"],
    ]);
  });

  it("view: rationale and proposer from the immutable trail; never executed", () => {
    const v = toView(p, audits)!;
    expect(v).toMatchObject({
      rationale: propose.rationale,
      proposedBy: "finance-ops",
      state: "PENDING_APPROVAL",
      decidedBy: null,
      lifecycle: { proposed: true, approvedInDemo: false, executedExternally: false },
      allowedTransitions: ["APPROVED_FOR_DEMO", "REJECTED"],
      notice: "SIMULATION ONLY: No Ramp funds changed",
    });
    expect(toView({ ...p, state: "APPROVED_FOR_DEMO", approver: "ops-lead" }, audits)).toMatchObject({
      decidedBy: "ops-lead",
      lifecycle: { approvedInDemo: true, executedExternally: false },
      allowedTransitions: [],
    });
  });

  it("a proposal without its proposed audit entry is unreadable (null), never invented", () => {
    expect(toView(p, audits.filter((a) => a.id !== "a1"))).toBeNull();
  });
});
