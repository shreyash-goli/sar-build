/**
 * Pure display helpers for the evidence ledger. Client- and server-safe.
 * Labels for classes/statuses come from the shared provenance contract.
 */
import {
  EVIDENCE_CATEGORY_DEFINITIONS,
  REVIEW_STATUS_DISPLAY,
  SOURCE_CLASS_DISPLAY,
  VERIFICATION_STATUS_DISPLAY,
  type EvidenceLedgerEntry,
  type EvidenceSubjectType,
} from "@/lib/provenance";
import type {
  EvidenceMethod,
  ReviewStatus,
  SourceClass,
  VerificationStatus,
} from "@/lib/schema/enums";
import type { BadgeProps } from "@/components/ui/badge";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

export const SUBJECT_TYPE_LABEL: Readonly<Record<EvidenceSubjectType, string>> =
  {
    FUNDING_SOURCE: "Funding source",
    PAYMENT_INSTRUMENT: "Payment instrument",
    VENDOR: "Vendor",
    VENDOR_CHARGE: "Vendor charge",
    TRANSACTION: "Transaction",
    NODE: "Graph node",
    EDGE: "Graph edge",
    INCIDENT: "Incident",
  };

export const METHOD_LABEL: Readonly<Record<EvidenceMethod, string>> = {
  MANUAL: "Manual entry",
  MANIFEST: "Imported manifest",
  MODEL: "Model suggestion",
  FIXTURE: "Demo fixture seed",
  API: "Read-only API",
  RULE: "Deterministic rule",
};

export const VERIFICATION_VARIANT: Readonly<
  Record<VerificationStatus, BadgeVariant>
> = {
  UNVERIFIED: "neutral",
  USER_VERIFIED: "success",
  REJECTED: "danger",
};

export const REVIEW_STATUS_VARIANT: Readonly<Record<ReviewStatus, BadgeVariant>> =
  {
    CONFIRMED: "success",
    SUGGESTED: "accent",
    REJECTED: "danger",
  };

export function sourceClassLabel(c: SourceClass): string {
  return SOURCE_CLASS_DISPLAY[c].label;
}

export function verificationLabel(v: VerificationStatus): string {
  return VERIFICATION_STATUS_DISPLAY[v].label;
}

export function reviewStatusLabel(r: ReviewStatus): string {
  return REVIEW_STATUS_DISPLAY[r].label;
}

export function categoryLabel(entry: EvidenceLedgerEntry): string {
  return EVIDENCE_CATEGORY_DEFINITIONS[entry.display.category].label;
}

/**
 * One plain-language answer to "is this demo/mock, or verified?".
 * Simulation status and human verification are independent axes; both shown.
 */
export function trustSummary(entry: EvidenceLedgerEntry): {
  simulation: string;
  verification: string;
} {
  const simulation = entry.display.isSimulated
    ? entry.classification === "RAMP_SANDBOX"
      ? "Sandbox / mock data. Not live company funds."
      : "Demo / mock data. Fictional; not live business evidence."
    : entry.classification === "DERIVED"
      ? "Derived by a deterministic rule. Only as real as its inputs: check the rule lineage."
      : entry.classification === "MODEL_SUGGESTED"
        ? "Model suggestion. A hypothesis, not a fact."
        : entry.classification === "UNKNOWN"
          ? "Origin unknown. Not assumed to be real or simulated."
          : "Not simulated. Not a demo fixture or sandbox record.";

  const verification =
    entry.verificationStatus === "USER_VERIFIED"
      ? "Verified by a human reviewer."
      : entry.verificationStatus === "REJECTED"
        ? "Rejected by a human reviewer. Do not rely on it."
        : "Unverified. No human has reviewed this record.";

  return { simulation, verification };
}
