import type { Metadata } from "next";
import { Network } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Dependency Graph" };

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Financial → operational paths"
        title="Dependency Graph"
        description="How cards, vendors and funding sources connect to the services and workflows that depend on them. Every edge will carry its provenance."
      />
      <EmptyState
        icon={Network}
        title="No data loaded"
        description={
          <>
            <p>No data loaded yet — the seeded demo arrives in a later task.</p>
            <p className="mt-1 text-subtle">No nodes or edges exist yet, so there is no graph to draw.</p>
          </>
        }
      />
    </>
  );
}
