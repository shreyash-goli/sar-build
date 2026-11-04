/**
 * API contract for the evidence ledger / Sources inspector (FS-05).
 *   GET /api/sources       -> apiSuccessSchema(SourcesListDataSchema)
 *   GET /api/sources/[id]  -> apiSuccessSchema(EvidenceLedgerEntrySchema)
 * Errors use ApiErrorSchema ({ error: { code, message, details? } }).
 */
import * as z from "zod";
import {
  EdgeRelation,
  EvidenceMethod,
  ReviewStatus,
  SourceClass,
  VerificationStatus,
} from "../schema/enums";
import { IsoDateTimeSchema } from "../schema/primitives";

export const EvidenceSubjectType = z.enum([
  "FUNDING_SOURCE",
  "PAYMENT_INSTRUMENT",
  "VENDOR",
  "VENDOR_CHARGE",
  "TRANSACTION",
  "NODE",
  "EDGE",
  "INCIDENT",
]);
export type EvidenceSubjectType = z.infer<typeof EvidenceSubjectType>;

/** One assertion (record, node, edge, incident) supported by an evidence record. */
export const SupportedAssertionSchema = z.strictObject({
  subjectType: EvidenceSubjectType,
  subjectId: z.string(),
  /** Human-readable claim, e.g. "CloudComms POWERS OTP gateway" or "CloudComms charge $2,450.00 expected 2026-11-19". */
  label: z.string(),
  /** Edge-only details; null for other subjects. */
  edge: z
    .strictObject({
      fromNodeId: z.string(),
      toNodeId: z.string(),
      relation: EdgeRelation,
      reviewStatus: ReviewStatus,
    })
    .nullable(),
});
export type SupportedAssertion = z.infer<typeof SupportedAssertionSchema>;

/** Rule lineage for DERIVED evidence, read from the incident that cites it (risk engine, FS-11). */
export const RuleLineageEntrySchema = z.strictObject({
  ruleId: z.string(),
  assertionId: z.string(),
  evaluatedAt: IsoDateTimeSchema,
  inputs: z.array(z.string()),
});
export type RuleLineageEntry = z.infer<typeof RuleLineageEntrySchema>;

export const ProvenanceToneSchema = z.enum(["demo", "sandbox", "observed", "suggested", "derived", "unknown"]);
export const EvidenceCategorySchema = z.enum(["synthetic", "observed", "derived", "suggested", "unknown"]);

export const SourceDisplaySchema = z.strictObject({
  label: z.string(),
  shortDescription: z.string(),
  tone: ProvenanceToneSchema,
  category: EvidenceCategorySchema,
  isSimulated: z.boolean(),
  needsReview: z.boolean(),
  /** "DEMO DATA" / "SANDBOX DATA" badge, or null for non-simulated sources. */
  badge: z
    .strictObject({
      label: z.enum(["SIMULATION ONLY", "DEMO DATA", "SANDBOX DATA"]),
      tone: ProvenanceToneSchema,
      description: z.string(),
    })
    .nullable(),
});

export const LineageStatus = z.enum(["CURRENT", "SUPERSEDED", "NOT_APPLICABLE"]);
export type LineageStatus = z.infer<typeof LineageStatus>;

export const SUPERSEDED_LINEAGE_NOTE = "Superseded evaluation; not cited by a current incident";

export const EvidenceLedgerEntrySchema = z.strictObject({
  id: z.string(),
  kind: EvidenceMethod,
  classification: SourceClass,
  display: SourceDisplaySchema,
  sourceSystem: z.string(),
  sourceId: z.string(),
  excerpt: z.string().nullable(),
  path: z.string().nullable(),
  contentHash: z.string().nullable(),
  capturedAt: IsoDateTimeSchema,
  observedAt: IsoDateTimeSchema.nullable(),
  verificationStatus: VerificationStatus,
  verification: z.strictObject({ label: z.string(), needsReview: z.boolean() }),
  /** Every record/node/edge/incident that cites this evidence (sorted by type, then id). */
  supports: z.array(SupportedAssertionSchema),
  /** Always [] for non-DERIVED evidence; for DERIVED (risk-engine) evidence, the recorded rule evaluations. */
  ruleLineage: z.array(RuleLineageEntrySchema),
  /**
   * CURRENT: DERIVED evidence cited by a current incident (ruleLineage filled).
   * SUPERSEDED: DERIVED evidence from an earlier evaluation no longer cited by any
   *   incident (kept append-only; see lineageNote and recordedRule).
   * NOT_APPLICABLE: non-DERIVED evidence.
   */
  lineageStatus: LineageStatus,
  /** Human-readable status note, e.g. "Superseded evaluation; not cited by a current incident". */
  lineageNote: z.string().nullable(),
  /** What the RULE record itself recorded (present for every risk-engine record, current or superseded). */
  recordedRule: z
    .strictObject({
      /** Parsed from the record; null if it cannot be read (never guessed). */
      ruleId: z.string().nullable(),
      assertionId: z.string(),
      fingerprint: z.string().nullable(),
      evaluatedAt: IsoDateTimeSchema,
    })
    .nullable(),
  /**
   * True when DERIVED evidence was computed from synthetic inputs (DEMO_FIXTURE or
   * RAMP_SANDBOX), so the UI can say "Inputs are demo data". Classification stays DERIVED.
   * Always false for non-DERIVED evidence.
   */
  derivedFromSimulatedInputs: z.boolean(),
});
export type EvidenceLedgerEntry = z.infer<typeof EvidenceLedgerEntrySchema>;

/** A record that cites an evidenceId which does not exist (rendered as unknown provenance). */
export const UnresolvedEvidenceRefSchema = z.strictObject({
  subjectType: EvidenceSubjectType,
  subjectId: z.string(),
  evidenceId: z.string(),
});

export const SourcesListDataSchema = z.strictObject({
  entries: z.array(EvidenceLedgerEntrySchema),
  totals: z.strictObject({
    total: z.int().nonnegative(),
    byClassification: z.record(SourceClass, z.int().nonnegative()),
    byVerificationStatus: z.record(VerificationStatus, z.int().nonnegative()),
  }),
  unresolved: z.array(UnresolvedEvidenceRefSchema),
});
export type SourcesListData = z.infer<typeof SourcesListDataSchema>;

/** Accepted query params for GET /api/sources (all optional, exact enum values). */
export const SourcesListQuerySchema = z.strictObject({
  classification: SourceClass.optional(),
  verificationStatus: VerificationStatus.optional(),
});
export type SourcesListQuery = z.infer<typeof SourcesListQuerySchema>;

export type SearchParamsRecord = Readonly<Record<string, string | string[] | undefined>>;

export type ParsedSourcesQuery =
  | { ok: true; query: SourcesListQuery }
  | { ok: false; issues: { param: string; message: string }[] };

/**
 * Parse Next.js `searchParams` (or URLSearchParams entries) into a SourcesListQuery.
 * Same rules as GET /api/sources: unknown params, unknown values and repeated
 * params are rejected. Empty-string values are treated as absent.
 */
export function parseSourcesQuery(params: SearchParamsRecord): ParsedSourcesQuery {
  const raw: Record<string, string> = {};
  const issues: { param: string; message: string }[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length > 1) {
        issues.push({ param: key, message: `"${key}" may only be given once` });
        continue;
      }
      if (value[0] === undefined || value[0] === "") continue;
      raw[key] = value[0];
    } else if (value !== "") {
      raw[key] = value;
    }
  }
  const r = SourcesListQuerySchema.safeParse(raw);
  if (!r.success) {
    for (const i of r.error.issues) {
      const param = i.code === "unrecognized_keys" ? i.keys.join(", ") : i.path.map(String).join(".");
      issues.push({ param, message: i.message });
    }
  }
  return issues.length > 0 || !r.success ? { ok: false, issues } : { ok: true, query: r.data };
}
