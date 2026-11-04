import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { SearchX, Siren } from "lucide-react";

import { IncidentFilters } from "@/components/risks/incident-filters";
import { IncidentList } from "@/components/risks/incident-list";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { loadIncident, loadIncidents } from "@/lib/incidents/load";
import { parseIncidentQuery, type IncidentSearchParams } from "@/lib/incidents/schema";

export const metadata: Metadata = { title: "Incidents" };

export default async function Page({ searchParams }: { searchParams: Promise<IncidentSearchParams> }) {
  await connection();
  const parsed = parseIncidentQuery(await searchParams);
  // Invalid filters are ignored with a visible notice, never guessed.
  const query = parsed.ok ? parsed.query : {};
  const data = await loadIncidents(query);
  const filtered = Object.values(query).some((v) => v !== undefined);
  // LOW severity / NO_RISK results are healthy subjects under monitoring, not alerts:
  // keep the engine's order but list them separately and clearly labelled.
  const isHealthy = (i: (typeof data.incidents)[number]) => i.severity === "LOW" || i.category === "NO_RISK";
  const attention = data.incidents.filter((i) => !isHealthy(i));
  // NO_RISK list items carry no amount; read the known margin from the detail so
  // the row says "No shortfall · $X headroom" instead of a misleading "Unknown".
  const headroom: Record<string, number | null> = Object.fromEntries(
    await Promise.all(
      data.incidents
        .filter((i) => i.category === "NO_RISK")
        .map(async (i) => {
          const d = await loadIncident(i.id).catch(() => null);
          return [i.id, d?.calculation.kind === "SHORTFALL" ? d.calculation.marginCents : null] as const;
        }),
    ),
  );
  const healthy = data.incidents.filter(isHealthy);

  return (
    <>
      <PageHeader
        eyebrow="Risk triage"
        title="Incidents"
        description="Projected shortfalls from scheduled charges and declines that actually happened, each with the evidence, calculation and uncertainty behind it."
      />

      {!parsed.ok ? (
        <p
          role="status"
          data-testid="invalid-incident-filter"
          className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-foreground"
        >
          Ignored invalid filter{parsed.issues.length > 1 ? "s" : ""}:{" "}
          {parsed.issues.map((i) => i.param).join(", ")}. Showing all incidents.
        </p>
      ) : null}

      {data.unreadableIncidentIds.length > 0 ? (
        <p role="alert" className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-foreground">
          {data.unreadableIncidentIds.length} incident
          {data.unreadableIncidentIds.length === 1 ? " could" : "s could"} not be read and{" "}
          {data.unreadableIncidentIds.length === 1 ? "is" : "are"} not listed.
        </p>
      ) : null}

      {data.total === 0 && !filtered ? (
        <EmptyState
          icon={Siren}
          title="No incidents"
          description={
            <>
              <p>The risk engine has not produced any incidents for the loaded data.</p>
              <p className="mt-1 text-subtle">
                Load the fictional demo with <code className="font-mono text-muted">pnpm db:seed</code>, which also runs the
                engine.
              </p>
            </>
          }
        />
      ) : (
        <section aria-labelledby="incident-list-title" className="flex flex-col gap-4">
          <h2 id="incident-list-title" className="sr-only">
            Incident list
          </h2>
          <IncidentFilters query={query} />
          <p className="text-sm text-muted" data-testid="incident-total">
            <span className="font-medium text-foreground">{data.incidents.length}</span>{" "}
            {data.incidents.length === 1 ? "incident" : "incidents"}
            {filtered ? " match the current filters" : ""}
            {healthy.length ? ` · ${attention.length} need attention, ${healthy.length} healthy` : ""}
          </p>
          {data.incidents.length === 0 ? (
            <EmptyState icon={SearchX} title="No incidents match these filters" description="Try a different combination.">
              <Link href="/incidents" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Clear filters
              </Link>
            </EmptyState>
          ) : (
            <>
              {attention.length ? (
                <IncidentList incidents={attention} testId="incident-list" headroom={headroom} />
              ) : (
                <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted" data-testid="incident-list">
                  Nothing needs attention{filtered ? " in this selection" : ""}.
                </p>
              )}
              {healthy.length ? (
                <section aria-labelledby="healthy-title" className="flex flex-col gap-2 pt-2" data-testid="healthy-incidents">
                  <div className="flex flex-col gap-0.5">
                    <h2 id="healthy-title" className="text-sm font-semibold text-foreground">
                      Healthy, monitoring only ({healthy.length})
                    </h2>
                    <p className="text-xs text-muted">
                      Low-severity results: funding currently covers these charges. Listed for completeness, not as alerts.
                    </p>
                  </div>
                  <IncidentList incidents={healthy} testId="healthy-incident-list" muted headroom={headroom} />
                </section>
              ) : null}
            </>
          )}
        </section>
      )}
    </>
  );
}
