/**
 * Simulation patches (Section 5, Simulation semantics). Strict: clients may not
 * supply risk scores, severities, or any field outside the patch kind.
 */
import * as z from "zod";
import { PositiveCentsSchema } from "./money";
import { IdSchema, IsoDateTimeSchema } from "./primitives";

export const IncreaseAvailableAllocationPatch = z.strictObject({
  kind: z.literal("INCREASE_AVAILABLE_ALLOCATION"),
  fundingSourceId: IdSchema,
  amountCents: PositiveCentsSchema,
});

export const AssignAlternateFundPatch = z.strictObject({
  kind: z.literal("ASSIGN_ALTERNATE_FUND"),
  vendorChargeId: IdSchema,
  fundingSourceId: IdSchema,
});

export const MarkChargeRescheduledPatch = z.strictObject({
  kind: z.literal("MARK_CHARGE_RESCHEDULED"),
  vendorChargeId: IdSchema,
  newExpectedAt: IsoDateTimeSchema,
});

export const MarkDependencyVerifiedPatch = z.strictObject({
  kind: z.literal("MARK_DEPENDENCY_VERIFIED"),
  edgeId: IdSchema,
});

export const SimulationPatchSchema = z.discriminatedUnion("kind", [
  IncreaseAvailableAllocationPatch,
  AssignAlternateFundPatch,
  MarkChargeRescheduledPatch,
  MarkDependencyVerifiedPatch,
]);
export type SimulationPatch = z.infer<typeof SimulationPatchSchema>;

/** Body of POST /api/scenarios/run. */
export const ScenarioRunRequestSchema = z.strictObject({
  incidentId: IdSchema,
  patch: SimulationPatchSchema,
});
export type ScenarioRunRequest = z.infer<typeof ScenarioRunRequestSchema>;
