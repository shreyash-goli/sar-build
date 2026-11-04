/**
 * Provenance policy for graph edges. Pure; enforced by the edge repository on
 * every create and update.
 *
 * Rules for storing an edge as CONFIRMED:
 * 1. Evidence must never be REJECTED.
 * 2. Promotion (an existing SUGGESTED/REJECTED edge updated to CONFIRMED) is a
 *    human review step: the cited evidence must be USER_VERIFIED, whatever its kind.
 * 3. Otherwise, evidence that is a suggestion or a derivation (MODEL / MANIFEST /
 *    RULE method, or MODEL_SUGGESTED / DERIVED / UNKNOWN classification) must be
 *    USER_VERIFIED. Derived assertions never upgrade an unverified dependency.
 * Synthetic FIXTURE / DEMO_FIXTURE evidence may back an edge created directly as
 * CONFIRMED inside the fictional demo workspace (it stays labelled DEMO_FIXTURE).
 */
import type { EvidenceRecord, ReviewStatus } from "@/lib/schema";

const REVIEW_REQUIRED_METHODS = new Set<EvidenceRecord["kind"]>(["MODEL", "MANIFEST", "RULE"]);
const REVIEW_REQUIRED_CLASSES = new Set<EvidenceRecord["classification"]>([
  "MODEL_SUGGESTED",
  "DERIVED",
  "UNKNOWN",
]);

export function evidenceRequiresReview(evidence: Pick<EvidenceRecord, "kind" | "classification">): boolean {
  return REVIEW_REQUIRED_METHODS.has(evidence.kind) || REVIEW_REQUIRED_CLASSES.has(evidence.classification);
}

export type EdgeConfirmationCheck = { ok: true } | { ok: false; reason: string };

/**
 * @param previousStatus the stored review status for updates; `null` for creates.
 */
export function checkEdgeEvidence(
  reviewStatus: ReviewStatus,
  evidence: Pick<EvidenceRecord, "kind" | "classification" | "verificationStatus">,
  previousStatus: ReviewStatus | null = null,
): EdgeConfirmationCheck {
  if (reviewStatus !== "CONFIRMED") return { ok: true };
  if (evidence.verificationStatus === "REJECTED") {
    return { ok: false, reason: "a CONFIRMED edge cannot cite REJECTED evidence" };
  }
  const isPromotion = previousStatus !== null && previousStatus !== "CONFIRMED";
  if (isPromotion && evidence.verificationStatus !== "USER_VERIFIED") {
    return {
      ok: false,
      reason: `promoting an edge from ${previousStatus} to CONFIRMED requires USER_VERIFIED evidence`,
    };
  }
  if (evidenceRequiresReview(evidence) && evidence.verificationStatus !== "USER_VERIFIED") {
    return {
      ok: false,
      reason: `a CONFIRMED edge cannot cite unreviewed ${evidence.classification} (${evidence.kind}) evidence; a human must mark it USER_VERIFIED first`,
    };
  }
  return { ok: true };
}
