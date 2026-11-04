/**
 * Stable typed status enums for the FailSafe domain model
 * (docs/BUILD_BLUEPRINT.md Section 2 and Section 5).
 *
 * These are the canonical contract. FS-03 Prisma enums must mirror these
 * values exactly. Do not rename values without a coordinated migration.
 */
import * as z from "zod";

/** Tenant data mode. */
export const WorkspaceMode = z.enum(["DEMO", "RAMP_SANDBOX", "RAMP_LIVE_READONLY"]);
export type WorkspaceMode = z.infer<typeof WorkspaceMode>;

/**
 * Runtime data source classification (where a record came from).
 *
 * `RAMP_DOCUMENTED` / `PRODUCT_HYPOTHESIS` are *feature* provenance labels
 * (docs only) and are deliberately NOT valid runtime source classes, so no
 * runtime record or internal assumption can be labelled `RAMP_DOCUMENTED`.
 */
export const SourceClass = z.enum([
  "DEMO_FIXTURE",
  "RAMP_SANDBOX",
  "EXTERNAL_OBSERVED",
  "MODEL_SUGGESTED",
  "DERIVED",
  "UNKNOWN",
]);
export type SourceClass = z.infer<typeof SourceClass>;

/** Human verification state of an evidence record. Independent of SourceClass. */
export const VerificationStatus = z.enum(["UNVERIFIED", "USER_VERIFIED", "REJECTED"]);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

/** How an evidence record was produced. */
export const EvidenceMethod = z.enum([
  "MANUAL", // human entered / configured
  "MANIFEST", // parsed from an imported manifest (never executed)
  "MODEL", // LLM suggestion (never a fact until reviewed)
  "FIXTURE", // synthetic demo seed
  "API", // read-only provider API read
  "RULE", // output of a versioned deterministic rule
]);
export type EvidenceMethod = z.infer<typeof EvidenceMethod>;

export const NodeKind = z.enum(["FUND", "CARD", "VENDOR", "SERVICE", "WORKFLOW", "OUTCOME"]);
export type NodeKind = z.infer<typeof NodeKind>;

export const Criticality = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]);
export type Criticality = z.infer<typeof Criticality>;

/** Edge relation, in impact direction (upstream financial -> downstream operation). */
export const EdgeRelation = z.enum(["BACKS", "PAYS", "POWERS", "REQUIRES", "AFFECTS"]);
export type EdgeRelation = z.infer<typeof EdgeRelation>;

export const DependencyStrength = z.enum(["HARD", "DEGRADED", "OPTIONAL"]);
export type DependencyStrength = z.infer<typeof DependencyStrength>;

/** Only CONFIRMED edges count toward confirmed blast radius; REJECTED is never traversed. */
export const ReviewStatus = z.enum(["CONFIRMED", "SUGGESTED", "REJECTED"]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

/** Confidence is distinct from severity. */
export const ConfidenceTier = z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]);
export type ConfidenceTier = z.infer<typeof ConfidenceTier>;

export const FundingProvider = z.enum(["RAMP", "DEMO"]);
export type FundingProvider = z.infer<typeof FundingProvider>;

/** Period semantics of a fund limit. Never add two periods without checking this. */
export const FundingInterval = z.enum([
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
  "TOTAL",
  "UNKNOWN",
]);
export type FundingInterval = z.infer<typeof FundingInterval>;

export const PaymentInstrumentKind = z.enum(["VIRTUAL_CARD", "PHYSICAL_CARD", "UNKNOWN"]);
export type PaymentInstrumentKind = z.infer<typeof PaymentInstrumentKind>;

export const PaymentInstrumentStatus = z.enum(["ACTIVE", "SUSPENDED", "TERMINATED", "UNKNOWN"]);
export type PaymentInstrumentStatus = z.infer<typeof PaymentInstrumentStatus>;

/** Only CARD-billed charges enter card-limit calculations. */
export const BillingMethod = z.enum(["CARD", "INVOICE", "UNKNOWN"]);
export type BillingMethod = z.infer<typeof BillingMethod>;

export const ChargeStatus = z.enum([
  "SCHEDULED",
  "FORECAST",
  "RESCHEDULED",
  "CLEARED",
  "DECLINED",
  "CANCELLED",
]);
export type ChargeStatus = z.infer<typeof ChargeStatus>;

export const TransactionState = z.enum(["PENDING", "CLEARED", "DECLINED", "REVERSED"]);
export type TransactionState = z.infer<typeof TransactionState>;

export const Severity = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]);
export type Severity = z.infer<typeof Severity>;

export const IncidentStatus = z.enum(["OPEN", "ACKNOWLEDGED", "MONITORING", "RESOLVED"]);
export type IncidentStatus = z.infer<typeof IncidentStatus>;

/** Deterministic risk categories (Section 5). */
export const RiskCategory = z.enum([
  "PROJECTED_SHORTFALL",
  "OBSERVED_DECLINE",
  "UNKNOWN_DATA",
  "NO_RISK",
]);
export type RiskCategory = z.infer<typeof RiskCategory>;

export const SimulationPatchKind = z.enum([
  "INCREASE_AVAILABLE_ALLOCATION",
  "ASSIGN_ALTERNATE_FUND",
  "MARK_CHARGE_RESCHEDULED",
  "MARK_DEPENDENCY_VERIFIED",
]);
export type SimulationPatchKind = z.infer<typeof SimulationPatchKind>;

/**
 * Action proposal lifecycle. There is intentionally no EXECUTED state:
 * the MVP never executes externally.
 */
export const ActionProposalState = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED_FOR_DEMO",
  "REJECTED",
]);
export type ActionProposalState = z.infer<typeof ActionProposalState>;

/** Allowed action proposal state transitions (anything else is a 409). */
export const ACTION_PROPOSAL_TRANSITIONS: Readonly<
  Record<ActionProposalState, readonly ActionProposalState[]>
> = {
  DRAFT: ["PENDING_APPROVAL", "REJECTED"],
  PENDING_APPROVAL: ["APPROVED_FOR_DEMO", "REJECTED"],
  APPROVED_FOR_DEMO: [],
  REJECTED: [],
};

export function canTransitionActionProposal(
  from: ActionProposalState,
  to: ActionProposalState,
): boolean {
  return ACTION_PROPOSAL_TRANSITIONS[from].includes(to);
}
