"use client";

import * as React from "react";
import { ArrowRight, History } from "lucide-react";

import type { ActionProposalView } from "@/lib/actions/schema";
import type { SimulationRecordView } from "@/lib/simulations/schema";
import { SEVERITY_LABEL } from "@/components/dashboard/format";
import { cn } from "@/lib/utils";
import { ApprovalPanel } from "./approval-panel";
import { ResultView, describePatch } from "./result-view";
import { RunForm } from "./run-form";
import type { StudioOptions } from "./types";

/**
 * Response Studio workspace for one incident: run form and history on the
 * left; modeled result and the FS-15 approval panel on the right.
 */
export function Studio({
  incidentId,
  options,
  history,
  unreadableCount,
  actions,
  unreadableActionCount,
}: {
  incidentId: string;
  options: StudioOptions;
  history: SimulationRecordView[];
  unreadableCount: number;
  actions: ActionProposalView[];
  unreadableActionCount: number;
}) {
  // A just-run simulation is shown immediately, before the refreshed history arrives.
  const [fresh, setFresh] = React.useState<SimulationRecordView | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const all = fresh && !history.some((s) => s.id === fresh.id) ? [fresh, ...history] : history;
  const selected =
    (selectedId && all.find((s) => s.id === selectedId)) || fresh || (history.length ? history[0]! : null);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="rounded-xl border border-border bg-surface p-5">
          <RunForm
            incidentId={incidentId}
            options={options}
            onResult={(sim) => {
              setFresh(sim);
              setSelectedId(sim.id);
            }}
          />
        </div>

        <section aria-labelledby="history-title" className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
          <h2 id="history-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <History aria-hidden="true" className="size-4 text-subtle" />
            Simulation history
            <span className="text-xs font-normal text-subtle">({all.length})</span>
          </h2>
          {unreadableCount > 0 ? (
            <p role="status" className="text-xs text-warning">
              {unreadableCount} stored simulation{unreadableCount === 1 ? "" : "s"} could not be read and{" "}
              {unreadableCount === 1 ? "is" : "are"} not listed.
            </p>
          ) : null}
          {all.length === 0 ? (
            <p className="text-sm text-muted">No simulations have been run for this incident.</p>
          ) : (
            <ul className="flex flex-col gap-1.5" data-testid="sim-history">
              {all.map((s) => {
                const active = selected?.id === s.id;
                const f = s.result.focus;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      data-simulation-id={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className={cn(
                        "flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                        active ? "border-accent/50 bg-accent-soft" : "border-border bg-surface-raised hover:bg-surface-hover",
                      )}
                    >
                      <span className="break-words text-foreground">
                        <span className="font-mono text-xs text-subtle">Run #{s.seq}</span> {describePatch(s.patch)}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted">
                        {f.before ? SEVERITY_LABEL[f.before.severity] : "None"}
                        <ArrowRight aria-label="becomes" className="size-3" />
                        {f.after ? SEVERITY_LABEL[f.after.severity] : "None"}
                        <span className="text-subtle">· {s.id.slice(0, 12)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <div className="rounded-xl border border-border bg-surface p-5">
          {selected ? (
            <ResultView simulation={selected} edgeFrom={options.edgeFrom} />
          ) : (
            <div className="flex flex-col gap-1 py-6 text-center" data-testid="sim-empty">
              <p className="text-sm font-medium text-foreground">No result yet</p>
              <p className="text-sm text-muted">Choose a change and run it to see the modeled before and after.</p>
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <ApprovalPanel
            incidentId={incidentId}
            simulation={selected}
            actions={actions}
            unreadableCount={unreadableActionCount}
          />
        </div>
      </div>
    </div>
  );
}
