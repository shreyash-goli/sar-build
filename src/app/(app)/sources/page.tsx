import type { Metadata } from "next";
import { connection } from "next/server";
import { Database } from "lucide-react";

import { ModeChip, modeDescription } from "@/components/layout/mode-chip";
import { formatUtc, readShellStatus } from "@/components/layout/shell-status";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Sources" };

export default async function Page() {
  await connection();
  const status = readShellStatus();

  return (
    <>
      <PageHeader
        eyebrow="Data provenance"
        title="Sources"
        description="Where FailSafe's data comes from, how fresh it is, and what kind of evidence each source provides."
      />

      <Card>
        <CardHeader>
          <CardTitle>Current source mode</CardTitle>
          <CardDescription>
            Derived from server configuration. FailSafe never mixes demo and
            live data silently.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <dt className="text-xs font-medium uppercase tracking-[0.1em] text-subtle">
                Mode
              </dt>
              <dd>
                <ModeChip mode={status.mode} />
              </dd>
            </div>
            <div className="flex flex-col gap-1.5">
              <dt className="text-xs font-medium uppercase tracking-[0.1em] text-subtle">
                Meaning
              </dt>
              <dd className="text-muted">{modeDescription(status.mode)}</dd>
            </div>
            <div className="flex flex-col gap-1.5">
              <dt className="text-xs font-medium uppercase tracking-[0.1em] text-subtle">
                Last loaded
              </dt>
              <dd className="text-muted">
                {status.lastLoadedAt
                  ? formatUtc(status.lastLoadedAt)
                  : "No data loaded"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <EmptyState
        icon={Database}
        title="No data loaded"
        description={
          <>
            <p>No data loaded yet — the seeded demo arrives in a later task.</p>
            <p className="mt-1 text-subtle">
              No sources have been registered, so there are no records or
              evidence to inspect.
            </p>
          </>
        }
      />
    </>
  );
}
