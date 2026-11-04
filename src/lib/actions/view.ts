/** Builds ActionProposalView from the proposal row + its immutable audit trail (server-only). */
import * as z from "zod";
import type { Repositories } from "@/lib/repositories";
import { ACTION_PROPOSAL_TRANSITIONS, ActionProposalState, type ActionProposal, type AuditEvent } from "@/lib/schema";
import { ACTION_AUDIT, SIMULATION_ONLY_NOTICE, type ActionHistoryEntry, type ActionProposalView } from "./schema";

/** Shape of detailsJson on action.* audit events (written by ./service). */
export const ActionAuditDetails = z.looseObject({
  notice: z.literal(SIMULATION_ONLY_NOTICE),
  actionId: z.string(),
  /** 1-based position of this transition in the action's history (the demo clock is fixed, so time cannot order them). */
  seq: z.int().positive(),
  incidentId: z.string(),
  fromState: ActionProposalState.nullable(),
  toState: ActionProposalState,
  text: z.string().nullable(),
  simulationId: z.string().nullable().optional(),
  lifecycle: z.strictObject({ proposed: z.literal(true), approvedInDemo: z.boolean(), executedExternally: z.literal(false) }),
});
export type ActionAuditDetails = z.infer<typeof ActionAuditDetails>;

const ACTIONS = new Set<string>(Object.values(ACTION_AUDIT));

export function historyFor(actionId: string, audits: readonly AuditEvent[]): ActionHistoryEntry[] {
  return audits
    .filter((a) => ACTIONS.has(a.action))
    .flatMap((a) => {
      const d = ActionAuditDetails.safeParse(a.detailsJson);
      if (!d.success || d.data.actionId !== actionId) return [];
      return [{ seq: d.data.seq, entry: {
          auditEventId: a.id,
          action: a.action as ActionHistoryEntry["action"],
          actor: a.actor,
          at: a.at,
          fromState: d.data.fromState,
          toState: d.data.toState,
          text: d.data.text,
          lifecycle: d.data.lifecycle,
        } satisfies ActionHistoryEntry }];
    })
    .sort((a, b) => a.seq - b.seq || a.entry.auditEventId.localeCompare(b.entry.auditEventId))
    .map((x) => x.entry);
}

/** null when the proposal has no readable "action.proposed" audit entry. */
export function toView(p: ActionProposal, audits: readonly AuditEvent[]): ActionProposalView | null {
  const history = historyFor(p.id, audits);
  const proposed = history.find((h) => h.action === ACTION_AUDIT.proposed);
  if (!proposed) return null;
  const proposedAudit = audits.find((a) => a.id === proposed.auditEventId)!;
  const simulationId = ActionAuditDetails.parse(proposedAudit.detailsJson).simulationId ?? null;
  return {
    id: p.id,
    incidentId: p.incidentId,
    kind: p.kind,
    payload: p.payloadJson,
    state: p.state,
    decidedBy: p.state === "APPROVED_FOR_DEMO" || p.state === "REJECTED" ? p.approver : null,
    rationale: proposed.text ?? "",
    proposedBy: proposed.actor,
    proposedAt: proposed.at,
    simulationId,
    simulated: true,
    lifecycle: { proposed: true, approvedInDemo: p.state === "APPROVED_FOR_DEMO", executedExternally: false },
    allowedTransitions: [...ACTION_PROPOSAL_TRANSITIONS[p.state]],
    history,
    notice: SIMULATION_ONLY_NOTICE,
  };
}

export async function viewById(repos: Repositories, id: string): Promise<ActionProposalView | null> {
  const p = await repos.actionProposals.findById(id);
  if (!p) return null;
  return toView(p, await repos.auditEvents.listBySubject(p.incidentId));
}
