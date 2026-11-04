"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";

import type { SimulationPatch } from "@/lib/schema/simulation";
import type { SimulationRecordView } from "@/lib/simulations/schema";
import { formatCents } from "@/lib/schema/money";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { runScenario } from "./api";
import { parseDollarsToCents } from "./money-input";
import type { StudioOptions } from "./types";

type Kind = SimulationPatch["kind"];

const KINDS: { kind: Kind; label: string; hint: string }[] = [
  {
    kind: "INCREASE_AVAILABLE_ALLOCATION",
    label: "Increase available allocation",
    hint: "Model adding funds to a fund's available allocation.",
  },
  { kind: "ASSIGN_ALTERNATE_FUND", label: "Pay from another fund", hint: "Model moving the charge to a different fund." },
  { kind: "MARK_CHARGE_RESCHEDULED", label: "Reschedule the charge", hint: "Model the vendor charging on a later date." },
  {
    kind: "MARK_DEPENDENCY_VERIFIED",
    label: "Verify a suggested dependency",
    hint: "Model a reviewer confirming an unreviewed edge.",
  },
];

const control =
  "h-9 w-full min-w-0 rounded-md border border-border-strong bg-surface-raised px-3 text-sm text-foreground disabled:opacity-50";

export function RunForm({
  incidentId,
  options,
  onResult,
}: {
  incidentId: string;
  options: StudioOptions;
  onResult: (sim: SimulationRecordView) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [kind, setKind] = React.useState<Kind>("INCREASE_AVAILABLE_ALLOCATION");
  const [fundId, setFundId] = React.useState(options.defaultFundId ?? options.funds[0]?.id ?? "");
  const [amount, setAmount] = React.useState("");
  const altFunds = options.funds.filter((f) => f.id !== options.charge?.fundingSourceId);
  const [altFundId, setAltFundId] = React.useState(altFunds[0]?.id ?? "");
  const [date, setDate] = React.useState(options.charge ? options.charge.expectedAt.slice(0, 10) : "");
  const [edgeId, setEdgeId] = React.useState(options.suggestedEdges[0]?.id ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const unavailable: Partial<Record<Kind, string>> = {
    ASSIGN_ALTERNATE_FUND: !options.charge
      ? "This incident has no scheduled charge to move."
      : altFunds.length === 0
        ? "There is no other fund to pay from."
        : undefined,
    MARK_CHARGE_RESCHEDULED: !options.charge ? "This incident has no scheduled charge to reschedule." : undefined,
    MARK_DEPENDENCY_VERIFIED: options.suggestedEdges.length === 0 ? "There are no suggested edges to verify." : undefined,
    INCREASE_AVAILABLE_ALLOCATION: options.funds.length === 0 ? "No funds are loaded." : undefined,
  };

  function buildPatch(): { patch: SimulationPatch } | { error: string } {
    switch (kind) {
      case "INCREASE_AVAILABLE_ALLOCATION": {
        const parsed = parseDollarsToCents(amount);
        if (!parsed.ok) return { error: parsed.message };
        if (!fundId) return { error: "Choose a fund." };
        return { patch: { kind, fundingSourceId: fundId, amountCents: parsed.cents } };
      }
      case "ASSIGN_ALTERNATE_FUND":
        if (!options.charge || !altFundId) return { error: "Choose a fund to pay from." };
        return { patch: { kind, vendorChargeId: options.charge.id, fundingSourceId: altFundId } };
      case "MARK_CHARGE_RESCHEDULED": {
        if (!options.charge) return { error: "This incident has no scheduled charge." };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Choose a new date." };
        // Keep the charge's original UTC time of day; only the date changes.
        const time = options.charge.expectedAt.slice(10);
        return { patch: { kind, vendorChargeId: options.charge.id, newExpectedAt: `${date}${time}` } };
      }
      case "MARK_DEPENDENCY_VERIFIED":
        if (!edgeId) return { error: "Choose a suggested edge." };
        return { patch: { kind, edgeId } };
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const built = buildPatch();
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setPending(true);
    const outcome = await runScenario(incidentId, built.patch);
    setPending(false);
    if (!outcome.ok) {
      setError(outcome.message);
      toast({ title: "Simulation not run", description: outcome.message, variant: "danger" });
      return;
    }
    onResult(outcome.data.simulation);
    const focus = outcome.data.simulation.result.focus;
    toast({
      title: "Simulation complete (SIMULATION ONLY)",
      description: `Modeled result: ${focus.before?.severity ?? "none"} → ${focus.after?.severity ?? "none"}. No Ramp funds or card limits were changed.`,
      variant: "success",
    });
    router.refresh(); // refresh the server-rendered history
  }

  const reason = unavailable[kind];

  return (
    <form onSubmit={onSubmit} aria-labelledby="run-form-title" className="flex flex-col gap-4" noValidate>
      <h2 id="run-form-title" className="text-base font-semibold text-foreground">
        Model a response
      </h2>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-xs font-medium text-muted">Change to model</legend>
        {KINDS.map((k) => (
          <label
            key={k.kind}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
              kind === k.kind ? "border-accent/50 bg-accent-soft" : "border-border bg-surface-raised hover:bg-surface-hover",
            )}
          >
            <input
              type="radio"
              name="kind"
              value={k.kind}
              checked={kind === k.kind}
              onChange={() => {
                setKind(k.kind);
                setError(null);
              }}
              className="mt-1 accent-[var(--accent)]"
            />
            <span className="flex flex-col">
              <span className="font-medium text-foreground">{k.label}</span>
              <span className="text-xs text-muted">{unavailable[k.kind] ?? k.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {kind === "INCREASE_AVAILABLE_ALLOCATION" ? (
        <div className="grid gap-3">
          {/* Stacked so long fund names ("Auth Infrastructure (available $2,000.00)") are never truncated. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sim-fund" className="text-xs font-medium text-muted">
              Fund
            </label>
            <select id="sim-fund" value={fundId} onChange={(e) => setFundId(e.target.value)} className={control}>
              {options.funds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} (available {formatCents(f.availableCents)})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sim-amount" className="text-xs font-medium text-muted">
              Add to available allocation (USD)
            </label>
            <div className="relative flex items-center">
              <span aria-hidden="true" className="pointer-events-none absolute left-3 text-sm text-subtle">
                $
              </span>
              <input
                id="sim-amount"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="600"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "sim-error" : undefined}
                className={`${control} pl-6 font-mono`}
              />
            </div>
          </div>
        </div>
      ) : null}

      {kind === "ASSIGN_ALTERNATE_FUND" && !reason ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sim-alt-fund" className="text-xs font-medium text-muted">
            Pay {options.charge?.id} from
          </label>
          <select id="sim-alt-fund" value={altFundId} onChange={(e) => setAltFundId(e.target.value)} className={control}>
            {altFunds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} (available {formatCents(f.availableCents)})
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {kind === "MARK_CHARGE_RESCHEDULED" && !reason ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sim-date" className="text-xs font-medium text-muted">
            New charge date (UTC)
          </label>
          <input id="sim-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={control} />
        </div>
      ) : null}

      {kind === "MARK_DEPENDENCY_VERIFIED" && !reason ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sim-edge" className="text-xs font-medium text-muted">
            Suggested edge
          </label>
          <select id="sim-edge" value={edgeId} onChange={(e) => setEdgeId(e.target.value)} className={control}>
            {options.suggestedEdges.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {error ? (
        <p id="sim-error" role="alert" data-testid="sim-error" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-foreground">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending || Boolean(reason)}>
          <Play aria-hidden="true" />
          {pending ? "Running…" : "Run simulation"}
        </Button>
        <span className="text-xs text-subtle">Runs on a copy. Stored funds and charges are never changed.</span>
      </div>
    </form>
  );
}
