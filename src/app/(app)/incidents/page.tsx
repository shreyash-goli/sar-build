import type { Metadata } from "next";
import { Siren } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Incidents" };

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Risk triage"
        title="Incidents"
        description="Projected shortages and observed declines, with the evidence and uncertainty behind each one."
      />
      <EmptyState
        icon={Siren}
        title="No data loaded"
        description={
          <>
            <p>No data loaded yet — the seeded demo arrives in a later task.</p>
            <p className="mt-1 text-subtle">No incidents have been detected because no records have been evaluated.</p>
          </>
        }
      />
    </>
  );
}
