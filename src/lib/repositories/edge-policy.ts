/**
 * Provenance policy for graph edges. Pure; enforced by the edge repository on
 * every create and update.
 *
 * Rules for storing an edge as CONFIRMED:
 * 1. Evidence must never be REJECTED.
 * 2. Evidence must be USER_VERIFIED. The single exception is synthetic demo
 *    evidence (kind FIXTURE, classification DEMO_FIXTURE), which may back an
 *    edge created directly as CONFIRMED inside the fictional demo workspace;
 *    it stays labelled DEMO_FIXTURE and is never claimed as verified.
 *    This applies to creates too, so deleting a SUGGESTED edge and recreating
 *    it as CONFIRMED cannot sidestep review.
 * 3. Promotion (an existing SUGGESTED/REJECTED edge updated to CONFIRMED) is a
 *    human review step: the cited evidence must be USER_VERIFIED, with no
 *    fixture exception.
 * Derived assertions never upgrade an unverified dependency to verified.
 */
import type { EvidenceRecord, ReviewStatus } from "@/lib/schema";

type EvidenceKindClass = Pick<EvidenceRecord, "kind" | "classification">;

/** Synthetic demo evidence: kind FIXTURE with classification DEMO_FIXTURE. */
export function isSyntheticFixtureEvidence(evidence: EvidenceKindClass): boolean {
  return evidence.kind === "FIXTURE" && evidence.classification === "DEMO_FIXTURE";
}

/** True when this evidence needs USER_VERIFIED status to back a CONFIRMED edge. */
export function evidenceRequiresReview(evidence: EvidenceKindClass): boolean {
  return !isSyntheticFixtureEvidence(evidence);
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
  if (evidence.verificationStatus === "USER_VERIFIED") return { ok: true };

  const isPromotion = previousStatus !== null && previousStatus !== "CONFIRMED";
  if (isPromotion) {
    return {
      ok: false,
      reason: `promoting an edge from ${previousStatus} to CONFIRMED requires USER_VERIFIED evidence`,
    };
  }
  if (evidenceRequiresReview(evidence)) {
    return {
      ok: false,
      reason: `a CONFIRMED edge must cite USER_VERIFIED evidence; unverified ${evidence.classification} (${evidence.kind}) evidence is only allowed for synthetic FIXTURE/DEMO_FIXTURE demo data`,
    };
  }
  return { ok: true };
}
