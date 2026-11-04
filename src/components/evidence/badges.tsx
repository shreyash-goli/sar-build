import { FlaskConical } from "lucide-react";

import type { EvidenceLedgerEntry } from "@/lib/provenance";
import { Badge } from "@/components/ui/badge";
import { PROVENANCE_TONE_VARIANT } from "@/components/ui/provenance-tone";
import { VERIFICATION_VARIANT } from "./labels";

export function SimulationBadge({ entry }: { entry: EvidenceLedgerEntry }) {
  const badge = entry.display.badge;
  if (!badge) return null;
  return (
    <Badge
      variant={PROVENANCE_TONE_VARIANT[badge.tone]}
      title={badge.description}
      data-testid="simulation-badge"
    >
      <FlaskConical aria-hidden="true" />
      {badge.label}
    </Badge>
  );
}

export function ClassificationBadge({ entry }: { entry: EvidenceLedgerEntry }) {
  return (
    <Badge
      variant={PROVENANCE_TONE_VARIANT[entry.display.tone]}
      title={entry.display.shortDescription}
      data-testid="classification-badge"
      className="normal-case tracking-normal"
    >
      {entry.display.label}
    </Badge>
  );
}

export function VerificationBadge({ entry }: { entry: EvidenceLedgerEntry }) {
  return (
    <Badge
      variant={VERIFICATION_VARIANT[entry.verificationStatus]}
      data-testid="verification-badge"
      className="normal-case tracking-normal"
    >
      {entry.verification.label}
    </Badge>
  );
}
