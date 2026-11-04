/**
 * Financial and operational domain objects (Section 2 table).
 * Field names are the contract for FS-03 Prisma models.
 *
 * Optional-in-blueprint fields (`field?`) are modelled as REQUIRED keys whose
 * value may be `null` (strict nulls): a missing key fails validation, so
 * "unknown" is always explicit and never silently defaulted.
 */
import * as z from "zod";
import {
  ActionProposalState,
  BillingMethod,
  ChargeStatus,
  FundingInterval,
  FundingProvider,
  IncidentStatus,
  PaymentInstrumentKind,
  PaymentInstrumentStatus,
  Severity,
  SimulationPatchKind,
  SourceClass,
  TransactionState,
  WorkspaceMode,
} from "./enums";
import { CentsSchema, NullableNonNegativeCentsSchema } from "./money";
import { EvidenceRefSchema, IdSchema, IsoDateTimeSchema, JsonValueSchema, NonEmptyTextSchema } from "./primitives";
import { RuleIdSchema } from "./risk";
import { SimulationPatchSchema } from "./simulation";

export const WorkspaceSchema = z.strictObject({
  id: IdSchema,
  name: NonEmptyTextSchema,
  mode: WorkspaceMode,
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const FundingSourceSchema = z.strictObject({
  id: IdSchema,
  provider: FundingProvider,
  externalFundId: z.string().trim().min(1).nullable(),
  name: NonEmptyTextSchema,
  interval: FundingInterval,
  /** null = unknown limit. Never 0 as a stand-in. */
  limitCents: NullableNonNegativeCentsSchema,
  /** null = unknown availability. Never 0 as a stand-in. */
  availableCents: NullableNonNegativeCentsSchema,
  observedAt: IsoDateTimeSchema,
  evidenceId: EvidenceRefSchema,
});
export type FundingSource = z.infer<typeof FundingSourceSchema>;

/**
 * Field names that must never appear on card/instrument payloads.
 * Compared case-insensitively after stripping non-alphanumerics.
 */
export const CARD_SECRET_KEYS = [
  "pan",
  "cardnumber",
  "primaryaccountnumber",
  "number",
  "cvv",
  "cvc",
  "cvv2",
  "cvc2",
  "securitycode",
  "cardsecuritycode",
  "pin",
  "expiration",
  "expiry",
  "expirationdate",
  "track1",
  "track2",
] as const;

const secretKeySet = new Set<string>(CARD_SECRET_KEYS);
const normalizeKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Recursively find card-secret-like keys in an untrusted payload (e.g. a provider
 * API response) so importers can refuse it before mapping. Returns dotted paths.
 */
export function findCardSecretKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [];
  const out: string[] = [];
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  for (const [key, child] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!Array.isArray(value) && secretKeySet.has(normalizeKey(key))) out.push(path);
    out.push(...findCardSecretKeys(child, path));
  }
  return out;
}

/** Matches PAN-shaped strings: 12-19 digits, optionally separated by spaces or dashes. */
export const PAN_LIKE_PATTERN = /^\d(?:[ -]?\d){11,18}$/;

/** Provider card identifier. Must never be (or look like) a card number. */
export const ExternalCardIdSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => !PAN_LIKE_PATTERN.test(v), {
    message: "externalCardId looks like a card number (PAN); store the provider card ID only",
  });

/** Card metadata only. Strict: any extra key (including PAN/CVV) is rejected. */
export const PaymentInstrumentSchema = z.strictObject({
  id: IdSchema,
  kind: PaymentInstrumentKind,
  externalCardId: ExternalCardIdSchema.nullable(),
  fundingSourceId: IdSchema.nullable(),
  status: PaymentInstrumentStatus,
  evidenceId: EvidenceRefSchema,
});
export type PaymentInstrument = z.infer<typeof PaymentInstrumentSchema>;

export const VendorSchema = z.strictObject({
  id: IdSchema,
  name: NonEmptyTextSchema,
  /** Stable dedupe key, e.g. lowercased slug. Not a display name. */
  normalizedKey: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, "normalizedKey must be lowercase slug"),
  billingMethod: BillingMethod,
  evidenceId: EvidenceRefSchema,
});
export type Vendor = z.infer<typeof VendorSchema>;

export const VendorChargeSchema = z.strictObject({
  id: IdSchema,
  vendorId: IdSchema,
  fundingSourceId: IdSchema.nullable(),
  expectedAt: IsoDateTimeSchema,
  /** null = unknown amount. Never 0 as a stand-in. */
  expectedCents: NullableNonNegativeCentsSchema,
  status: ChargeStatus,
  sourceClass: SourceClass,
  evidenceId: EvidenceRefSchema,
});
export type VendorCharge = z.infer<typeof VendorChargeSchema>;

export const TransactionSchema = z.strictObject({
  id: IdSchema,
  /** Idempotency key for ingest; unique when present. */
  providerEventId: z.string().trim().min(1).nullable(),
  vendorId: IdSchema,
  fundingSourceId: IdSchema.nullable(),
  occurredAt: IsoDateTimeSchema,
  /** Signed integer cents (reversals may be negative). Required: a transaction amount is observed. */
  amountCents: CentsSchema,
  state: TransactionState,
  reason: z.string().trim().min(1).nullable(),
  evidenceId: EvidenceRefSchema,
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const IncidentSchema = z.strictObject({
  id: IdSchema,
  scenarioKey: z.string().trim().min(1).nullable(),
  status: IncidentStatus,
  severity: Severity,
  title: NonEmptyTextSchema,
  firstSeenAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  primaryVendorId: IdSchema.nullable(),
  /** Versioned rule ID, e.g. "projected-shortfall-v1". */
  detectionRule: RuleIdSchema,
  snapshotJson: JsonValueSchema,
  evidenceId: EvidenceRefSchema,
});
export type Incident = z.infer<typeof IncidentSchema>;

/** Counterfactual; never a real payment action. */
export const SimulationSchema = z.strictObject({
  id: IdSchema,
  incidentId: IdSchema,
  patchJson: SimulationPatchSchema,
  beforeJson: JsonValueSchema,
  afterJson: JsonValueSchema,
  createdAt: IsoDateTimeSchema,
  createdBy: NonEmptyTextSchema,
  isDemo: z.boolean(),
});
export type Simulation = z.infer<typeof SimulationSchema>;

export const ActionProposalSchema = z.strictObject({
  id: IdSchema,
  incidentId: IdSchema,
  kind: SimulationPatchKind,
  payloadJson: SimulationPatchSchema,
  state: ActionProposalState,
  approver: NonEmptyTextSchema.nullable(),
  /** MVP never executes externally: proposals are always simulated. */
  simulated: z.literal(true),
  createdAt: IsoDateTimeSchema,
}).refine((p) => p.kind === p.payloadJson.kind, {
  message: "kind must match payloadJson.kind",
  path: ["kind"],
}).refine((p) => p.state !== "APPROVED_FOR_DEMO" || p.approver !== null, {
  message: "APPROVED_FOR_DEMO requires an approver",
  path: ["approver"],
});
export type ActionProposal = z.infer<typeof ActionProposalSchema>;

/** Immutable operational log entry. */
export const AuditEventSchema = z.strictObject({
  id: IdSchema,
  actor: NonEmptyTextSchema,
  action: z.string().trim().regex(/^[a-z][a-z0-9_.-]*$/, "action must be a dotted lowercase key"),
  subjectId: IdSchema,
  detailsJson: JsonValueSchema,
  at: IsoDateTimeSchema,
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;
