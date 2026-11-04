import Link from "next/link";
import { ChevronRight } from "lucide-react";

import type { IncidentListItem } from "@/lib/incidents/schema";
import { SOURCE_CLASS_DISPLAY } from "@/lib/provenance";
import { CATEGORY_LABEL, dueLabel, formatDayUtc } from "@/components/dashboard/format";
import { AMOUNT_TONE_CLASS, incidentAmountDisplay } from "./amount";
import { ConfidenceText, SeverityBadge, SignalPill, StatusBadge } from "./pills";

function when(i: IncidentListItem): string {
  if (i.signal === "OBSERVED_DECLINE") return i.at ? `Declined ${formatDayUtc(i.at)}` : "Decline date unknown";
  return dueLabel(i.dueInDays) ?? "Due date unknown";
}

export function IncidentList({
  incidents,
  testId = "incident-list",
  muted = false,
  headroom,
}: {
  incidents: IncidentListItem[];
  /** incidentId -> modeled margin (cents) for NO_RISK incidents, from the server. */
  headroom?: Readonly<Record<string, number | null>>;
  testId?: string;
  /** Healthy/monitoring rows: visually quieter so they never read as alerts. */
  muted?: boolean;
}) {
  return (
    <ul className="flex flex-col gap-2" data-testid={testId}>
      {incidents.map((i) => (
        <li key={i.id}>
          <Link
            href={`/incidents/${encodeURIComponent(i.id)}`}
            data-testid="incident-item"
            data-incident-id={i.id}
            data-healthy={muted || undefined}
            className={`group flex min-w-0 items-center gap-3 rounded-lg border p-4 transition-colors hover:border-border-strong hover:bg-surface-hover ${muted ? "border-dashed border-border bg-transparent" : "border-border bg-surface"}`}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <SignalPill signal={i.signal} />
                <SeverityBadge severity={i.severity} />
                <StatusBadge status={i.status} />
                <ConfidenceText confidence={i.confidence} />
              </div>
              <p className="break-words text-sm font-medium text-foreground">{i.title}</p>
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                <span>{CATEGORY_LABEL[i.category]}</span>
                <span>{i.vendorName}</span>
                <span>{when(i)}</span>
                {i.topWorkflow ? (
                  <span>
                    Affects {i.topWorkflow.label}
                    {i.topWorkflow.owner ? ` (owner ${i.topWorkflow.owner})` : " (owner not recorded)"}
                  </span>
                ) : null}
                {i.sourceClasses.length ? (
                  <span className="text-subtle">
                    Sources: {i.sourceClasses.map((c) => SOURCE_CLASS_DISPLAY[c].label).join(", ")}
                  </span>
                ) : null}
              </p>
            </div>
            {(() => {
              const amount = incidentAmountDisplay(i, headroom?.[i.id]);
              return (
                <span
                  data-testid="incident-amount"
                  data-tone={amount.tone}
                  className={`shrink-0 text-right text-sm font-semibold tabular-nums ${AMOUNT_TONE_CLASS[amount.tone]}`}
                >
                  {amount.text}
                </span>
              );
            })()}
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-subtle group-hover:text-muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
