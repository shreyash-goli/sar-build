import Link from "next/link";
import { Filter } from "lucide-react";

import type { SourcesListQuery } from "@/lib/provenance";
import { SourceClass, VerificationStatus } from "@/lib/schema/enums";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sourceClassLabel, verificationLabel } from "./labels";

const selectClass =
  "h-9 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-border-strong bg-surface-raised bg-[length:16px] bg-[right_0.5rem_center] bg-no-repeat pl-3 pr-8 text-sm text-foreground hover:bg-surface-hover";

// Inline chevron so the native select keeps a visible affordance after appearance-none.
const chevron = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239aa8bd' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
};

/**
 * Plain GET form: works without JavaScript, filters live in the URL, and the
 * server re-queries the ledger. Selected source is cleared on re-filter.
 */
export function SourcesFilters({ filters }: { filters: SourcesListQuery }) {
  const active = Boolean(filters.classification || filters.verificationStatus);
  return (
    <form
      method="get"
      action="/sources"
      aria-label="Filter sources"
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <label
          htmlFor="filter-classification"
          className="text-xs font-medium text-muted"
        >
          Evidence class
        </label>
        <select
          id="filter-classification"
          name="classification"
          defaultValue={filters.classification ?? ""}
          className={selectClass}
          style={chevron}
        >
          <option value="">All classes</option>
          {SourceClass.options.map((c) => (
            <option key={c} value={c}>
              {sourceClassLabel(c)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <label
          htmlFor="filter-verification"
          className="text-xs font-medium text-muted"
        >
          Review status
        </label>
        <select
          id="filter-verification"
          name="verificationStatus"
          defaultValue={filters.verificationStatus ?? ""}
          className={selectClass}
          style={chevron}
        >
          <option value="">All statuses</option>
          {VerificationStatus.options.map((v) => (
            <option key={v} value={v}>
              {verificationLabel(v)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" className="flex-1 sm:flex-none">
          <Filter aria-hidden="true" />
          Apply filters
        </Button>
        {active ? (
          <Link
            href="/sources"
            className={cn(buttonVariants({ variant: "outline" }), "flex-1 sm:flex-none")}
          >
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  );
}
