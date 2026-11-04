import Link from "next/link";
import { ChevronRight } from "lucide-react";

import type { EvidenceLedgerEntry, SourcesListQuery } from "@/lib/provenance";
import { formatUtc } from "@/components/layout/format-utc";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ClassificationBadge, SimulationBadge, VerificationBadge } from "./badges";
import { sourcesHref } from "./query";

export function EvidenceList({
  entries,
  filters,
  selectedId,
}: {
  entries: EvidenceLedgerEntry[];
  filters: SourcesListQuery;
  selectedId: string | null;
}) {
  return (
    <ul aria-label="Evidence records" className="flex flex-col gap-2" data-testid="evidence-list">
      {entries.map((entry) => {
        const selected = entry.id === selectedId;
        const supportCount = entry.supports.length;
        return (
          <li key={entry.id}>
            <Link
              href={sourcesHref(filters, entry.id)}
              scroll={false}
              aria-current={selected ? "true" : undefined}
              data-testid="evidence-item"
              data-evidence-id={entry.id}
              className={cn(
                "group flex min-w-0 items-start gap-3 rounded-lg border p-3.5 transition-colors",
                selected
                  ? "border-accent/50 bg-surface-raised"
                  : "border-border bg-surface hover:border-border-strong hover:bg-surface-hover",
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="min-w-0 break-all font-mono text-sm font-medium text-foreground">
                    {entry.sourceId}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <SimulationBadge entry={entry} />
                  <ClassificationBadge entry={entry} />
                  <VerificationBadge entry={entry} />
                  {entry.lineageStatus === "SUPERSEDED" ? (
                    <Badge variant="neutral" className="normal-case tracking-normal" data-testid="superseded-badge">
                      Superseded
                    </Badge>
                  ) : null}
                </div>
                {entry.excerpt ? (
                  <p className="line-clamp-2 break-words text-sm leading-relaxed text-muted">
                    {entry.excerpt}
                  </p>
                ) : null}
                <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-subtle">
                  <span>
                    Captured{" "}
                    <time dateTime={entry.capturedAt} className="font-mono">
                      {formatUtc(entry.capturedAt)}
                    </time>
                  </span>
                  <span>
                    Supports {supportCount}{" "}
                    {supportCount === 1 ? "assertion" : "assertions"}
                  </span>
                </p>
              </div>
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  "mt-0.5 size-4 shrink-0 transition-colors",
                  selected ? "text-accent" : "text-subtle group-hover:text-muted",
                )}
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
