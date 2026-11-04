/**
 * Client-safe contract for the dependency graph read path (FS-07).
 *   GET /api/graph -> apiSuccessSchema(GraphDataSchema)
 *   loadGraph()    -> GraphData (server components; src/lib/graph/load.ts)
 */
import * as z from "zod";
import { EvidenceCategorySchema, ProvenanceToneSchema } from "../provenance/ledger-schema";
import { BillingMethod, SourceClass, VerificationStatus } from "../schema/enums";
import { EdgeSchema, NodeSchema } from "../schema/graph";

export const GraphEvidenceSummarySchema = z.strictObject({
  id: z.string(),
  classification: SourceClass,
  verificationStatus: VerificationStatus,
  excerpt: z.string().nullable(),
  label: z.string(),
  tone: ProvenanceToneSchema,
  category: EvidenceCategorySchema,
  needsReview: z.boolean(),
  badge: z
    .strictObject({
      label: z.enum(["SIMULATION ONLY", "DEMO DATA", "SANDBOX DATA"]),
      tone: ProvenanceToneSchema,
      description: z.string(),
    })
    .nullable(),
});
export type GraphEvidenceSummary = z.infer<typeof GraphEvidenceSummarySchema>;

export const VendorMappingReason = z.enum([
  "NO_VENDOR_RECORD",
  "BILLING_METHOD_UNKNOWN",
  "CHARGE_WITHOUT_FUNDING_SOURCE",
  "NO_CONFIRMED_PAYMENT_EDGE",
]);
export type VendorMappingReason = z.infer<typeof VendorMappingReason>;

export const GraphVendorStatusSchema = z.strictObject({
  nodeId: z.string(),
  vendorId: z.string().nullable(),
  name: z.string(),
  billingMethod: BillingMethod.nullable(),
  needsMapping: z.boolean(),
  needsMappingReasons: z.array(VendorMappingReason),
});
export type GraphVendorStatus = z.infer<typeof GraphVendorStatusSchema>;

export const GraphDataSchema = z.strictObject({
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  /** Keyed by evidence id; covers every evidence record cited by a node or edge. */
  evidence: z.record(z.string(), GraphEvidenceSummarySchema),
  /** One entry per VENDOR node, sorted by nodeId. */
  vendors: z.array(GraphVendorStatusSchema),
  /** Evidence IDs cited by nodes/edges that do not exist (render as unknown provenance). */
  unresolvedEvidenceIds: z.array(z.string()),
});
export type GraphData = z.infer<typeof GraphDataSchema>;
