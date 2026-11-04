import Link from "next/link";
import {
  ArrowLeft,
  CircleHelp,
  FileSearch,
  FlaskConical,
  Network,
  ShieldAlert,
  TriangleAlert,
  UserRound,
} from "lucide-react";

import type { IncidentDetail } from "@/lib/incidents/schema";
import { formatCents } from "@/lib/schema/money";
import { formatUtc } from "@/components/layout/format-utc";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PROVENANCE_TONE_VARIANT } from "@/components/ui/provenance-tone";
import { CATEGORY_LABEL, dueLabel, formatDayUtc, graphHref, vendorNodeId } from "@/components/dashboard/format";
import { cn } from "@/lib/utils";
import { AMOUNT_TONE_CLASS, incidentAmountDisplay } from "./amount";
import { ConfidenceText, SeverityBadge, SignalPill, StatusBadge } from "./pills";
import { RunbookChecklist } from "./runbook-checklist";

const sourceHref = (evidenceId: string) => `/sources?source=${encodeURIComponent(evidenceId)}`;

const STRENGTH: Record<string, string> = { HARD: "hard", DEGRADED: "degraded", OPTIONAL: "optional" };
const REVIEW: Record<string, string> = { CONFIRMED: "confirmed", SUGGESTED: "suggested", REJECTED: "rejected" };

function Section({
  id,
  title,
  children,
  className,
  testId,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={testId}
      className={cn("flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-5", className)}
    >
      <h2 id={`${id}-title`} className="text-base font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Calculation({ incident }: { incident: IncidentDetail }) {
  const c = incident.calculation;
  if (c.kind === "SHORTFALL") {
    return (
      <div className="flex flex-col gap-3">
        <ol className="flex flex-col gap-1.5" data-testid="calculation-steps">
          {c.steps.map((s, i) => (
            <li
              key={i}
              className="flex gap-3 rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-[0.8125rem] leading-relaxed text-foreground"
            >
              <span aria-hidden="true" className="text-subtle">
                {i + 1}
              </span>
              <span className="min-w-0 break-words">{s}</span>
            </li>
          ))}
        </ol>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-subtle">Expected charge</dt>
            <dd className="font-mono text-foreground">{formatCents(c.expectedCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">Effective available</dt>
            <dd className="font-mono text-foreground">{formatCents(c.effectiveAvailableCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">Projected shortfall</dt>
            <dd className="font-mono font-semibold text-foreground" data-testid="calculation-result">
              {formatCents(c.shortfallCents)}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted">
          Formula: <code className="font-mono text-foreground">{c.formula}</code> · period {c.periodKeyUtc}
          {c.committedBeforeCents > 0 ? ` · ${formatCents(c.committedBeforeCents)} already committed earlier in the period` : ""}
        </p>
        {c.assumptions.length ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-subtle">Assumptions</h3>
            <ul className="list-disc pl-5 text-sm text-muted">
              {c.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }
  if (c.kind === "DECLINE") {
    return (
      <dl className="grid gap-3 text-sm sm:grid-cols-2" data-testid="calculation-decline">
        <div>
          <dt className="text-xs text-subtle">Declined amount</dt>
          <dd className="font-mono font-semibold text-foreground" data-testid="calculation-result">
            {formatCents(c.amountCents)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-subtle">Declined at</dt>
          <dd className="font-mono text-foreground">{formatUtc(c.occurredAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-subtle">Reason reported</dt>
          <dd className="text-foreground">{c.reason ?? <span className="text-subtle">Not reported</span>}</dd>
        </div>
        <div>
          <dt className="text-xs text-subtle">Transaction</dt>
          <dd className="break-all font-mono text-foreground">{c.transactionId}</dd>
        </div>
      </dl>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="calculation-unknown">
      <p className="text-sm text-muted">
        The shortfall cannot be computed because inputs are missing. Missing values are shown as unknown, never as $0.
      </p>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-subtle">Expected charge</dt>
          <dd className="font-mono text-foreground">{formatCents(c.expectedCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-subtle">Available allocation</dt>
          <dd className={cn("font-mono", c.availableCents === null ? "text-warning" : "text-foreground")}>
            {formatCents(c.availableCents)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-subtle">Due</dt>
          <dd className="text-foreground">{dueLabel(c.dueInDays) ?? "Unknown"}</dd>
        </div>
      </dl>
      {c.requestedMappings.length ? (
        <div className="flex flex-col gap-1 rounded-md border border-warning/40 bg-warning-soft px-3 py-2">
          <h3 className="text-xs font-semibold text-foreground">Mappings needed to evaluate this</h3>
          <ul className="list-disc pl-5 text-sm text-muted" data-testid="requested-mappings">
            {c.requestedMappings.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Chains({ incident }: { incident: IncidentDetail }) {
  if (incident.confirmedChains.length === 0) {
    return <p className="text-sm text-muted">No confirmed dependency path connects this subject to a workflow.</p>;
  }
  return (
    <ol className="flex flex-col gap-3" data-testid="confirmed-chains">
      {incident.confirmedChains.map((chain) => {
        const start = chain.nodes[0];
        return (
          <li key={chain.pathId} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3">
            <ol className="flex min-w-0 flex-col gap-1.5">
              {chain.nodes.map((n, i) => {
                const edge = i > 0 ? chain.edges[i - 1] : undefined;
                return (
                  <li key={`${n.id}-${i}`} className="flex min-w-0 flex-col gap-1.5">
                    {edge ? (
                      <div className="ml-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-l border-border-strong pl-3 text-xs text-muted">
                        <span className="font-mono text-info">{edge.relation ?? "UNKNOWN"}</span>
                        <span>{edge.dependencyStrength ? STRENGTH[edge.dependencyStrength] : "strength unknown"}</span>
                        <span>· {edge.reviewStatus ? REVIEW[edge.reviewStatus] : "review unknown"}</span>
                        {edge.evidenceId ? (
                          <Link
                            href={sourceHref(edge.evidenceId)}
                            className="text-info hover:underline"
                            aria-label={`Evidence for ${chain.nodes[i - 1]?.label ?? "?"} ${edge.relation ?? ""} ${n.label}`}
                          >
                            evidence
                          </Link>
                        ) : (
                          <span className="text-warning">no evidence</span>
                        )}
                      </div>
                    ) : null}
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <span className={cn("text-sm font-medium", n.kind ? "text-foreground" : "text-warning")}>{n.label}</span>
                      {n.kind ? <span className="text-xs text-subtle">{n.kind.toLowerCase()}</span> : null}
                      {n.owner ? <span className="text-xs text-subtle">· owner {n.owner}</span> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
            {start ? (
              <Link
                href={`${graphHref(start.id)}&path=${encodeURIComponent(chain.pathId)}`}
                className="inline-flex w-fit items-center gap-1 text-xs font-medium text-info hover:underline"
              >
                <Network aria-hidden="true" className="size-3.5" />
                Show this exact path on the graph
              </Link>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function IncidentDetailView({ incident }: { incident: IncidentDetail }) {
  const { evaluation } = incident;
  const forecast = incident.signal === "FORECAST";
  const amount = incidentAmountDisplay(
    incident,
    incident.calculation.kind === "SHORTFALL" ? incident.calculation.marginCents : null,
  );

  return (
    <div className="flex flex-col gap-6" data-testid="incident-detail" data-incident-id={incident.id}>
      <Link href="/incidents" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeft aria-hidden="true" className="size-4" />
        All incidents
      </Link>

      <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <SignalPill signal={incident.signal} />
            <SeverityBadge severity={incident.severity} />
            <StatusBadge status={incident.status} />
            <Badge variant="neutral" className="normal-case tracking-normal">
              {CATEGORY_LABEL[incident.category]}
            </Badge>
            <ConfidenceText confidence={incident.confidence} />
          </div>
          <h1 className="break-words text-2xl font-semibold tracking-tight text-foreground">{incident.title}</h1>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
            <span>{incident.vendorName}</span>
            <span
              className={cn("font-medium", AMOUNT_TONE_CLASS[amount.tone])}
              data-testid="incident-amount"
              data-tone={amount.tone}
            >
              {amount.text}
            </span>
            <span>
              {forecast
                ? (dueLabel(incident.dueInDays) ?? "Due date unknown")
                : incident.at
                  ? `Declined ${formatDayUtc(incident.at)}`
                  : "Decline date unknown"}
            </span>
            <span className="text-subtle">Last evaluated {formatUtc(incident.updatedAt)}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {incident.vendorId ? (
            <Link href={graphHref(vendorNodeId(incident.vendorId))} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Network aria-hidden="true" />
              Trace on graph
            </Link>
          ) : null}
          <Link
            href={`/scenarios?incident=${encodeURIComponent(incident.id)}`}
            className={buttonVariants({ variant: "primary", size: "sm" })}
            data-testid="open-response-studio"
          >
            <FlaskConical aria-hidden="true" />
            Open Response Studio
          </Link>
        </div>
      </header>

      {/* What this does and does not mean: caveats verbatim from the assertion. */}
      {incident.caveats.length ? (
        <section
          aria-labelledby="caveats-title"
          data-testid="caveats"
          className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning-soft p-4"
        >
          <h2 id="caveats-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldAlert aria-hidden="true" className="size-4 text-warning" />
            What this does and does not mean
          </h2>
          <ul className="flex list-disc flex-col gap-1 pl-6 text-sm text-foreground">
            {incident.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <RunbookChecklist runbook={incident.runbook} />

      {incident.resolution === "SUBJECT_NO_LONGER_EVALUATED" ? (
        <p role="status" className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-muted">
          The subject of this incident is no longer evaluated by the risk engine.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section id="calculation" title="Where the number comes from" testId="calculation">
            <Calculation incident={incident} />
            <div className="flex flex-col gap-1.5 border-t border-border pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-subtle">Why the engine flagged it</h3>
              <ul className="flex flex-col gap-1.5 text-sm text-muted" data-testid="reasons">
                {evaluation.reasons.map((r, i) => (
                  <li key={`${r.riskRuleId}-${i}`}>
                    <code className="font-mono text-xs text-info">{r.riskRuleId}</code> {r.detail}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-subtle">
                Rule <code className="font-mono">{evaluation.assertion.ruleId}</code> · evaluated{" "}
                {formatUtc(evaluation.assertion.evaluatedAt)} ·{" "}
                <Link href={sourceHref(incident.ruleEvidenceId)} className="text-info hover:underline">
                  rule record
                </Link>
              </p>
            </div>
          </Section>

          <Section id="chain" title="Confirmed dependency chain" testId="dependency-chain">
            <p className="text-xs text-muted">
              Each step is a confirmed edge with its own evidence. Reaching a workflow means it could be affected, not that it is.
            </p>
            <Chains incident={incident} />
            {!incident.impactComplete ? (
              <p role="status" className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-foreground">
                Impact may be incomplete: the path search hit its limits.
              </p>
            ) : null}
          </Section>

          {incident.possibleImpacts.length ? (
            <Section id="possible" title="Possible impact via unreviewed links" testId="possible-impacts">
              <p className="text-xs text-muted">Reached only through suggested edges. Not counted until a reviewer confirms them.</p>
              <ul className="flex flex-col gap-1.5">
                {incident.possibleImpacts.map((n) => (
                  <li key={n.id} className="rounded-md border border-dashed border-border-strong px-3 py-2 text-sm text-foreground">
                    {n.label}
                    {n.owner ? <span className="text-xs text-subtle"> · owner {n.owner}</span> : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Section id="owners" title="Owners" testId="owners">
            {incident.owners.length ? (
              <ul className="flex flex-col gap-1.5">
                {incident.owners.map((o) => (
                  <li key={o.nodeId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-foreground">{o.label}</span>
                    <span className={cn("flex items-center gap-1 text-xs", o.owner ? "text-muted" : "text-warning")}>
                      <UserRound aria-hidden="true" className="size-3.5" />
                      {o.owner ?? "Owner not recorded"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No confirmed workflow, so no owner to notify.</p>
            )}
          </Section>

          <Section id="timeline" title="Timeline" testId="timeline">
            <ol className="flex flex-col gap-3 border-l border-border-strong pl-4">
              {incident.timeline.map((t, i) => (
                <li key={`${t.kind}-${t.at}-${i}`} className="relative flex flex-col gap-0.5" data-projected={t.projected || undefined}>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute -left-[1.3rem] top-1.5 size-2 rounded-full",
                      t.projected ? "border border-info bg-background" : "bg-border-strong",
                    )}
                  />
                  <span className="font-mono text-xs text-subtle">
                    {formatUtc(t.at)}
                    {t.projected ? <span className="ml-1.5 text-info">(projected)</span> : null}
                  </span>
                  <span className="text-sm text-foreground">{t.label}</span>
                </li>
              ))}
            </ol>
          </Section>

          <Section id="evidence" title="Evidence" testId="evidence-panel">
            {incident.missingEvidenceIds.length ? (
              <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-foreground">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warning" />
                Unknown provenance: {incident.missingEvidenceIds.join(", ")} cited but missing.
              </p>
            ) : null}
            <ul className="flex flex-col gap-2">
              {incident.evidence.map((e) => (
                <li key={e.id} className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-surface-raised p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {e.badge ? (
                      <Badge variant={PROVENANCE_TONE_VARIANT[e.badge.tone]} title={e.badge.description}>
                        {e.badge.label}
                      </Badge>
                    ) : null}
                    <Badge variant={PROVENANCE_TONE_VARIANT[e.tone]} className="normal-case tracking-normal">
                      {e.label}
                    </Badge>
                    <span className="text-xs text-subtle">
                      {e.verificationStatus === "USER_VERIFIED" ? "Verified" : e.verificationStatus === "REJECTED" ? "Rejected" : "Unverified"}
                    </span>
                  </div>
                  <p className="break-all font-mono text-xs text-foreground">{e.sourceId}</p>
                  {e.excerpt ? <p className="line-clamp-3 break-words text-xs text-muted">{e.excerpt}</p> : null}
                  <Link href={sourceHref(e.id)} className="inline-flex w-fit items-center gap-1 text-xs text-info hover:underline">
                    <FileSearch aria-hidden="true" className="size-3.5" />
                    Inspect source
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          {evaluation.requestedMappings.length && incident.calculation.kind !== "UNKNOWN" ? (
            <Section id="mappings" title="Mappings requested">
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
                {evaluation.requestedMappings.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      </div>

      <p className="flex items-start gap-2 text-xs text-subtle">
        <CircleHelp aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        Severity and confidence are independent: severity is how bad it could be, confidence is how sure the inputs are.
      </p>
    </div>
  );
}
