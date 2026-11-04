"use client";

import type { GraphEdge, GraphNode } from "@/lib/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ListedPath } from "./model";
import { PathChain } from "./path-chain";

/** Non-canvas alternative: every end-to-end path as text, each selectable. */
export function PathList({
  paths,
  nodeById,
  edgeById,
  needsMapping,
  onShow,
}: {
  paths: ListedPath[];
  nodeById: ReadonlyMap<string, GraphNode>;
  edgeById: ReadonlyMap<string, GraphEdge>;
  needsMapping: ReadonlySet<string>;
  onShow: (path: ListedPath) => void;
}) {
  return (
    <section aria-labelledby="path-list-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="path-list-title" className="text-base font-semibold text-foreground">
          All dependency paths
        </h2>
        <p className="text-sm text-muted">
          Text view of every chain in the graph, from each fund (or each vendor that nothing
          maps a payment to) to the workflows and outcomes it reaches.
        </p>
      </div>
      {paths.length === 0 ? (
        <p className="text-sm text-muted">No end-to-end paths match the current filters.</p>
      ) : (
        <ol className="flex flex-col gap-2" data-testid="path-list">
          {paths.map((p) => (
            <li
              key={p.pathId}
              data-path-id={p.pathId}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <PathChain nodeIds={p.nodeIds} edgeIds={p.edgeIds} nodeById={nodeById} edgeById={edgeById} />
                <div className="flex flex-wrap gap-1.5">
                  {p.confirmed ? (
                    <Badge variant="success" className="normal-case tracking-normal">Confirmed</Badge>
                  ) : (
                    <Badge variant="accent" className="normal-case tracking-normal">Includes suggested link</Badge>
                  )}
                  {p.nodeIds.some((id) => needsMapping.has(id)) ? (
                    <Badge variant="warning" className="normal-case tracking-normal">Needs mapping</Badge>
                  ) : null}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onShow(p)}
                aria-label={`Show path on graph: ${p.nodeIds.map((id) => nodeById.get(id)?.label ?? id).join(" to ")}`}
              >
                Show on graph
              </Button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
