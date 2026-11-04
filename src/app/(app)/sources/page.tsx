import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Database, SearchX, SquareMousePointer } from "lucide-react";

import { EvidenceDefinitions } from "@/components/evidence/evidence-definitions";
import { EvidenceInspector } from "@/components/evidence/evidence-inspector";
import { EvidenceList } from "@/components/evidence/evidence-list";
import { InspectorFocus } from "@/components/evidence/inspector-focus";
import { sourceClassLabel, verificationLabel } from "@/components/evidence/labels";
import {
  parseSourcesParams,
  sourcesHref,
  type SourcesSearchParams,
} from "@/components/evidence/query";
import { SourcesFilters } from "@/components/evidence/sources-filters";
import { UnresolvedWarning } from "@/components/evidence/unresolved-warning";
import { IntegrationsPanel } from "@/components/integrations/integrations-panel";
import { getModeChipCopy, ModeChip } from "@/components/layout/mode-chip";
import { readShellContext } from "@/components/layout/shell-context";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import type { SourcesListData } from "@/lib/provenance";
import { findEvidenceSource, listEvidenceSources } from "@/lib/provenance/ledger";
import type { SourceClass, VerificationStatus } from "@/lib/schema/enums";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Sources" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SourcesSearchParams>;
}) {
  await connection();
  const { chip } = await readShellContext();
  const { filters, selectedId, invalid } = parseSourcesParams(await searchParams);

  // Server-side, read-only resolvers (never imported by client components).
  const [ledger, selected] = await Promise.all([
    listEvidenceSources(filters),
    selectedId ? findEvidenceSource(selectedId) : Promise.resolve(null),
  ]);
  const selectedMissing = selectedId !== null && selected === null;

  const filtered = Boolean(filters.classification || filters.verificationStatus);
  const ledgerEmpty = ledger.totals.total === 0 && !filtered;

  return (
    <>
      <PageHeader
        eyebrow="Data provenance"
        title="Sources"
        description="Every piece of evidence FailSafe holds: where it came from, when it was captured, whether a human has reviewed it, and exactly which assertions rely on it."
      />

      <p
        className="-mt-2 flex flex-wrap items-center gap-2 text-sm text-muted"
        data-testid="source-mode-meaning"
      >
        <ModeChip mode={chip.mode} />
        <span>{getModeChipCopy(chip.mode).description}</span>
        {chip.hint ? <span className="text-subtle">· {chip.hint}</span> : null}
      </p>

      <IntegrationsPanel />

      <UnresolvedWarning unresolved={ledger.unresolved} />

      {ledgerEmpty ? (
        <EmptyState
          icon={Database}
          title="No evidence records loaded"
          description={
            <>
              <p>The evidence ledger is empty, so there are no sources to inspect.</p>
              {chip.mode === "RAMP_SANDBOX" ? (
                <p className="mt-1 text-subtle" data-testid="ledger-empty-hint" data-mode="RAMP_SANDBOX">
                  No Ramp data yet: run a read-only sync from the Integrations panel (or{" "}
                  <code className="font-mono text-muted">pnpm demo:reset</code> to return to the demo).
                </p>
              ) : (
                <p className="mt-1 text-subtle" data-testid="ledger-empty-hint" data-mode={chip.mode ?? "NONE"}>
                  Load the fictional demo workspace with{" "}
                  <code className="font-mono text-muted">pnpm db:seed</code>.
                </p>
              )}
            </>
          }
        />
      ) : (
        <section aria-labelledby="ledger-title" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="ledger-title" className="text-base font-semibold text-foreground">
              Evidence ledger
            </h2>
            <LedgerSummary totals={ledger.totals} filtered={filtered} />
          </div>

          <SourcesFilters filters={filters} />

          {invalid.length > 0 ? (
            <p
              role="status"
              data-testid="invalid-filter"
              className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-foreground"
            >
              Ignored unrecognized filter{invalid.length > 1 ? "s" : ""}:{" "}
              {invalid.map((f, i) => (
                <span key={f.name}>
                  {i > 0 ? ", " : null}
                  <code className="break-all font-mono">
                    {f.name}={f.value}
                  </code>
                </span>
              ))}
              . Showing results without {invalid.length > 1 ? "them" : "it"}.
            </p>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-start">
            <div className="min-w-0">
              {ledger.entries.length === 0 ? (
                <EmptyState
                  icon={SearchX}
                  title="No sources match these filters"
                  description="No evidence records have this combination of class and review status."
                >
                  <Link href="/sources" className={buttonVariants({ variant: "outline", size: "sm" })}>
                    Clear filters
                  </Link>
                </EmptyState>
              ) : (
                <EvidenceList
                  entries={ledger.entries}
                  filters={filters}
                  selectedId={selectedId}
                />
              )}
            </div>

            <InspectorFocus
              selectionKey={selectedId ?? ""}
              className={cn(
                "min-w-0 scroll-mt-28 rounded-xl border border-border bg-surface outline-none focus-visible:ring-2 focus-visible:ring-ring lg:sticky lg:top-[calc(var(--topbar-height)+1.5rem)] lg:max-h-[calc(100dvh-var(--topbar-height)-3rem)] lg:overflow-y-auto",
                // Stacked layout: show an open inspector above the long list.
                selected || selectedMissing
                  ? "order-first lg:order-none"
                  : "hidden lg:block",
              )}
            >
              {selected ? (
                <EvidenceInspector entry={selected} filters={filters} />
              ) : selectedMissing ? (
                <div className="flex flex-col items-start gap-3 p-5" data-testid="inspector-not-found">
                  <h2 id="inspector-title" className="text-sm font-semibold text-foreground">
                    Source not found
                  </h2>
                  <p className="break-words text-sm text-muted">
                    No evidence record has the ID{" "}
                    <code className="break-all font-mono text-foreground">{selectedId}</code>.
                    It may have been removed when the demo was reset.
                  </p>
                  <Link
                    href={sourcesHref(filters)}
                    scroll={false}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Close
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
                  <SquareMousePointer aria-hidden="true" className="size-5 text-subtle" />
                  <h2 id="inspector-title" className="text-sm font-semibold text-foreground">
                    Select a source to inspect it
                  </h2>
                  <p className="max-w-xs text-sm text-muted">
                    See exactly which assertions it supports and whether it is
                    demo data or verified.
                  </p>
                </div>
              )}
            </InspectorFocus>
          </div>
        </section>
      )}

      <EvidenceDefinitions />
    </>
  );
}

function LedgerSummary({
  totals,
  filtered,
}: {
  totals: SourcesListData["totals"];
  filtered: boolean;
}) {
  const classes = (Object.entries(totals.byClassification) as [SourceClass, number][]).filter(
    ([, n]) => n > 0,
  );
  const statuses = (
    Object.entries(totals.byVerificationStatus) as [VerificationStatus, number][]
  ).filter(([, n]) => n > 0);

  return (
    <p className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-muted" data-testid="ledger-summary">
      <span>
        <span className="font-medium text-foreground" data-testid="ledger-total">
          {totals.total}
        </span>{" "}
        {totals.total === 1 ? "record" : "records"}
        {filtered ? " match the current filters" : " in the ledger"}
      </span>
      {[...classes.map(([c, n]) => `${n} ${sourceClassLabel(c)}`),
        ...statuses.map(([v, n]) => `${n} ${verificationLabel(v).toLowerCase()}`)].map((t) => (
        <span key={t} className="before:mr-2 before:text-border-strong before:content-['·']">
          {t}
        </span>
      ))}
    </p>
  );
}
