import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";

import type { DashboardData, DashboardExposure } from "@/lib/dashboard/schema";
import { formatCents } from "@/lib/schema/money";
import { Badge } from "@/components/ui/badge";
import {
  CATEGORY_LABEL,
  CONFIDENCE_LABEL,
  SEVERITY_LABEL,
  SEVERITY_VARIANT,
  dueLabel,
  formatDayUtc,
  graphHref,
  vendorNodeId,
} from "./format";

function whenLabel(x: DashboardExposure): string {
  if (x.category === "OBSERVED_DECLINE") return x.at ? `Declined ${formatDayUtc(x.at)}` : "Decline date unknown";
  return dueLabel(x.dueInDays) ?? "Due date unknown";
}

function amountCaption(x: DashboardExposure): string {
  switch (x.category) {
    case "PROJECTED_SHORTFALL":
      return "projected shortfall";
    case "OBSERVED_DECLINE":
      return "declined";
    case "UNKNOWN_DATA":
      return "shortfall cannot be computed";
    default:
      return "amount";
  }
}

/** Ranked by the engine: severity, then soonest due, then id. Order is not re-sorted here. */
export function ExposureList({ exposures }: { exposures: DashboardExposure[] }) {
  if (exposures.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
        <CircleCheck aria-hidden="true" className="size-4 text-success" />
        No unresolved payment exposures.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-2" data-testid="exposure-list">
      {exposures.map((x, i) => (
        <li
          key={x.incidentId}
          data-incident-id={x.incidentId}
          className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center"
        >
          <span aria-hidden="true" className="hidden w-5 shrink-0 font-mono text-sm text-subtle sm:block">
            {i + 1}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={SEVERITY_VARIANT[x.severity]} data-testid="exposure-severity">
                {SEVERITY_LABEL[x.severity]}
              </Badge>
              <Badge variant="neutral" className="normal-case tracking-normal">
                {CATEGORY_LABEL[x.category]}
              </Badge>
              <span className="text-xs text-subtle">{CONFIDENCE_LABEL[x.confidence]}</span>
            </div>
            <Link
              href={`/incidents/${encodeURIComponent(x.incidentId)}`}
              className="break-words text-sm font-medium text-foreground hover:underline"
              data-testid="exposure-link"
            >
              {x.title}
            </Link>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              <span>{x.vendorName}</span>
              <span>{whenLabel(x)}</span>
              {x.topWorkflow ? (
                <span>
                  Affects{" "}
                  <Link href={graphHref(x.topWorkflow.nodeId)} className="text-info hover:underline">
                    {x.topWorkflow.label}
                  </Link>
                  {x.confirmedPathCount > 0
                    ? ` · ${x.confirmedPathCount} confirmed ${x.confirmedPathCount === 1 ? "path" : "paths"}`
                    : ""}
                </span>
              ) : (
                <span>No confirmed downstream workflow</span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-4 sm:flex-col sm:items-end sm:gap-1">
            <p className="text-right">
              <span
                data-testid="exposure-amount"
                className={x.amountCents === null ? "text-base font-semibold text-warning" : "text-base font-semibold text-foreground tabular-nums"}
              >
                {formatCents(x.amountCents)}
              </span>
              <span className="block text-xs text-subtle">{amountCaption(x)}</span>
            </p>
            {x.vendorId ? (
              <Link
                href={graphHref(vendorNodeId(x.vendorId))}
                className="inline-flex items-center gap-1 rounded text-xs font-medium text-info hover:underline"
                aria-label={`Trace ${x.vendorName} on the dependency graph`}
              >
                Trace on graph
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function HealthyList({ healthy }: { healthy: DashboardData["healthy"] }) {
  if (healthy.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" data-testid="healthy-list">
      {healthy.map((h) => (
        <li
          key={h.incidentId}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm"
        >
          <span className="flex items-center gap-2 text-foreground">
            <CircleCheck aria-hidden="true" className="size-4 text-success" />
            {h.vendorName}
          </span>
          <span className="text-xs text-muted">
            {h.marginCents === null ? "Headroom unknown" : `${formatCents(h.marginCents)} headroom`}
            {dueLabel(h.dueInDays) ? ` · next charge ${dueLabel(h.dueInDays)!.toLowerCase()}` : ""}
          </span>
          {h.vendorId ? (
            <Link href={graphHref(vendorNodeId(h.vendorId))} className="text-xs font-medium text-info hover:underline">
              Trace on graph
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
