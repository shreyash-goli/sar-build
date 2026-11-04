import Link from "next/link";
import { SearchX } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function IncidentNotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="Incident not found"
      description="No incident has this ID. It may have been cleared when the demo was reset or the risk engine re-ran."
    >
      <Link href="/incidents" className={buttonVariants({ variant: "outline", size: "sm" })}>
        All incidents
      </Link>
    </EmptyState>
  );
}
