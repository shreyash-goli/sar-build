/**
 * Client-safe contract for the incident list/detail read path (FS-13).
 * Import from "@/lib/incidents/schema" (NOT "@/lib/incidents", which is server-only).
 *   GET /api/incidents[?severity&status&category&signal&q&sort] -> apiSuccessSchema(IncidentListDataSchema)
 *   GET /api/incidents/[id]                                       -> apiSuccessSchema(IncidentDetailSchema)
 */
import * as z from "zod";
import { EvidenceCategorySchema, ProvenanceToneSchema } from "../provenance/ledger-schema";
import {
  ConfidenceTier,
  Criticality,
  DependencyStrength,
  EdgeRelation,
  EvidenceMethod,
  IncidentStatus,
  NodeKind,
  ReviewStatus,
  RiskCategory,
  Severity,
  SourceClass,
  VerificationStatus,
} from "../schema/enums";
import { IsoDateTimeSchema } from "../schema/primitives";
import { RiskEvaluationSchema } from "../schema/risk";
import { RunbookSchema } from "../actions/runbooks";

/** FORECAST = projected from a scheduled charge; OBSERVED_DECLINE = a transaction that actually declined. */
export const IncidentSignal = z.enum(["FORECAST", "OBSERVED_DECLINE"]);
export type IncidentSignal = z.infer<typeof IncidentSignal>;

const WorkflowRef = z.strictObject({ nodeId: z.string(), label: z.string(), criticality: Criticality, owner: z.string().nullable() });

export const IncidentListItemSchema = z.strictObject({
  id: z.string(),
  incidentKey: z.string(),
  title: z.string(),
  signal: IncidentSignal,
  category: RiskCategory,
  severity: Severity,
  confidence: ConfidenceTier,
  status: IncidentStatus,
  vendorId: z.string().nullable(),
  vendorName: z.string(),
  /** Shortfall (forecast) or declined amount; null when unknown. */
  amountCents: z.int().nullable(),
  dueInDays: z.int().nullable(),
  /** Charge date (forecast) or decline date. */
  at: IsoDateTimeSchema.nullable(),
  firstSeenAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  topWorkflow: WorkflowRef.nullable(),
  confirmedPathCount: z.int().nonnegative(),
  /** Distinct classifications of the evidence the evaluation cites (provenance at a glance). */
  sourceClasses: z.array(SourceClass),
});
export type IncidentListItem = z.infer<typeof IncidentListItemSchema>;

export const IncidentListDataSchema = z.strictObject({
  incidents: z.array(IncidentListItemSchema),
  total: z.int().nonnegative(),
  /** Incidents whose snapshot could not be read (never silently dropped). */
  unreadableIncidentIds: z.array(z.string()),
});
export type IncidentListData = z.infer<typeof IncidentListDataSchema>;

export const IncidentListQuerySchema = z.strictObject({
  severity: Severity.optional(),
  status: IncidentStatus.optional(),
  category: RiskCategory.optional(),
  signal: IncidentSignal.optional(),
  /** Case-insensitive match on title or vendor name. */
  q: z.string().trim().min(1).max(100).optional(),
  /** severity (default): severity, soonest due, id. updated: most recently updated first. due: soonest first. */
  sort: z.enum(["severity", "updated", "due"]).optional(),
});
export type IncidentListQuery = z.infer<typeof IncidentListQuerySchema>;

export const CalculationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("SHORTFALL"),
    formula: z.string(),
    expectedCents: z.int(),
    availableCents: z.int(),
    committedBeforeCents: z.int(),
    effectiveAvailableCents: z.int(),
    shortfallCents: z.int(),
    marginCents: z.int(),
    expectedAt: IsoDateTimeSchema,
    dueInDays: z.int(),
    periodKeyUtc: z.string(),
    priorChargeIds: z.array(z.string()),
    /** Human-readable arithmetic, one line per step, in formatted dollars. */
    steps: z.array(z.string()),
    assumptions: z.array(z.string()),
  }),
  z.strictObject({
    kind: z.literal("DECLINE"),
    amountCents: z.int(),
    occurredAt: IsoDateTimeSchema,
    reason: z.string().nullable(),
    transactionId: z.string(),
  }),
  z.strictObject({
    kind: z.literal("UNKNOWN"),
    /** Known inputs still shown; unknowns are null (never 0). */
    expectedCents: z.int().nullable(),
    availableCents: z.int().nullable(),
    dueInDays: z.int().nullable(),
    requestedMappings: z.array(z.string()),
  }),
]);
export type IncidentCalculation = z.infer<typeof CalculationSchema>;

export const ImpactNodeSchema = z.strictObject({
  id: z.string(),
  /** "Unknown (<id>)" when the node no longer exists. */
  label: z.string(),
  kind: NodeKind.nullable(),
  criticality: Criticality.nullable(),
  owner: z.string().nullable(),
});

export const ImpactEdgeSchema = z.strictObject({
  id: z.string(),
  fromNodeId: z.string().nullable(),
  toNodeId: z.string().nullable(),
  relation: EdgeRelation.nullable(),
  dependencyStrength: DependencyStrength.nullable(),
  confidenceTier: ConfidenceTier.nullable(),
  reviewStatus: ReviewStatus.nullable(),
  evidenceId: z.string().nullable(),
});

export const ImpactChainSchema = z.strictObject({
  pathId: z.string(),
  nodes: z.array(ImpactNodeSchema),
  edges: z.array(ImpactEdgeSchema),
});

export const IncidentEvidenceSchema = z.strictObject({
  id: z.string(),
  kind: EvidenceMethod,
  classification: SourceClass,
  verificationStatus: VerificationStatus,
  sourceSystem: z.string(),
  sourceId: z.string(),
  capturedAt: IsoDateTimeSchema,
  excerpt: z.string().nullable(),
  label: z.string(),
  tone: ProvenanceToneSchema,
  category: EvidenceCategorySchema,
  badge: z.strictObject({ label: z.string(), tone: ProvenanceToneSchema, description: z.string() }).nullable(),
});

export const TimelineEventSchema = z.strictObject({
  at: IsoDateTimeSchema,
  kind: z.enum(["AVAILABILITY_OBSERVED", "TRANSACTION_DECLINED", "FIRST_DETECTED", "LAST_EVALUATED", "CHARGE_DUE", "AUDIT"]),
  label: z.string(),
  /** True for events after the evaluation time (e.g. the projected charge date). */
  projected: z.boolean(),
});

export const IncidentDetailSchema = IncidentListItemSchema.extend({
  evaluation: RiskEvaluationSchema,
  calculation: CalculationSchema,
  confirmedChains: z.array(ImpactChainSchema),
  /** Workflows/outcomes reachable only through SUGGESTED edges: shown separately, never counted. */
  possibleImpacts: z.array(ImpactNodeSchema),
  impactComplete: z.boolean(),
  /** Owners of the confirmed impacted workflows. */
  owners: z.array(WorkflowRef),
  evidence: z.array(IncidentEvidenceSchema),
  /** Cited evidence that no longer exists: render as unknown provenance. */
  missingEvidenceIds: z.array(z.string()),
  /** The DERIVED rule-evaluation record this incident cites. */
  ruleEvidenceId: z.string(),
  /** Assertion limitations: confidence caveats to show verbatim. */
  caveats: z.array(z.string()),
  timeline: z.array(TimelineEventSchema),
  resolution: z.enum(["SUBJECT_NO_LONGER_EVALUATED"]).nullable(),
  /** Rules-based response checklist (FS-16). Every step is manual. */
  runbook: RunbookSchema,
});
export type IncidentDetail = z.infer<typeof IncidentDetailSchema>;

export type IncidentSearchParams = Readonly<Record<string, string | string[] | undefined>>;
export type ParsedIncidentQuery =
  | { ok: true; query: IncidentListQuery }
  | { ok: false; issues: { param: string; message: string }[] };

/**
 * Parse Next.js searchParams (or a URL's query) into an IncidentListQuery.
 * Unknown params, unknown values and repeated params are rejected; empty values are absent.
 */
export function parseIncidentQuery(params: IncidentSearchParams): ParsedIncidentQuery {
  const raw: Record<string, string> = {};
  const issues: { param: string; message: string }[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    if (values.length > 1) {
      issues.push({ param: key, message: `"${key}" may only be given once` });
      continue;
    }
    if (values[0] !== undefined && values[0] !== "") raw[key] = values[0];
  }
  const r = IncidentListQuerySchema.safeParse(raw);
  if (!r.success) {
    for (const i of r.error.issues) {
      issues.push({ param: i.code === "unrecognized_keys" ? i.keys.join(", ") : i.path.map(String).join("."), message: i.message });
    }
  }
  return issues.length > 0 || !r.success ? { ok: false, issues } : { ok: true, query: r.data };
}
