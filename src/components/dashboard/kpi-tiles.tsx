import { Info } from "lucide-react";

import type { DashboardData } from "@/lib/dashboard/schema";
import { formatCents } from "@/lib/schema/money";

type Metrics = DashboardData["metrics"];

function KpiTile({
  id,
  label,
  value,
  detail,
  definition,
}: {
  id: string;
  label: string;
  value: string;
  detail: React.ReactNode;
  definition: string;
}) {
  return (
    <section
      aria-labelledby={`${id}-label`}
      data-testid={`kpi-${id}`}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface p-5"
    >
      <h2 id={`${id}-label`} className="text-sm font-medium text-muted">
        {label}
      </h2>
      <p
        data-testid={`kpi-${id}-value`}
        className="text-3xl font-semibold tracking-tight text-foreground tabular-nums"
      >
        {value}
      </p>
      <div className="min-h-5 text-sm text-muted">{detail}</div>
      <details className="group mt-auto border-t border-border pt-3 text-xs text-subtle">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded text-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
          <Info aria-hidden="true" className="size-3.5" />
          <span>
            How this is counted<span className="sr-only">: {label}</span>
          </span>
        </summary>
        <p className="mt-2 leading-relaxed" data-testid={`kpi-${id}-definition`}>
          {definition}
        </p>
      </details>
    </section>
  );
}

/** Three engine-derived KPIs. Every value and definition comes from DashboardData. */
export function KpiTiles({
  metrics,
  workflowLabels,
}: {
  metrics: Metrics;
  /** nodeId -> label, for naming the counted workflows. */
  workflowLabels: ReadonlyMap<string, string>;
}) {
  const { atRiskWorkflows, unresolvedExposures, potentialShortfall } = metrics;
  const names = atRiskWorkflows.workflowIds.map((id) => workflowLabels.get(id) ?? id);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <KpiTile
        id="at-risk-workflows"
        label="At-risk workflows"
        value={String(atRiskWorkflows.value)}
        definition={atRiskWorkflows.definition}
        detail={names.length ? names.join(", ") : "No workflow is on a confirmed risk path."}
      />
      <KpiTile
        id="unresolved-exposures"
        label="Unresolved payment exposures"
        value={String(unresolvedExposures.value)}
        definition={unresolvedExposures.definition}
        detail={
          unresolvedExposures.value === 0
            ? "No unresolved shortfalls or declines."
            : `${unresolvedExposures.value} ${unresolvedExposures.value === 1 ? "incident" : "incidents"} awaiting response`
        }
      />
      <KpiTile
        id="potential-shortfall"
        label="Potential shortfall"
        value={formatCents(potentialShortfall.knownCents)}
        definition={potentialShortfall.definition}
        detail={
          potentialShortfall.unknownCount > 0 ? (
            <span className="text-warning" data-testid="kpi-potential-shortfall-unknown">
              + {potentialShortfall.unknownCount} unquantified{" "}
              {potentialShortfall.unknownCount === 1 ? "exposure" : "exposures"} (not added as $0)
            </span>
          ) : (
            "All exposures are quantified."
          )
        }
      />
    </div>
  );
}
