import Link from "next/link";
import { Filter, Search } from "lucide-react";

import type { IncidentListQuery } from "@/lib/incidents/schema";
import { IncidentStatus, RiskCategory, Severity } from "@/lib/schema/enums";
import { Button, buttonVariants } from "@/components/ui/button";
import { CATEGORY_LABEL, SEVERITY_LABEL } from "@/components/dashboard/format";
import { STATUS_LABEL } from "./pills";

const field = "flex min-w-0 flex-col gap-1.5";
const labelCls = "text-xs font-medium text-muted";
const control =
  "h-9 w-full min-w-0 rounded-md border border-border-strong bg-surface-raised px-3 text-sm text-foreground";

/** Plain GET form: filters live in the URL and are validated server-side. */
export function IncidentFilters({ query }: { query: IncidentListQuery }) {
  const active = Object.values(query).some((v) => v !== undefined);
  return (
    <form method="get" action="/incidents" aria-label="Filter incidents" className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))]">
        <div className={field}>
          <label htmlFor="incident-q" className={labelCls}>
            Search
          </label>
          <div className="relative flex items-center">
            <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 size-4 text-subtle" />
            <input
              id="incident-q"
              name="q"
              type="search"
              defaultValue={query.q ?? ""}
              placeholder="Title or vendor"
              maxLength={100}
              className={`${control} pl-8`}
            />
          </div>
        </div>
        <div className={field}>
          <label htmlFor="incident-signal" className={labelCls}>
            Signal
          </label>
          <select id="incident-signal" name="signal" defaultValue={query.signal ?? ""} className={control}>
            <option value="">All signals</option>
            <option value="FORECAST">Forecast</option>
            <option value="OBSERVED_DECLINE">Observed decline</option>
          </select>
        </div>
        <div className={field}>
          <label htmlFor="incident-severity" className={labelCls}>
            Severity
          </label>
          <select id="incident-severity" name="severity" defaultValue={query.severity ?? ""} className={control}>
            <option value="">All severities</option>
            {Severity.options.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className={field}>
          <label htmlFor="incident-category" className={labelCls}>
            Category
          </label>
          <select id="incident-category" name="category" defaultValue={query.category ?? ""} className={control}>
            <option value="">All categories</option>
            {RiskCategory.options.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div className={field}>
          <label htmlFor="incident-status" className={labelCls}>
            Status
          </label>
          <select id="incident-status" name="status" defaultValue={query.status ?? ""} className={control}>
            <option value="">All statuses</option>
            {IncidentStatus.options.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className={field}>
          <label htmlFor="incident-sort" className={labelCls}>
            Sort
          </label>
          <select id="incident-sort" name="sort" defaultValue={query.sort ?? ""} className={control}>
            <option value="">Severity</option>
            <option value="due">Soonest due</option>
            <option value="updated">Recently updated</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm">
          <Filter aria-hidden="true" />
          Apply
        </Button>
        {active ? (
          <Link href="/incidents" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  );
}
