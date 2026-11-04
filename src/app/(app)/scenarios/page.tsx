import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { FlaskConical } from "lucide-react";

import { CATEGORY_LABEL } from "@/components/dashboard/format";
import { incidentAmountDisplay } from "@/components/risks/amount";
import { SeverityBadge, SignalPill } from "@/components/risks/pills";
import { Studio } from "@/components/simulator/studio";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { loadActions } from "@/lib/actions/load";
import { loadIncident, loadIncidents } from "@/lib/incidents/load";
import { loadSimulations } from "@/lib/simulations/load";
import { cn } from "@/lib/utils";
import { loadStudioOptions } from "./options";

export const metadata: Metadata = { title: "Response Studio" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection();
  const sp = await searchParams;
  const raw = Array.isArray(sp.incident) ? sp.incident[0] : sp.incident;
  const incidentId = raw?.trim() || null;

  const list = await loadIncidents();
  const incident = incidentId ? await loadIncident(incidentId) : null;
  const [options, sims, acts] = incident
    ? await Promise.all([loadStudioOptions(incident), loadSimulations(incident.id), loadActions(incident.id)])
    : [null, null, null];

  return (
    <>
      <PageHeader
        eyebrow="Simulation workspace"
        title="Response Studio"
        description="Model a response to an incident and compare the before and after. Simulations run on a copy of the data."
      />

      {/* Always visible: nothing here changes real money. */}
      <p
        role="note"
        data-testid="simulation-banner"
        className="z-30 flex lg:sticky lg:top-[calc(var(--topbar-height)+0.5rem)] items-center gap-2 rounded-lg border border-warning/50 bg-[color-mix(in_oklab,var(--warning)_14%,var(--background))] px-4 py-2.5 text-sm font-bold text-foreground shadow-lg"
      >
        <FlaskConical aria-hidden="true" className="size-4 shrink-0 text-warning" />
        SIMULATION ONLY: No Ramp funds or card limits were changed.
      </p>

      {list.incidents.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="No incidents to respond to"
          description="The risk engine has not produced any incidents for the loaded data, so there is nothing to simulate."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <nav aria-label="Choose an incident" className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-subtle">Incident</h2>
            <ul className="flex flex-wrap gap-2" data-testid="incident-picker">
              {list.incidents.map((i) => {
                const active = i.id === incident?.id;
                return (
                  <li key={i.id}>
                    <Link
                      href={`/scenarios?incident=${encodeURIComponent(i.id)}`}
                      aria-current={active ? "page" : undefined}
                      data-incident-id={i.id}
                      className={cn(
                        "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                        active
                          ? "border-accent/60 bg-accent-soft text-foreground"
                          : "border-border-strong bg-surface text-muted hover:bg-surface-hover hover:text-foreground",
                      )}
                    >
                      <span>{i.vendorName}</span>
                      <span className="text-xs text-subtle">{incidentAmountDisplay(i).text}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {incidentId && !incident ? (
            <p role="alert" className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-foreground">
              No incident has the ID <code className="font-mono">{incidentId}</code>. Choose one above.
            </p>
          ) : null}

          {incident && options && sims && acts ? (
            <>
              <section
                aria-labelledby="incident-summary-title"
                data-testid="studio-incident"
                data-incident-id={incident.id}
                className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <SignalPill signal={incident.signal} />
                  <SeverityBadge severity={incident.severity} />
                  <span className="text-xs text-subtle">{CATEGORY_LABEL[incident.category]}</span>
                </div>
                <h2 id="incident-summary-title" className="text-lg font-semibold text-foreground">
                  {incident.title}
                </h2>
                {incident.calculation.kind === "SHORTFALL" ? (
                  <ul className="flex flex-col gap-0.5 font-mono text-xs text-muted">
                    {incident.calculation.steps.slice(0, 3).map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                ) : null}
                <Link href={`/incidents/${encodeURIComponent(incident.id)}`} className="w-fit text-xs font-medium text-info hover:underline">
                  Open the full incident
                </Link>
              </section>

              <Studio
                key={incident.id}
                incidentId={incident.id}
                options={options}
                history={sims.simulations}
                unreadableCount={sims.unreadableSimulationIds.length}
                actions={acts.actions}
                unreadableActionCount={acts.unreadableActionIds.length}
              />
            </>
          ) : !incidentId ? (
            <EmptyState
              icon={FlaskConical}
              title="Choose an incident to model a response"
              description="Pick an incident above. You can then model adding funds, paying from another fund, rescheduling the charge, or verifying a suggested dependency."
            />
          ) : null}
        </div>
      )}
    </>
  );
}
