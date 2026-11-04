/** EvidenceRecord: explains why a record, edge or risk exists. */
import * as z from "zod";
import { EvidenceMethod, SourceClass, VerificationStatus } from "./enums";
import { IdSchema, IsoDateTimeSchema } from "./primitives";

/**
 * Classifications each evidence method may carry. Model output can never be
 * classified as observed or derived; fixtures are always DEMO_FIXTURE.
 */
export const ALLOWED_CLASSIFICATIONS_BY_METHOD: Readonly<
  Record<EvidenceMethod, readonly SourceClass[]>
> = {
  FIXTURE: ["DEMO_FIXTURE"],
  MODEL: ["MODEL_SUGGESTED"],
  RULE: ["DERIVED"],
  API: ["RAMP_SANDBOX", "EXTERNAL_OBSERVED"],
  MANIFEST: ["EXTERNAL_OBSERVED", "MODEL_SUGGESTED"],
  MANUAL: ["DEMO_FIXTURE", "EXTERNAL_OBSERVED", "UNKNOWN"],
};

export function isAllowedEvidenceClassification(kind: EvidenceMethod, classification: SourceClass): boolean {
  return ALLOWED_CLASSIFICATIONS_BY_METHOD[kind].includes(classification);
}

export const EvidenceRecordSchema = z.strictObject({
  id: IdSchema,
  kind: EvidenceMethod,
  /** Originating system, e.g. "northstar-demo-seed", "ramp-sandbox", "repo-manifest". */
  sourceSystem: z.string().trim().min(1),
  /** Original ID or key within sourceSystem. */
  sourceId: z.string().trim().min(1),
  /** Ingest timestamp. */
  capturedAt: IsoDateTimeSchema,
  /** Source timestamp, if the source provides one. */
  observedAt: IsoDateTimeSchema.nullable(),
  excerpt: z.string().max(4000).nullable(),
  path: z.string().max(1024).nullable(),
  contentHash: z.string().trim().min(1).max(256).nullable(),
  classification: SourceClass,
  verificationStatus: VerificationStatus,
}).refine((e) => isAllowedEvidenceClassification(e.kind, e.classification), {
  message: "classification is not allowed for this evidence kind",
  path: ["classification"],
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
