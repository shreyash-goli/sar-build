import Link from "next/link";
import { ArrowRight, CircleCheck, CircleDashed, FlaskConical, ShieldAlert, X } from "lucide-react";

import {
  EVIDENCE_CATEGORY_DEFINITIONS,
  type EvidenceLedgerEntry,
  type SourcesListQuery,
} from "@/lib/provenance";
import { formatUtc } from "@/components/layout/shell-status";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ClassificationBadge, SimulationBadge, VerificationBadge } from "./badges";
import {
  METHOD_LABEL,
  REVIEW_STATUS_VARIANT,
  SUBJECT_TYPE_LABEL,
  reviewStatusLabel,
  trustSummary,
} from "./labels";
import { sourcesHref } from "./query";

function Field({
  label,
  children,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid={testId}>
      <dt className="text-xs font-medium uppercase tracking-[0.1em] text-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

function Missing({ children }: { children: React.ReactNode }) {
  return <span className="text-subtle">{children}</span>;
}

export function EvidenceInspector({
  entry,
  filters,
}: {
  entry: EvidenceLedgerEntry;
  filters: SourcesListQuery;
}) {
  const trust = trustSummary(entry);
  const category = EVIDENCE_CATEGORY_DEFINITIONS[entry.display.category];

  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle">
            Source inspector
          </p>
          <h2
            id="inspector-title"
            className="break-all font-mono text-base font-semibold text-foreground"
          >
            {entry.sourceId}
          </h2>
        </div>
        <Link
          href={sourcesHref(filters)}
          scroll={false}
          aria-label="Close source inspector"
          className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "-mr-1.5 -mt-1")}
        >
          <X aria-hidden="true" />
        </Link>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <SimulationBadge entry={entry} />
        <ClassificationBadge entry={entry} />
        <VerificationBadge entry={entry} />
      </div>

      {/* Explicit answer: demo/mock or verified? */}
      <div
        data-testid="trust-summary"
        className="flex flex-col gap-2 rounded-lg border border-border-strong bg-background/60 p-3.5 text-sm"
      >
        <p className="flex items-start gap-2">
          {entry.display.isSimulated ? (
            <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          ) : (
            <CircleDashed aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
          )}
          <span className="text-foreground">{trust.simulation}</span>
        </p>
        <p className="flex items-start gap-2">
          {entry.verificationStatus === "USER_VERIFIED" ? (
            <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
          ) : (
            <ShieldAlert
              aria-hidden="true"
              className={cn(
                "mt-0.5 size-4 shrink-0",
                entry.verificationStatus === "REJECTED" ? "text-danger" : "text-muted",
              )}
            />
          )}
          <span className="text-foreground">{trust.verification}</span>
        </p>
      </div>

      <section aria-labelledby="supports-title" className="flex flex-col gap-2.5">
        <h3 id="supports-title" className="text-sm font-semibold text-foreground">
          Supports {entry.supports.length}{" "}
          {entry.supports.length === 1 ? "assertion" : "assertions"}
        </h3>
        {entry.supports.length === 0 ? (
          <p className="text-sm text-muted">
            No record, node, edge or incident cites this evidence.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="supported-assertions">
            {entry.supports.map((s) => (
              <li
                key={`${s.subjectType}:${s.subjectId}`}
                data-testid="supported-assertion"
                className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-surface-raised p-3"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="neutral" className="normal-case tracking-normal">
                    {SUBJECT_TYPE_LABEL[s.subjectType]}
                  </Badge>
                  {s.edge ? (
                    <Badge
                      variant={REVIEW_STATUS_VARIANT[s.edge.reviewStatus]}
                      className="normal-case tracking-normal"
                    >
                      {reviewStatusLabel(s.edge.reviewStatus)}
                    </Badge>
                  ) : null}
                </div>
                <p className="break-words text-sm text-foreground">{s.label}</p>
                {s.edge ? (
                  <p className="flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-xs text-muted">
                    <span className="break-all">{s.edge.fromNodeId}</span>
                    <ArrowRight aria-hidden="true" className="size-3 shrink-0" />
                    <span className="text-info">{s.edge.relation}</span>
                    <ArrowRight aria-hidden="true" className="size-3 shrink-0" />
                    <span className="break-all">{s.edge.toNodeId}</span>
                  </p>
                ) : null}
                <p className="break-all font-mono text-xs text-subtle">{s.subjectId}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <dl className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
        <Field label="Evidence class" testId="field-classification">
          {entry.display.label}{" "}
          <span className="text-muted">· {category.label}</span>
          <span className="mt-1 block text-xs leading-relaxed text-muted">
            {entry.display.shortDescription}
          </span>
        </Field>
        <Field label="Review status" testId="field-review">
          {entry.verification.label}
        </Field>
        <Field label="Method">{METHOD_LABEL[entry.kind]}</Field>
        <Field label="Source system">
          <span className="break-all font-mono">{entry.sourceSystem}</span>
        </Field>
        <Field label="Source ID">
          <span className="break-all font-mono">{entry.sourceId}</span>
        </Field>
        <Field label="Path">
          {entry.path ? (
            <span className="break-all font-mono">{entry.path}</span>
          ) : (
            <Missing>No path recorded</Missing>
          )}
        </Field>
        <Field label="Captured at">
          <time dateTime={entry.capturedAt} className="font-mono">
            {formatUtc(entry.capturedAt)}
          </time>
        </Field>
        <Field label="Observed at">
          {entry.observedAt ? (
            <time dateTime={entry.observedAt} className="font-mono">
              {formatUtc(entry.observedAt)}
            </time>
          ) : (
            <Missing>Not recorded</Missing>
          )}
        </Field>
        <Field label="Content hash">
          {entry.contentHash ? (
            <span className="break-all font-mono">{entry.contentHash}</span>
          ) : (
            <Missing>No hash recorded</Missing>
          )}
        </Field>
        <Field label="Evidence record ID">
          <span className="break-all font-mono">{entry.id}</span>
        </Field>
      </dl>

      <section aria-labelledby="excerpt-title" className="flex flex-col gap-2">
        <h3 id="excerpt-title" className="text-sm font-semibold text-foreground">
          Original excerpt
        </h3>
        {entry.excerpt ? (
          <blockquote className="whitespace-pre-wrap break-words rounded-md border-l-2 border-border-strong bg-background/60 px-3.5 py-2.5 font-mono text-xs leading-relaxed text-muted">
            {entry.excerpt}
          </blockquote>
        ) : (
          <p className="text-sm text-subtle">No excerpt was captured for this record.</p>
        )}
      </section>

      <section aria-labelledby="lineage-title" className="flex flex-col gap-2" data-testid="rule-lineage">
        <h3 id="lineage-title" className="text-sm font-semibold text-foreground">
          Rule lineage
        </h3>
        {entry.ruleLineage.length === 0 ? (
          <p className="text-sm text-muted">
            No rule lineage yet.{" "}
            <span className="text-subtle">
              {entry.classification === "DERIVED"
                ? "Rule evaluations are recorded once the risk engine runs."
                : "Only derived evidence is produced by rules; this record was not."}
            </span>
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entry.ruleLineage.map((r) => (
              <li
                key={`${r.ruleId}:${r.assertionId}:${r.evaluatedAt}`}
                className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-surface-raised p-3 text-sm"
              >
                <span className="break-all font-mono text-foreground">{r.ruleId}</span>
                <span className="text-xs text-muted">
                  Assertion <code className="break-all font-mono">{r.assertionId}</code> · evaluated{" "}
                  <time dateTime={r.evaluatedAt} className="font-mono">
                    {formatUtc(r.evaluatedAt)}
                  </time>
                </span>
                <span className="break-words text-xs text-subtle">
                  Inputs:{" "}
                  {r.inputs.length ? (
                    <code className="break-all font-mono">{r.inputs.join(", ")}</code>
                  ) : (
                    "none recorded"
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
