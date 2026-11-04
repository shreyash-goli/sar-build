/**
 * Incident status transitions applied by the evaluator (pure).
 *
 * Risky = severity CRITICAL, HIGH, MEDIUM or UNKNOWN (UNKNOWN needs a human
 * mapping, so it is actionable). Quiet = severity LOW.
 *
 *   new incident        risky -> OPEN          quiet -> MONITORING
 *   OPEN                risky -> OPEN          quiet -> RESOLVED
 *   ACKNOWLEDGED        risky -> ACKNOWLEDGED  quiet -> RESOLVED   (human ack is kept...)
 *                       ...unless severity ESCALATED (e.g. HIGH -> CRITICAL) -> OPEN
 *                       (the escalation is recorded as previousSeverity in snapshotJson)
 *   MONITORING          risky -> OPEN          quiet -> MONITORING
 *   RESOLVED            risky -> OPEN (reopen) quiet -> RESOLVED
 *   subject no longer evaluated (charge settled/removed, decline aged out):
 *                       any non-RESOLVED -> RESOLVED
 */
import type { IncidentStatus, Severity } from "@/lib/schema";

export const isRisky = (s: Severity) => s !== "LOW";

/** Escalation order: LOW < UNKNOWN < MEDIUM < HIGH < CRITICAL. */
export const SEVERITY_ESCALATION_RANK: Readonly<Record<Severity, number>> = { LOW: 0, UNKNOWN: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export function isEscalation(previous: Severity | null, next: Severity): boolean {
  return previous !== null && SEVERITY_ESCALATION_RANK[next] > SEVERITY_ESCALATION_RANK[previous];
}

export function nextIncidentStatus(
  current: IncidentStatus | null,
  severity: Severity,
  previousSeverity: Severity | null = null,
): IncidentStatus {
  const risky = isRisky(severity);
  switch (current) {
    case null:
      return risky ? "OPEN" : "MONITORING";
    case "OPEN":
      return risky ? "OPEN" : "RESOLVED";
    case "ACKNOWLEDGED":
      if (!risky) return "RESOLVED";
      return isEscalation(previousSeverity, severity) ? "OPEN" : "ACKNOWLEDGED";
    case "MONITORING":
      return risky ? "OPEN" : "MONITORING";
    case "RESOLVED":
      return risky ? "OPEN" : "RESOLVED";
  }
}
