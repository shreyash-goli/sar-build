import type { Metadata } from "next";
import { FlaskConical } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Response Studio" };

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Simulation workspace"
        title="Response Studio"
        description="Model a response before anyone acts on it: before/after projections, approvals and an audit trail. Simulations never change live financial data."
      />
      <EmptyState
        icon={FlaskConical}
        title="No data loaded"
        description={
          <>
            <p>No data loaded yet — the seeded demo arrives in a later task.</p>
            <p className="mt-1 text-subtle">No scenarios exist yet, so there is nothing to simulate.</p>
          </>
        }
      />
    </>
  );
}
