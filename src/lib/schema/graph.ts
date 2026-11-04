/** Dependency graph nodes and edges (Section 2, Graph semantics). */
import * as z from "zod";
import { ConfidenceTier, Criticality, DependencyStrength, EdgeRelation, NodeKind, ReviewStatus } from "./enums";
import { EvidenceRefSchema, IdSchema, NonEmptyTextSchema } from "./primitives";

export const NodeSchema = z.strictObject({
  id: IdSchema,
  kind: NodeKind,
  label: NonEmptyTextSchema,
  criticality: Criticality,
  owner: NonEmptyTextSchema.nullable(),
  evidenceId: EvidenceRefSchema,
});
export type GraphNode = z.infer<typeof NodeSchema>;

const notSelfLoop = (e: { fromNodeId: string; toNodeId: string }) => e.fromNodeId !== e.toNodeId;
const selfLoopIssue = { message: "edge cannot point to itself", path: ["toNodeId"] };

/** Directed, source-backed relationship in impact direction. evidenceId is mandatory. */
export const EdgeSchema = z
  .strictObject({
    id: IdSchema,
    fromNodeId: IdSchema,
    toNodeId: IdSchema,
    relation: EdgeRelation,
    dependencyStrength: DependencyStrength,
    confidenceTier: ConfidenceTier,
    reviewStatus: ReviewStatus,
    evidenceId: EvidenceRefSchema,
  })
  .refine(notSelfLoop, selfLoopIssue);
export type GraphEdge = z.infer<typeof EdgeSchema>;

/**
 * Edge arriving from an import (manifest, model suggestion, API mapping).
 * Must carry an evidence reference, and can only enter as SUGGESTED:
 * imports create suggestions, not facts. Promotion to CONFIRMED is a
 * separate human review step.
 */
export const ImportEdgeSchema = z
  .strictObject({
    fromNodeId: IdSchema,
    toNodeId: IdSchema,
    relation: EdgeRelation,
    dependencyStrength: DependencyStrength,
    confidenceTier: ConfidenceTier,
    reviewStatus: z.literal("SUGGESTED", {
      error: "imported edges must be SUGGESTED; confirmation requires human review",
    }),
    evidenceId: EvidenceRefSchema,
  })
  .refine(notSelfLoop, selfLoopIssue);
export type ImportEdge = z.infer<typeof ImportEdgeSchema>;

export const GraphSchema = z.strictObject({
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
});
export type Graph = z.infer<typeof GraphSchema>;
