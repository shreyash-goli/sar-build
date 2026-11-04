import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import type { DashboardData } from "@/lib/dashboard/schema";
import { ExposureList, HealthyList } from "./exposure-list";
import { ForecastChart } from "./forecast-chart";
import { FreshnessPanel } from "./freshness-panel";
import { ImpactedWorkflows } from "./impacted-workflows";
import { KpiTiles } from "./kpi-tiles";

function Panel({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className={`flex min-w-0 flex-col gap-3 ${className ?? ""}`}>
      <div className="flex flex-col gap-0.5">
        <h2 id={`${id}-title`} className="text-base font-semibold text-foreground">
          {title}
        </h2>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Executive Overview. Every figure comes from DashboardData (engine results). */
export function DashboardView({ data }: { data: DashboardData }) {
  const workflowLabels = new Map(data.topImpactedWorkflows.map((w) => [w.nodeId, w.label]));

  return (
    <div className="flex flex-col gap-8">
      {data.unreadableIncidentIds.length > 0 ? (
        <p
          role="alert"
          data-testid="unreadable-incidents"
          className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-foreground"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          {data.unreadableIncidentIds.length}{" "}
          {data.unreadableIncidentIds.length === 1 ? "incident could" : "incidents could"} not be read and{" "}
          {data.unreadableIncidentIds.length === 1 ? "is" : "are"} excluded from every figure below.
        </p>
      ) : null}

      <KpiTiles metrics={data.metrics} workflowLabels={workflowLabels} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-8">
          <Panel
            id="exposures"
            title="Payment exposures"
            description="Unresolved shortfalls, declines and unmapped charges, ranked by severity, then the soonest charge."
          >
            <ExposureList exposures={data.exposures} />
            {data.healthy.length ? (
              <div className="flex flex-col gap-2 pt-1">
                <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-subtle">Covered</h3>
                <HealthyList healthy={data.healthy} />
              </div>
            ) : null}
          </Panel>

          <Panel id="forecast" title="Charge forecast" description="Cleared history and upcoming charges per vendor.">
            <ForecastChart forecast={data.forecast} />
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-8">
          <Panel
            id="workflows"
            title="Top impacted workflows"
            description="On a confirmed path from an active incident. Potential impact, not an outage."
          >
            <ImpactedWorkflows workflows={data.topImpactedWorkflows} />
            <Link href="/graph" className="w-fit text-xs font-medium text-info hover:underline">
              Open the dependency graph
            </Link>
          </Panel>

          <Panel id="freshness" title="Source freshness">
            <FreshnessPanel
              freshness={data.freshness}
              resultsEvaluatedAt={data.resultsEvaluatedAt}
              lastChangedAt={data.lastChangedAt}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
