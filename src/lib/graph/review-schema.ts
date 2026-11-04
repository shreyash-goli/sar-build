/**
 * Client-safe contract for reviewing SUGGESTED graph edges (FS-08).
 *   POST /api/graph/edges/[id]/review  EdgeReviewRequestSchema -> apiSuccessSchema(EdgeReviewDataSchema)
 */
import * as z from "zod";
import { IsoDateTimeSchema } from "../schema/primitives";
import { EdgeSchema } from "../schema/graph";
import { EvidenceRecordSchema } from "../schema/evidence";

export const EDGE_REVIEW_AUDIT = { confirmed: "graph.edge.confirmed", rejected: "graph.edge.rejected" } as const;

export const EdgeReviewRequestSchema = z.strictObject({
  decision: z.enum(["CONFIRM", "REJECT"]),
  reviewer: z.string().trim().min(1, "reviewer is required").max(80),
  /** Human justification (required). On CONFIRM it becomes the excerpt of the new USER_VERIFIED evidence. */
  justification: z.string().trim().min(10, "a justification of at least 10 characters is required").max(2000),
});
export type EdgeReviewRequest = z.infer<typeof EdgeReviewRequestSchema>;

const IncidentChangeSummary = z.strictObject({
  evaluatedAt: IsoDateTimeSchema,
  findings: z.int().nonnegative(),
  created: z.array(z.string()),
  updated: z.array(z.string()),
  unchanged: z.array(z.string()),
  resolved: z.array(z.string()),
  ruleEvidenceCreated: z.array(z.string()),
});

export const EdgeReviewDataSchema = z.strictObject({
  decision: z.enum(["CONFIRM", "REJECT"]),
  edge: EdgeSchema,
  /** The evidence the edge now cites: NEW USER_VERIFIED evidence on CONFIRM; the unchanged prior evidence on REJECT. */
  evidence: EvidenceRecordSchema,
  /** The evidence the edge cited before the review (never modified). */
  previousEvidenceId: z.string(),
  auditEventId: z.string(),
  /** Risk engine re-run after the review: which incidents changed. */
  incidents: IncidentChangeSummary,
});
export type EdgeReviewData = z.infer<typeof EdgeReviewDataSchema>;
