import Link from "next/link";
import { ArrowRight, FlaskConical, Network } from "lucide-react";

import type { FindingSummary, SimulationRecordView } from "@/lib/simulations/schema";
import type { SimulationPatch } from "@/lib/schema/simulation";
import { formatCents } from "@/lib/schema/money";
import { formatUtc } from "@/components/layout/format-utc";
import { Badge } from "@/components/ui/badge";
import { CATEGORY_LABEL, SEVERITY_LABEL, SEVERITY_VARIANT, dueLabel } from "@/components/dashboard/format";
import { cn } from "@/lib/utils";

type Row = {
  field: keyof FindingSummary;
  label: string;
  render: (f: FindingSummary) => React.ReactNode;
};

const money = (v: number | null) => <span className="font-mono tabular-nums">{formatCents(v)}</span>;

const ROWS: Row[] = [
  { field: "severity", label: "Severity", render: (f) => <Badge variant={SEVERITY_VARIANT[f.severity]}>{SEVERITY_LABEL[f.severity]}</Badge> },
  { field: "category", label: "Finding", render: (f) => CATEGORY_LABEL[f.category] },
  { field: "shortfallCents", label: "Projected shortfall", render: (f) => money(f.shortfallCents) },
  { field: "marginCents", label: "Margin after charge", render: (f) => money(f.marginCents) },
  { field: "availableCents", label: "Available allocation", render: (f) => money(f.availableCents) },
  { field: "effectiveAvailableCents", label: "Effective available", render: (f) => money(f.effectiveAvailableCents) },
  { field: "expectedCents", label: "Expected charge", render: (f) => money(f.expectedCents) },
  { field: "dueInDays", label: "Due", render: (f) => dueLabel(f.dueInDays) ?? "Unknown" },
];

const slug = (s: string) => s.replace(/Cents$/, "").replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function describePatch(p: SimulationPatch): string {
  switch (p.kind) {
    case "INCREASE_AVAILABLE_ALLOCATION":
      return `+${formatCents(p.amountCents)} available on ${p.fundingSourceId}`;
    case "ASSIGN_ALTERNATE_FUND":
      return `Pay ${p.vendorChargeId} from ${p.fundingSourceId}`;
    case "MARK_CHARGE_RESCHEDULED":
      return `Reschedule ${p.vendorChargeId} to ${formatUtc(p.newExpectedAt)}`;
    case "MARK_DEPENDENCY_VERIFIED":
      return `Verify edge ${p.edgeId}`;
  }
}

function formatInputValue(field: string, v: unknown): string {
  if (v === null || v === undefined) return "Unknown";
  if (typeof v === "number" && /Cents$/.test(field)) return formatCents(v);
  if (typeof v === "string" && /At$/.test(field) && !Number.isNaN(Date.parse(v))) return formatUtc(v);
  return typeof v === "string" ? v : JSON.stringify(v);
}

export function ResultView({
  simulation,
  edgeFrom,
}: {
  simulation: SimulationRecordView;
  edgeFrom: Record<string, string>;
}) {
  const { result } = simulation;
  const { focus } = result;
  const changed = new Set(focus.changedFields);
  const pathId = focus.after?.confirmedPathIds[0] ?? focus.before?.confirmedPathIds[0] ?? null;
  const firstEdge = pathId?.replace(/^path:/, "").split("|")[0];
  const startNode = firstEdge ? edgeFrom[firstEdge] : undefined;
  const others = result.diff.filter((d) => d.incidentKey !== focus.incidentKey);

  return (
    <section
      aria-labelledby="result-title"
      data-testid="sim-result"
      data-simulation-id={simulation.id}
      className="flex min-w-0 flex-col gap-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="result-title" className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
            Modeled result
            <Badge variant="warning" data-testid="sim-only-badge">
              <FlaskConical aria-hidden="true" />
              {result.label}
            </Badge>
          </h2>
          <p className="text-xs text-muted" data-testid="sim-patch">
            Run #{simulation.seq} · {describePatch(simulation.patch)} · evaluated {formatUtc(result.evaluatedAt)} · by{" "}
            {simulation.createdBy}
          </p>
        </div>
        {pathId && startNode ? (
          <Link
            href={`/graph?node=${encodeURIComponent(startNode)}&path=${encodeURIComponent(pathId)}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-info hover:underline"
            data-testid="view-affected-path"
          >
            <Network aria-hidden="true" className="size-3.5" />
            View affected path
          </Link>
        ) : null}
      </div>

      {/* Side-by-side before / after for the focus incident. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[30rem] text-sm" data-testid="before-after">
          <caption className="sr-only">Before and after the modeled change for {focus.after?.title ?? focus.before?.title}</caption>
          <thead className="bg-surface-raised text-left text-xs text-subtle">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Measure
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Before
              </th>
              <th scope="col" className="w-6 px-0 py-2" aria-hidden="true" />
              <th scope="col" className="px-3 py-2 font-medium">
                After (modeled)
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const isChanged = changed.has(r.field);
              return (
                <tr
                  key={r.field}
                  data-field={r.field}
                  data-changed={isChanged || undefined}
                  className={cn("border-t border-border", isChanged && "bg-accent-soft")}
                >
                  <th scope="row" className="px-3 py-2 text-left font-normal text-muted">
                    {r.label}
                    {isChanged ? <span className="sr-only"> (changed)</span> : null}
                  </th>
                  <td className="px-3 py-2 text-foreground" data-testid={`before-${slug(r.field)}`}>
                    {focus.before ? r.render(focus.before) : <span className="text-subtle">No finding</span>}
                  </td>
                  <td className="px-0 py-2 text-subtle" aria-hidden="true">
                    {isChanged ? <ArrowRight className="size-3.5 text-accent" /> : null}
                  </td>
                  <td className={cn("px-3 py-2", isChanged ? "font-semibold text-foreground" : "text-foreground")} data-testid={`after-${slug(r.field)}`}>
                    {focus.after ? r.render(focus.after) : <span className="text-subtle">No finding</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-subtle">Modeled inputs</h3>
          {result.changedInputs.length ? (
            <ul className="flex flex-col gap-1.5 text-sm" data-testid="changed-inputs">
              {result.changedInputs.map((c) => (
                <li key={`${c.entity}-${c.id}-${c.field}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <code className="font-mono text-xs text-muted">
                    {c.id}.{c.field}
                  </code>
                  <span className="font-mono text-foreground">{formatInputValue(c.field, c.before)}</span>
                  <ArrowRight aria-label="becomes" className="size-3.5 text-subtle" />
                  <span className="font-mono font-semibold text-foreground">{formatInputValue(c.field, c.after)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No stored input differs in this model.</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-subtle">Assumptions</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground" data-testid="assumptions">
            {result.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <p className="text-xs text-subtle">
            Rules: <code className="font-mono">{result.ruleVersion.simulation}</code>,{" "}
            <code className="font-mono">{result.ruleVersion.shortfall}</code>,{" "}
            <code className="font-mono">{result.ruleVersion.severity}</code>,{" "}
            <code className="font-mono">{result.ruleVersion.decline}</code>
          </p>
        </div>
      </div>

      {others.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-subtle">Effect on other incidents</h3>
          <ul className="flex flex-col gap-1.5" data-testid="other-diffs">
            {others.map((d) => {
              const title = d.after?.title ?? d.before?.title ?? d.incidentKey;
              return (
                <li key={d.incidentKey} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="min-w-0 break-words text-foreground">{title}</span>
                  {d.changedFields.length === 0 ? (
                    <span className="text-xs text-subtle">Unchanged</span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      {d.before ? SEVERITY_LABEL[d.before.severity] : "None"}
                      <ArrowRight aria-label="becomes" className="size-3" />
                      {d.after ? SEVERITY_LABEL[d.after.severity] : "None"}
                      <span className="text-subtle">({d.changedFields.join(", ")})</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
