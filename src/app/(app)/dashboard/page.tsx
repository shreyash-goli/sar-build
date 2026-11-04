import type { Metadata } from "next";
import { LayoutDashboard } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Overview" };

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Command center"
        title="Overview"
        description="Where financial funding risk meets operational dependencies. Metrics appear here only when they can be traced to loaded records."
      />
      <EmptyState
        icon={LayoutDashboard}
        title="No data loaded"
        description={
          <>
            <p>No data loaded yet — the seeded demo arrives in a later task.</p>
            <p className="mt-1 text-subtle">Nothing is being counted, so no metrics are shown.</p>
          </>
        }
      />
    </>
  );
}
