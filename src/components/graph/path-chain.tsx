import { ArrowRight } from "lucide-react";

import type { GraphEdge, GraphNode } from "@/lib/schema";

/** Text rendering of one exact path: Node -RELATION-> Node -> ... */
export function PathChain({
  nodeIds,
  edgeIds,
  nodeById,
  edgeById,
}: {
  nodeIds: readonly string[];
  edgeIds: readonly string[];
  nodeById: ReadonlyMap<string, GraphNode>;
  edgeById: ReadonlyMap<string, GraphEdge>;
}) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
      {nodeIds.map((id, i) => {
        const edge = i > 0 ? edgeById.get(edgeIds[i - 1]!) : undefined;
        return (
          <span key={`${id}-${i}`} className="flex min-w-0 items-center gap-1.5">
            {edge ? (
              <span className="flex items-center gap-1 font-mono text-[0.6875rem] text-subtle">
                <span className={edge.reviewStatus === "CONFIRMED" ? "" : "text-accent"}>
                  {edge.relation}
                  {edge.reviewStatus === "CONFIRMED" ? "" : " (suggested)"}
                </span>
                <ArrowRight aria-hidden="true" className="size-3" />
              </span>
            ) : null}
            <span className="break-words text-foreground">{nodeById.get(id)?.label ?? id}</span>
          </span>
        );
      })}
    </span>
  );
}
