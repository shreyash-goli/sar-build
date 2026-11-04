/** Risk outputs and the Runtime provenance contract (Sections 4 and 5). */
import * as z from "zod";
import { ConfidenceTier, RiskCategory, Severity, SourceClass } from "./enums";
import { NullableCentsSchema } from "./money";
import { IdSchema, IsoDateTimeSchema, NonEmptyTextSchema } from "./primitives";

/** Versioned deterministic rule ID, e.g. "projected-shortfall-v1". */
export const RuleIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*-v\d+$/, "ruleId must be kebab-case with a -vN version suffix");

/** Immutable input reference, e.g. "evidence:fund-auth-availability". */
export const InputRefSchema = z
  .string()
  .regex(/^[a-z][a-z-]*:\S+$/, 'input must be a typed reference like "evidence:<id>"');

/**
 * Graph path reference from src/lib/graph ("path:" + edge IDs joined by "|").
 * Longer than a record ID by design: it spells out the exact causal chain.
 */
export const PathIdSchema = z
  .string()
  .max(4096)
  .regex(/^path:[^|\s]+(\|[^|\s]+)*$/, 'path id must look like "path:<edgeId>|<edgeId>..."');

/** Every UI assertion has this inspectable chain. */
export const RiskAssertionSchema = z
  .strictObject({
    assertionId: IdSchema,
    claim: NonEmptyTextSchema,
    status: SourceClass,
    ruleId: RuleIdSchema,
    inputs: z.array(InputRefSchema),
    evaluatedAt: IsoDateTimeSchema,
    /** null = unknown amount (never 0). */
    amountCents: NullableCentsSchema,
    limitations: z.array(NonEmptyTextSchema),
  })
  .refine(
    (a) => a.inputs.length > 0 || (a.status === "UNKNOWN" && a.limitations.length > 0),
    {
      message:
        "assertions must cite at least one input; only UNKNOWN assertions may omit inputs, and must then list limitations",
      path: ["inputs"],
    },
  );
export type RiskAssertion = z.infer<typeof RiskAssertionSchema>;

/** One reason in a risk event's reason array. Unknown numbers stay null. */
export const RiskReasonSchema = z.strictObject({
  riskRuleId: RuleIdSchema,
  thresholdDays: z.int().nonnegative().nullable(),
  amountCents: NullableCentsSchema,
  daysUntil: z.int().nullable(),
  confirmedImpactedPathIds: z.array(PathIdSchema),
  detail: NonEmptyTextSchema,
});
export type RiskReason = z.infer<typeof RiskReasonSchema>;

/** Deterministic risk engine output. Severity and confidence are independent. */
export const RiskEvaluationSchema = z
  .strictObject({
    category: RiskCategory,
    severity: Severity,
    confidence: ConfidenceTier,
    reasons: z.array(RiskReasonSchema).min(1, "risk output must explain itself"),
    assertion: RiskAssertionSchema,
    /** Mappings the user must supply when category is UNKNOWN_DATA. */
    requestedMappings: z.array(NonEmptyTextSchema),
  })
  .refine((r) => r.category !== "UNKNOWN_DATA" || r.severity === "UNKNOWN", {
    message: "UNKNOWN_DATA must have UNKNOWN severity",
    path: ["severity"],
  });
export type RiskEvaluation = z.infer<typeof RiskEvaluationSchema>;
