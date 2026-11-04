/**
 * Client-safe contract for the executive Overview (FS-12).
 *   GET /api/dashboard -> apiSuccessSchema(DashboardDataSchema)   (meta.evaluatedAt = resultsEvaluatedAt)
 *   loadDashboard()    -> DashboardData (server components; src/lib/dashboard/load.ts)
 * Every number is derived from engine-materialized incidents and stored records.
 */
import * as z from "zod";
import {
  ConfidenceTier,
  Criticality,
  IncidentStatus,
  RiskCategory,
  Severity,
  SourceClass,
  WorkspaceMode,
} from "../schema/enums";
import { IsoDateTimeSchema } from "../schema/primitives";

const Cents = z.int();
const Count = z.int().nonnegative();

export const DashboardMetricsSchema = z.strictObject({
  atRiskWorkflows: z.strictObject({
    value: Count,
    workflowIds: z.array(z.string()),
    definition: z.string(),
  }),
  unresolvedExposures: z.strictObject({
    value: Count,
    incidentIds: z.array(z.string()),
    definition: z.string(),
  }),
  potentialShortfall: z.strictObject({
    /** Sum of KNOWN projected shortfalls (integer cents). Unknown exposures are never added as 0. */
    knownCents: Cents.nonnegative(),
    /** Incidents contributing to knownCents. */
    incidentIds: z.array(z.string()),
    /** Active exposures whose amount cannot be quantified (UNKNOWN_DATA). */
    unknownCount: Count,
    unknownIncidentIds: z.array(z.string()),
    definition: z.string(),
  }),
});

export const DashboardWorkflowRefSchema = z.strictObject({
  nodeId: z.string(),
  label: z.string(),
  criticality: Criticality,
});

export const DashboardExposureSchema = z.strictObject({
  incidentId: z.string(),
  incidentKey: z.string(),
  title: z.string(),
  category: RiskCategory,
  severity: Severity,
  confidence: ConfidenceTier,
  status: IncidentStatus,
  vendorId: z.string().nullable(),
  vendorName: z.string(),
  /** Shortfall (PROJECTED_SHORTFALL) or declined amount (OBSERVED_DECLINE); null when unknown. */
  amountCents: Cents.nullable(),
  /** Days until the charge (shortfall/unknown); null for declines or unknown dates. */
  dueInDays: z.int().nullable(),
  /** Charge date or decline date. */
  at: IsoDateTimeSchema.nullable(),
  topWorkflow: DashboardWorkflowRefSchema.nullable(),
  confirmedPathCount: Count,
});
export type DashboardExposure = z.infer<typeof DashboardExposureSchema>;

export const DashboardHealthySchema = z.strictObject({
  incidentId: z.string(),
  vendorId: z.string().nullable(),
  vendorName: z.string(),
  marginCents: Cents.nullable(),
  dueInDays: z.int().nullable(),
});

export const DashboardImpactedWorkflowSchema = DashboardWorkflowRefSchema.extend({
  worstSeverity: Severity,
  incidentIds: z.array(z.string()),
});

export const ForecastPointSchema = z.strictObject({
  at: IsoDateTimeSchema,
  /** null = unknown amount (rendered as a gap, never 0). */
  amountCents: Cents.nullable(),
  kind: z.enum(["CLEARED", "SCHEDULED", "FORECAST", "RESCHEDULED"]),
  sourceId: z.string(),
});

export const VendorForecastSchema = z.strictObject({
  vendorId: z.string(),
  vendorName: z.string(),
  points: z.array(ForecastPointSchema),
});

export const DashboardDataSchema = z.strictObject({
  workspaceMode: WorkspaceMode,
  /** When the risk engine last CHANGED a stored result (max incident updatedAt); null if no incidents. */
  lastChangedAt: IsoDateTimeSchema.nullable(),
  /**
   * When the currently stored results were computed (max evaluation time recorded in the
   * incidents' snapshots). Unchanged reruns write nothing, so this is not "last run time".
   */
  resultsEvaluatedAt: IsoDateTimeSchema.nullable(),
  metrics: DashboardMetricsSchema,
  /** Alerts (OPEN/ACKNOWLEDGED, non-LOW, non-NO_RISK), ranked: severity, then soonest due, then id. */
  exposures: z.array(DashboardExposureSchema),
  /** Active LOW (healthy) subjects, so the overview is not only alarms. */
  healthy: z.array(DashboardHealthySchema),
  /** Workflows on confirmed paths of CRITICAL/HIGH/MEDIUM alerts, worst first. */
  topImpactedWorkflows: z.array(DashboardImpactedWorkflowSchema),
  /** Per vendor: positive cleared history + upcoming charges, oldest first. */
  forecast: z.array(VendorForecastSchema),
  freshness: z.strictObject({
    /** Latest capturedAt over source evidence (excludes risk-engine RULE records). */
    latestSourceCapturedAt: IsoDateTimeSchema.nullable(),
    /** Latest funding availability reading. */
    latestFundObservedAt: IsoDateTimeSchema.nullable(),
    sourceEvidenceCount: Count,
    byClassification: z.record(SourceClass, Count),
  }),
  /** Incidents whose snapshot could not be read; excluded from every metric. */
  unreadableIncidentIds: z.array(z.string()),
});
export type DashboardData = z.infer<typeof DashboardDataSchema>;

export const METRIC_DEFINITIONS = {
  atRiskWorkflows:
    "Distinct workflows reached by a CONFIRMED dependency path from an unresolved CRITICAL, HIGH or MEDIUM incident. Suggested edges are not counted. Potential impact, not a confirmed outage.",
  unresolvedExposures:
    "Unresolved incidents for a projected funding shortfall or an observed transaction decline. Unknown-data incidents are listed separately as needing mapping.",
  potentialShortfall:
    "Sum of known projected shortfalls (expected charge minus available allocation) across unresolved shortfall incidents. Exposures with missing inputs are counted separately and never added as $0. Only shortfalls due within the 14-day scoring window are counted; later ones are monitored, not counted.",
} as const;
