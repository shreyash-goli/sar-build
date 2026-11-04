import type { Metadata } from "next";
import { connection } from "next/server";
import { Network } from "lucide-react";

import { GraphExplorer } from "@/components/graph/graph-explorer";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { loadGraph } from "@/lib/graph/load";

export const metadata: Metadata = { title: "Dependency Graph" };

type SearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || null;

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection();
  const sp = await searchParams;
  const graph = await loadGraph();

  return (
    <>
      <PageHeader
        eyebrow="Financial → operational paths"
        title="Dependency Graph"
        description="Funds and cards pay vendors; services, workflows and customer outcomes depend on them. Select a node to trace its confirmed downstream impact."
        className="pb-4"
      />
      {graph.unresolvedEvidenceIds.length > 0 ? (
        <p
          role="alert"
          data-testid="graph-unresolved"
          className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-foreground"
        >
          {graph.unresolvedEvidenceIds.length} cited evidence{" "}
          {graph.unresolvedEvidenceIds.length === 1 ? "record is" : "records are"} missing. Affected
          nodes and edges show unknown provenance.
        </p>
      ) : null}
      {graph.nodes.length === 0 ? (
        <EmptyState
          icon={Network}
          title="No graph loaded"
          description={
            <>
              <p>There are no nodes or edges in the database, so there is no graph to draw.</p>
              <p className="mt-1 text-subtle">
                Load the fictional demo workspace with{" "}
                <code className="font-mono text-muted">pnpm db:seed</code>.
              </p>
            </>
          }
        />
      ) : (
        <GraphExplorer graph={graph} initialNodeId={one(sp.node)} initialPathId={one(sp.path)} />
      )}
    </>
  );
}
