/**
 * Human review of SUGGESTED graph edges (FS-08). Server-only.
 *
 * - Only SUGGESTED edges are reviewable; any other status (including a repeat
 *   review of an edge already CONFIRMED/REJECTED) is 409 INVALID_TRANSITION.
 *   Repeats are deliberately NOT silent no-ops, so a stale UI cannot imply a
 *   second decision was recorded.
 * - CONFIRM appends NEW evidence (kind MANUAL, USER_VERIFIED) whose excerpt is
 *   the reviewer's justification and references the prior evidence; the edge is
 *   repointed to it. Prior evidence is never modified, and nothing beyond the
 *   human justification is invented.
 * - REJECT sets reviewStatus REJECTED and keeps the edge's evidence.
 * - Each decision writes one AuditEvent (subject = edge id) and re-runs the risk
 *   engine so incident impact reflects the decision. Call inside a transaction.
 */
import { randomUUID } from "node:crypto";
import { materializeIncidents } from "@/lib/incidents";
import { NotFoundError, RepositoryError, type Repositories } from "@/lib/repositories";
import type { EvidenceRecord, SourceClass } from "@/lib/schema";
import { EDGE_REVIEW_AUDIT, type EdgeReviewData, type EdgeReviewRequest } from "./review-schema";

export const GRAPH_REVIEW_SOURCE_SYSTEM = "failsafe-graph-review";

const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");

export async function reviewEdge(repos: Repositories, edgeId: string, req: EdgeReviewRequest, now: Date): Promise<EdgeReviewData> {
  const edge = await repos.edges.findById(edgeId);
  if (!edge) throw new NotFoundError("Edge", edgeId);
  if (edge.reviewStatus !== "SUGGESTED") {
    throw new RepositoryError("INVALID_TRANSITION", `Edge ${edgeId} is ${edge.reviewStatus}; only SUGGESTED edges can be reviewed`, {
      currentStatus: edge.reviewStatus,
    });
  }
  const previous = await repos.evidence.getById(edge.evidenceId);
  const at = iso(now);
  const [from, to] = await Promise.all([repos.nodes.findById(edge.fromNodeId), repos.nodes.findById(edge.toNodeId)]);
  const claim = `${from?.label ?? edge.fromNodeId} ${edge.relation} ${to?.label ?? edge.toNodeId}`;

  let evidence: EvidenceRecord;
  if (req.decision === "CONFIRM") {
    const [workspace] = await repos.workspaces.list();
    // A human review in the fictional demo workspace is still about demo data.
    const classification: SourceClass = workspace?.mode === "DEMO" ? "DEMO_FIXTURE" : "EXTERNAL_OBSERVED";
    const reviewId = randomUUID();
    evidence = await repos.evidence.create({
      id: `ev-review-${edgeId}-${reviewId.slice(0, 8)}`,
      kind: "MANUAL",
      sourceSystem: GRAPH_REVIEW_SOURCE_SYSTEM,
      sourceId: `${edgeId}#${reviewId}`,
      capturedAt: at,
      observedAt: at,
      excerpt: `Reviewer ${req.reviewer} confirmed "${claim}": ${req.justification} (prior evidence: ${previous.id})`,
      path: null,
      contentHash: null,
      classification,
      verificationStatus: "USER_VERIFIED",
    });
    await repos.edges.update(edgeId, { reviewStatus: "CONFIRMED", evidenceId: evidence.id });
  } else {
    evidence = previous;
    await repos.edges.update(edgeId, { reviewStatus: "REJECTED" });
  }
  const updated = await repos.edges.getById(edgeId);

  const auditEvent = await repos.auditEvents.create({
    id: `audit-${randomUUID()}`,
    actor: req.reviewer,
    action: req.decision === "CONFIRM" ? EDGE_REVIEW_AUDIT.confirmed : EDGE_REVIEW_AUDIT.rejected,
    subjectId: edgeId,
    detailsJson: {
      edgeId,
      claim,
      decision: req.decision,
      fromStatus: "SUGGESTED",
      toStatus: updated.reviewStatus,
      justification: req.justification,
      previousEvidenceId: previous.id,
      newEvidenceId: req.decision === "CONFIRM" ? evidence.id : null,
    },
    at,
  });

  const incidents = await materializeIncidents(repos, now);
  return { decision: req.decision, edge: updated, evidence, previousEvidenceId: previous.id, auditEventId: auditEvent.id, incidents };
}
