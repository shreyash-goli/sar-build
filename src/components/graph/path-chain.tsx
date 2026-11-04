import { ArrowRight } from "lucide-react";

import type { GraphEdge, GraphNode } from "@/lib/schema";

/** Text rendering of one exact path: Node -RELATION-> Node -> ... */
export function PathChain({
  nodeIds,
  edgeIds,
  nodeById,
  edgeById,
  onInspectEdge,
}: {
  nodeIds: readonly string[];
  edgeIds: readonly string[];
  nodeById: ReadonlyMap<string, GraphNode>;
  edgeById: ReadonlyMap<string, GraphEdge>;
  /** When given, each relation becomes a button that opens the edge inspector. */
  onInspectEdge?: (edgeId: string) => void;
}) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
      {nodeIds.map((id, i) => {
        const edge = i > 0 ? edgeById.get(edgeIds[i - 1]!) : undefined;
        return (
          <span key={`${id}-${i}`} className="flex min-w-0 items-center gap-1.5">
            {edge ? (
              <span className="flex items-center gap-1 font-mono text-[0.6875rem] text-subtle">
                {onInspectEdge ? (
                  <button
                    type="button"
                    onClick={() => onInspectEdge(edge.id)}
                    data-inspect-edge={edge.id}
                    aria-label={`Inspect edge: ${nodeById.get(nodeIds[i - 1]!)?.label ?? ""} ${edge.relation} ${nodeById.get(id)?.label ?? id}`}
                    className={`cursor-pointer rounded underline decoration-dotted underline-offset-2 hover:text-info ${edge.reviewStatus === "CONFIRMED" ? "" : "text-accent"}`}
                  >
                    {edge.relation}
                    {edge.reviewStatus === "CONFIRMED" ? "" : " (suggested)"}
                  </button>
                ) : (
                  <span className={edge.reviewStatus === "CONFIRMED" ? "" : "text-accent"}>
                    {edge.relation}
                    {edge.reviewStatus === "CONFIRMED" ? "" : " (suggested)"}
                  </span>
                )}
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
