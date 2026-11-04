import Link from "next/link";

import type { DashboardData } from "@/lib/dashboard/schema";
import { Badge } from "@/components/ui/badge";
import { SEVERITY_LABEL, SEVERITY_VARIANT, graphHref } from "./format";

const CRITICALITY_LABEL = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low", UNKNOWN: "Unknown" } as const;

export function ImpactedWorkflows({ workflows }: { workflows: DashboardData["topImpactedWorkflows"] }) {
  if (workflows.length === 0) {
    return <p className="text-sm text-muted">No workflow sits on a confirmed path from an active incident.</p>;
  }
  return (
    <ul className="flex flex-col gap-2" data-testid="impacted-workflows">
      {workflows.map((w) => (
        <li key={w.nodeId} data-node-id={w.nodeId}>
          <Link
            href={graphHref(w.nodeId)}
            className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong hover:bg-surface-hover"
          >
            <span className="flex min-w-0 flex-col">
              <span className="break-words text-sm font-medium text-foreground">{w.label}</span>
              <span className="text-xs text-subtle">
                Criticality {CRITICALITY_LABEL[w.criticality].toLowerCase()} · {w.incidentIds.length}{" "}
                {w.incidentIds.length === 1 ? "incident" : "incidents"}
              </span>
            </span>
            <Badge variant={SEVERITY_VARIANT[w.worstSeverity]}>
              Worst: {SEVERITY_LABEL[w.worstSeverity]}
            </Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}
