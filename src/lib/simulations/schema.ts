/**
 * Client-safe contract for counterfactual simulations (FS-14, Response Studio).
 *   POST /api/scenarios/run   body ScenarioRunRequestSchema -> apiSuccessSchema(ScenarioRunDataSchema)  (201)
 *   GET  /api/scenarios[?incidentId=] -> apiSuccessSchema(ScenarioListDataSchema)
 * Every result is SIMULATION ONLY: modeled on an in-memory copy; no stored
 * funds, transactions, charges or edges are changed, and nothing touches Ramp.
 */
import * as z from "zod";
import { ConfidenceTier, RiskCategory, Severity } from "../schema/enums";
import { IsoDateTimeSchema, JsonValueSchema } from "../schema/primitives";
import { SimulationPatchSchema } from "../schema/simulation";

export const SIMULATION_LABEL = "SIMULATION ONLY" as const;
export const SIMULATION_RULE_ID = "simulation-v1" as const;
export const MODELED_CHANGE_ASSUMPTION = "Modeled change; no Ramp funds or card limits were changed";

export const FindingSummarySchema = z.strictObject({
  incidentKey: z.string(),
  title: z.string(),
  category: RiskCategory,
  severity: Severity,
  confidence: ConfidenceTier,
  /** Shortfall (forecast) or declined amount; null when unknown. */
  amountCents: z.int().nullable(),
  shortfallCents: z.int().nullable(),
  marginCents: z.int().nullable(),
  availableCents: z.int().nullable(),
  effectiveAvailableCents: z.int().nullable(),
  expectedCents: z.int().nullable(),
  dueInDays: z.int().nullable(),
  confirmedPathIds: z.array(z.string()),
});
export type FindingSummary = z.infer<typeof FindingSummarySchema>;

export const ChangedInputSchema = z.strictObject({
  entity: z.enum(["FUNDING_SOURCE", "VENDOR_CHARGE", "EDGE"]),
  id: z.string(),
  field: z.string(),
  before: JsonValueSchema,
  after: JsonValueSchema,
});
export type ChangedInput = z.infer<typeof ChangedInputSchema>;

export const FindingDiffSchema = z.strictObject({
  incidentKey: z.string(),
  before: FindingSummarySchema.nullable(),
  after: FindingSummarySchema.nullable(),
  /** Fields whose value differs (e.g. "severity", "shortfallCents"); [] when unchanged. */
  changedFields: z.array(z.string()),
});
export type FindingDiff = z.infer<typeof FindingDiffSchema>;

export const SimulationResultSchema = z.strictObject({
  label: z.literal(SIMULATION_LABEL),
  ruleVersion: z.strictObject({
    simulation: z.literal(SIMULATION_RULE_ID),
    shortfall: z.string(),
    severity: z.string(),
    decline: z.string(),
  }),
  evaluatedAt: IsoDateTimeSchema,
  /** The incident the simulation was run for, and its before/after. */
  focus: FindingDiffSchema,
  changedInputs: z.array(ChangedInputSchema),
  /** Always includes MODELED_CHANGE_ASSUMPTION. */
  assumptions: z.array(z.string()),
  before: z.array(FindingSummarySchema),
  after: z.array(FindingSummarySchema),
  /** Every finding, keyed by incidentKey (before ∪ after). */
  diff: z.array(FindingDiffSchema),
});
export type SimulationResult = z.infer<typeof SimulationResultSchema>;

export const SimulationRecordViewSchema = z.strictObject({
  id: z.string(),
  incidentId: z.string(),
  createdAt: IsoDateTimeSchema,
  createdBy: z.string(),
  isDemo: z.literal(true),
  label: z.literal(SIMULATION_LABEL),
  patch: SimulationPatchSchema,
  result: SimulationResultSchema,
});
export type SimulationRecordView = z.infer<typeof SimulationRecordViewSchema>;

export const ScenarioRunDataSchema = z.strictObject({
  simulation: SimulationRecordViewSchema,
  auditEventId: z.string(),
});
export type ScenarioRunData = z.infer<typeof ScenarioRunDataSchema>;

export const ScenarioListDataSchema = z.strictObject({
  simulations: z.array(SimulationRecordViewSchema),
  /** Stored simulations whose JSON could not be read (never silently dropped). */
  unreadableSimulationIds: z.array(z.string()),
});
export type ScenarioListData = z.infer<typeof ScenarioListDataSchema>;
