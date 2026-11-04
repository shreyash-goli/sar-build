import Link from "next/link";

import type { DashboardData } from "@/lib/dashboard/schema";
import { SOURCE_CLASS_DISPLAY } from "@/lib/provenance";
import type { SourceClass } from "@/lib/schema/enums";
import { formatUtc } from "@/components/layout/shell-status";

export function FreshnessPanel({
  freshness,
  resultsEvaluatedAt,
  lastChangedAt,
}: {
  freshness: DashboardData["freshness"];
  /** When the currently shown results were computed. */
  resultsEvaluatedAt: string | null;
  /** When the risk engine last changed a stored result (an unchanged rerun writes nothing). */
  lastChangedAt: string | null;
}) {
  const classes = (Object.entries(freshness.byClassification) as [SourceClass, number][]).filter(([, n]) => n > 0);
  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: "Latest source captured",
      value: freshness.latestSourceCapturedAt ? formatUtc(freshness.latestSourceCapturedAt) : "No source data",
    },
    {
      label: "Latest fund balance reading",
      value: freshness.latestFundObservedAt ? formatUtc(freshness.latestFundObservedAt) : "Not observed",
    },
    {
      label: "Results evaluated",
      value: resultsEvaluatedAt ? formatUtc(resultsEvaluatedAt) : "Never evaluated",
    },
    {
      label: "Last changed",
      value: lastChangedAt ? formatUtc(lastChangedAt) : "No stored results",
    },
    {
      label: "Source records",
      value: (
        <>
          {freshness.sourceEvidenceCount}
          {classes.length ? (
            <span className="text-subtle">
              {" "}
              ({classes.map(([c, n]) => `${n} ${SOURCE_CLASS_DISPLAY[c].label.toLowerCase()}`).join(", ")})
            </span>
          ) : null}
        </>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-3" data-testid="freshness-panel">
      <dl className="flex flex-col gap-2.5 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-0.5">
            <dt className="text-xs text-subtle">{r.label}</dt>
            <dd className="break-words font-mono text-xs text-foreground">{r.value}</dd>
          </div>
        ))}
      </dl>
      <Link href="/sources" className="w-fit text-xs font-medium text-info hover:underline">
        Inspect every source
      </Link>
    </div>
  );
}
