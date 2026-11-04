/**
 * Client-safe contract for approval-gated response actions (FS-15).
 *   POST /api/actions/propose          ProposeActionRequestSchema  -> 201 ActionResponseData
 *   POST /api/actions/[id]/submit      SubmitActionRequestSchema   -> 200 ActionResponseData
 *   POST /api/actions/[id]/approve     ApproveActionRequestSchema  -> 200 ActionResponseData
 *   POST /api/actions/[id]/reject      RejectActionRequestSchema   -> 200 ActionResponseData
 *   GET  /api/actions[?incidentId=]                                -> ActionListData
 *   GET  /api/actions/[id]                                         -> ActionProposalView
 * Lifecycle: DRAFT -> PENDING_APPROVAL -> APPROVED_FOR_DEMO | REJECTED (DRAFT -> REJECTED also allowed).
 * Approval changes ONLY the simulated plan's state. Nothing is ever executed externally.
 */
import * as z from "zod";
import { ActionProposalState, SimulationPatchKind } from "../schema/enums";
import { IdSchema, IsoDateTimeSchema } from "../schema/primitives";
import { SimulationPatchSchema } from "../schema/simulation";

export const SIMULATION_ONLY_NOTICE = "SIMULATION ONLY: No Ramp funds changed" as const;

/** Audit action keys (dotted lowercase, per AuditEventSchema). */
export const ACTION_AUDIT = {
  proposed: "action.proposed",
  submitted: "action.submitted",
  approved: "action.approved_for_demo",
  rejected: "action.rejected",
} as const;

const Actor = z.string().trim().min(1, "actor is required").max(80);
const Rationale = z.string().trim().min(10, "a rationale of at least 10 characters is required").max(2000);

export const ProposeActionRequestSchema = z
  .strictObject({
    incidentId: IdSchema,
    kind: SimulationPatchKind,
    payload: SimulationPatchSchema,
    /** Human justification; required. Stored immutably in the audit trail. */
    rationale: Rationale,
    proposedBy: Actor,
    /** Optional: the simulation this proposal is based on (must be for the same incident and patch). */
    simulationId: IdSchema.optional(),
  })
  .refine((r) => r.kind === r.payload.kind, { message: "kind must match payload.kind", path: ["kind"] });
export type ProposeActionRequest = z.infer<typeof ProposeActionRequestSchema>;

export const SubmitActionRequestSchema = z.strictObject({ submittedBy: Actor });
export const ApproveActionRequestSchema = z.strictObject({
  /** Required (missing approver -> 400). Must differ from the proposer (no self-approval). */
  approver: Actor,
  note: z.string().trim().min(1).max(2000).optional(),
});
export const RejectActionRequestSchema = z.strictObject({
  reviewer: Actor,
  /** Required reason for rejection. */
  reason: Rationale,
});

/** Proposed vs approved-in-demo vs executed-externally (always false in this MVP). */
export const LifecycleSchema = z.strictObject({
  proposed: z.literal(true),
  approvedInDemo: z.boolean(),
  executedExternally: z.literal(false),
});

export const ActionHistoryEntrySchema = z.strictObject({
  auditEventId: z.string(),
  action: z.enum([ACTION_AUDIT.proposed, ACTION_AUDIT.submitted, ACTION_AUDIT.approved, ACTION_AUDIT.rejected]),
  actor: z.string(),
  at: IsoDateTimeSchema,
  fromState: ActionProposalState.nullable(),
  toState: ActionProposalState,
  /** Rationale (proposed), note (approved) or reason (rejected). */
  text: z.string().nullable(),
  lifecycle: LifecycleSchema,
});
export type ActionHistoryEntry = z.infer<typeof ActionHistoryEntrySchema>;

export const ActionProposalViewSchema = z.strictObject({
  id: z.string(),
  incidentId: z.string(),
  kind: SimulationPatchKind,
  payload: SimulationPatchSchema,
  state: ActionProposalState,
  /** Approver (APPROVED_FOR_DEMO) or reviewer who rejected (REJECTED); null otherwise. */
  decidedBy: z.string().nullable(),
  rationale: z.string(),
  proposedBy: z.string(),
  proposedAt: IsoDateTimeSchema,
  simulationId: z.string().nullable(),
  simulated: z.literal(true),
  lifecycle: LifecycleSchema,
  /** Allowed next transitions from the current state. */
  allowedTransitions: z.array(ActionProposalState),
  /** Every transition, oldest first, from the immutable audit trail. */
  history: z.array(ActionHistoryEntrySchema),
  notice: z.literal(SIMULATION_ONLY_NOTICE),
});
export type ActionProposalView = z.infer<typeof ActionProposalViewSchema>;

export const ActionResponseDataSchema = z.strictObject({
  action: ActionProposalViewSchema,
  /** Audit event written by this call; null when the call was an idempotent repeat. */
  auditEventId: z.string().nullable(),
  /** True when the request repeated an already-applied transition (no new audit event). */
  idempotent: z.boolean(),
  notice: z.literal(SIMULATION_ONLY_NOTICE),
});
export type ActionResponseData = z.infer<typeof ActionResponseDataSchema>;

export const ActionListDataSchema = z.strictObject({
  actions: z.array(ActionProposalViewSchema),
  unreadableActionIds: z.array(z.string()),
  notice: z.literal(SIMULATION_ONLY_NOTICE),
});
export type ActionListData = z.infer<typeof ActionListDataSchema>;
