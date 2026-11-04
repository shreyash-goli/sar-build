import { Activity, CalendarClock } from "lucide-react";

import type { IncidentSignal } from "@/lib/incidents/schema";
import type { ConfidenceTier, IncidentStatus, Severity } from "@/lib/schema/enums";
import { Badge } from "@/components/ui/badge";
import { CONFIDENCE_LABEL, SEVERITY_LABEL, SEVERITY_VARIANT } from "@/components/dashboard/format";

/** FORECAST (projected from a scheduled charge) vs OBSERVED DECLINE (actually happened). */
export function SignalPill({ signal }: { signal: IncidentSignal }) {
  return signal === "FORECAST" ? (
    <Badge variant="info" data-testid="signal-pill" data-signal={signal} title="Projected from a scheduled or forecast charge">
      <CalendarClock aria-hidden="true" />
      Forecast
    </Badge>
  ) : (
    <Badge variant="warning" data-testid="signal-pill" data-signal={signal} title="A real transaction was declined">
      <Activity aria-hidden="true" />
      Observed decline
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge variant={SEVERITY_VARIANT[severity]} data-testid="severity-badge">
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}

export function ConfidenceText({ confidence }: { confidence: ConfidenceTier }) {
  return <span className="text-xs text-subtle">{CONFIDENCE_LABEL[confidence]}</span>;
}

export const STATUS_LABEL: Readonly<Record<IncidentStatus, string>> = {
  OPEN: "Open",
  ACKNOWLEDGED: "Acknowledged",
  MONITORING: "Monitoring",
  RESOLVED: "Resolved",
};

export function StatusBadge({ status }: { status: IncidentStatus }) {
  return (
    <Badge variant={status === "RESOLVED" ? "success" : "neutral"} className="normal-case tracking-normal">
      {STATUS_LABEL[status]}
    </Badge>
  );
}
