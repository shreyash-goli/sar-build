import type { Metadata } from "next";
import { connection } from "next/server";
import { LayoutDashboard } from "lucide-react";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { loadDashboard } from "@/lib/dashboard/load";

export const metadata: Metadata = { title: "Overview" };

export default async function Page() {
  await connection();
  const data = await loadDashboard();
  const nothingLoaded =
    data.freshness.sourceEvidenceCount === 0 && data.exposures.length === 0 && data.healthy.length === 0;

  return (
    <>
      <PageHeader
        eyebrow="Command center"
        title="Overview"
        description="Where funding risk meets operational dependencies. Every figure is computed from loaded records by the deterministic risk engine."
      />
      {nothingLoaded ? (
        <EmptyState
          icon={LayoutDashboard}
          title="No data loaded"
          description={
            <>
              <p>There are no source records or risk results, so there is nothing to summarize.</p>
              <p className="mt-1 text-subtle">
                Load the fictional demo workspace with <code className="font-mono text-muted">pnpm db:seed</code>.
              </p>
            </>
          }
        />
      ) : (
        <DashboardView data={data} />
      )}
    </>
  );
}
