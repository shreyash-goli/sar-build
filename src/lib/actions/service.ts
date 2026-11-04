/**
 * Approval-gated response actions (FS-15). Server-only.
 *
 * - Transitions are enforced server-side with canTransitionActionProposal
 *   (and again by the repository's beforeUpdate hook): invalid -> 409.
 * - Repeating an already-applied transition (approve twice, submit twice,
 *   reject twice) is idempotent: no state change and NO new audit event (T-18).
 * - Every applied transition appends exactly one AuditEvent (subject = incident)
 *   recording proposed vs approved-in-demo vs executed-externally (always false).
 * - The human rationale / approval note / rejection reason live only in the
 *   immutable audit trail.
 * - Nothing here touches funds, charges, transactions, edges or incidents:
 *   approval changes only the simulated plan's state.
 */
import { randomUUID } from "node:crypto";
import { NotFoundError, RepositoryError, type Repositories } from "@/lib/repositories";
import { canTransitionActionProposal, type ActionProposal, type ActionProposalState } from "@/lib/schema";
import { SimulationError, applyPatch } from "@/lib/simulations/engine";
import { loadWorkspaceSnapshot } from "@/lib/simulations/run";
import {
  ACTION_AUDIT,
  SIMULATION_ONLY_NOTICE,
  type ActionResponseData,
  type ProposeActionRequest,
} from "./schema";
import { historyFor, viewById, type ActionAuditDetails } from "./view";

const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");

function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

async function audit(
  repos: Repositories,
  p: Pick<ActionProposal, "id" | "incidentId" | "kind" | "payloadJson">,
  action: (typeof ACTION_AUDIT)[keyof typeof ACTION_AUDIT],
  actor: string,
  now: Date,
  fromState: ActionProposalState | null,
  toState: ActionProposalState,
  text: string | null,
  simulationId: string | null = null,
): Promise<string> {
  const seq = historyFor(p.id, await repos.auditEvents.listBySubject(p.incidentId)).length + 1;
  const details: ActionAuditDetails & { kind: string; payload: unknown } = {
    notice: SIMULATION_ONLY_NOTICE,
    actionId: p.id,
    seq,
    incidentId: p.incidentId,
    kind: p.kind,
    payload: p.payloadJson,
    fromState,
    toState,
    text,
    simulationId,
    lifecycle: { proposed: true, approvedInDemo: toState === "APPROVED_FOR_DEMO", executedExternally: false },
  };
  const e = await repos.auditEvents.create({
    id: `audit-${randomUUID()}`,
    actor,
    action,
    subjectId: p.incidentId,
    detailsJson: JSON.parse(JSON.stringify(details)) as never,
    at: iso(now),
  });
  return e.id;
}

async function respond(repos: Repositories, id: string, auditEventId: string | null): Promise<ActionResponseData> {
  const view = await viewById(repos, id);
  if (!view) throw new RepositoryError("INTERNAL_ERROR", "Action exists but its audit trail could not be read", { reason: "ACTION_AUDIT_UNREADABLE", actionId: id });
  return { action: view, auditEventId, idempotent: auditEventId === null, notice: SIMULATION_ONLY_NOTICE };
}

export async function proposeAction(repos: Repositories, req: ProposeActionRequest, now: Date): Promise<ActionResponseData> {
  await repos.incidents.getById(req.incidentId); // 404
  if (req.simulationId) {
    const sim = await repos.simulations.findById(req.simulationId);
    if (!sim) throw new NotFoundError("Simulation", req.simulationId);
    if (sim.incidentId !== req.incidentId) {
      throw new RepositoryError("BAD_REQUEST", "simulationId belongs to a different incident", { field: "simulationId" });
    }
    if (canonical(sim.patchJson) !== canonical(req.payload)) {
      throw new RepositoryError("BAD_REQUEST", "payload does not match the simulation's patch", { field: "payload" });
    }
  }
  // Feasibility uses the same validation as simulations; nothing is applied to stored data.
  try {
    applyPatch(await loadWorkspaceSnapshot(repos), req.payload, now);
  } catch (e) {
    if (e instanceof SimulationError) {
      throw new RepositoryError(e.code === "TARGET_NOT_FOUND" ? "NOT_FOUND" : "BAD_REQUEST", e.message, e.details);
    }
    throw e;
  }
  const p = await repos.actionProposals.create({
    id: `act-${randomUUID()}`,
    incidentId: req.incidentId,
    kind: req.kind,
    payloadJson: req.payload,
    state: "DRAFT",
    approver: null,
    simulated: true,
    createdAt: iso(now),
  });
  const auditId = await audit(repos, p, ACTION_AUDIT.proposed, req.proposedBy, now, null, "DRAFT", req.rationale, req.simulationId ?? null);
  return respond(repos, p.id, auditId);
}

type Transition = {
  to: ActionProposalState;
  action: (typeof ACTION_AUDIT)[keyof typeof ACTION_AUDIT];
  actor: string;
  text: string | null;
  /** Value stored in ActionProposal.approver (approver or rejecting reviewer). */
  decidedBy: string | null;
};

async function transition(repos: Repositories, id: string, t: Transition, now: Date): Promise<ActionResponseData> {
  const p = await repos.actionProposals.findById(id);
  if (!p) throw new NotFoundError("Action proposal", id);
  if (p.state === t.to) return respond(repos, id, null); // idempotent repeat: no state change, no audit
  if (!canTransitionActionProposal(p.state, t.to)) {
    throw new RepositoryError("INVALID_TRANSITION", `Cannot move action ${id} from ${p.state} to ${t.to}`, {
      from: p.state,
      to: t.to,
    });
  }
  await repos.actionProposals.update(id, { state: t.to, ...(t.decidedBy !== null ? { approver: t.decidedBy } : {}) });
  const auditId = await audit(repos, p, t.action, t.actor, now, p.state, t.to, t.text);
  return respond(repos, id, auditId);
}

export function submitAction(repos: Repositories, id: string, req: { submittedBy: string }, now: Date) {
  return transition(repos, id, { to: "PENDING_APPROVAL", action: ACTION_AUDIT.submitted, actor: req.submittedBy, text: null, decidedBy: null }, now);
}

export async function approveAction(repos: Repositories, id: string, req: { approver: string; note?: string }, now: Date) {
  const view = await viewById(repos, id);
  if (view && view.state !== "APPROVED_FOR_DEMO" && view.proposedBy === req.approver) {
    throw new RepositoryError("BAD_REQUEST", "The proposer cannot approve their own action", { field: "approver", reason: "SELF_APPROVAL" });
  }
  return transition(
    repos,
    id,
    { to: "APPROVED_FOR_DEMO", action: ACTION_AUDIT.approved, actor: req.approver, text: req.note ?? null, decidedBy: req.approver },
    now,
  );
}

export function rejectAction(repos: Repositories, id: string, req: { reviewer: string; reason: string }, now: Date) {
  return transition(
    repos,
    id,
    { to: "REJECTED", action: ACTION_AUDIT.rejected, actor: req.reviewer, text: req.reason, decidedBy: req.reviewer },
    now,
  );
}
