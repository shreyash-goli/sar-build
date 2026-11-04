"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useStore,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

import type { GraphEdge } from "@/lib/schema";
import { cn } from "@/lib/utils";

export type EdgeEmphasis =
  "none" | "confirmed" | "possible" | "upstream" | "muted";

export type FsEdgeData = {
  edge: GraphEdge;
  emphasis: EdgeEmphasis;
  unknownLineage: boolean;
  /** Open in the edge inspector. */
  inspected?: boolean;
};

export type FsEdge = Edge<FsEdgeData, "fs">;

const STRENGTH_WIDTH: Record<GraphEdge["dependencyStrength"], number> = {
  HARD: 2.25,
  DEGRADED: 1.5,
  OPTIONAL: 1,
};

function strokeFor(data: FsEdgeData): string {
  switch (data.emphasis) {
    case "confirmed":
    case "possible":
      return "var(--accent)";
    case "upstream":
      return "var(--info)";
    default:
      return data.unknownLineage ? "var(--warning)" : "var(--border-strong)";
  }
}

/** Relation labels keep a constant on-screen size (px) at any zoom. */
const LABEL_SCREEN_PX = 11;
const zoomSelector = (s: { transform: [number, number, number] }) =>
  s.transform[2];

function GraphEdgeView(props: EdgeProps<FsEdge>) {
  const {
    id,
    data,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
  } = props;
  const zoom = useStore(zoomSelector);
  if (!data) return null;
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const { edge, emphasis } = data;
  const dashed = edge.reviewStatus !== "CONFIRMED"; // suggested/rejected never drawn solid
  const highlighted =
    emphasis === "confirmed" ||
    emphasis === "possible" ||
    emphasis === "upstream";
  const baseWidth = STRENGTH_WIDTH[edge.dependencyStrength];

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: data.inspected ? "var(--info)" : strokeFor(data),
          strokeWidth: data.inspected ? baseWidth + 2 : highlighted ? baseWidth + 1 : baseWidth,
          strokeDasharray:
            edge.reviewStatus === "REJECTED"
              ? "2 5"
              : dashed
                ? "7 5"
                : undefined,
          opacity: emphasis === "muted" && !data.inspected ? 0.2 : 1,
          transition: "opacity 150ms, stroke 150ms",
        }}
      />
      {highlighted ? (
        <EdgeLabelRenderer>
          <div
            data-testid={`graph-edge-label-${edge.id}`}
            style={{
              // Counter-scale so the pill reads at LABEL_SCREEN_PX on screen, and lift it
              // above the line so it never covers the arrowhead at the target end.
              transform: `translate(${labelX}px, ${labelY}px) scale(${1 / zoom}) translate(-50%, calc(-100% - 5px))`,
              transformOrigin: "0 0",
              fontSize: LABEL_SCREEN_PX,
            }}
            className={cn(
              "pointer-events-none absolute whitespace-nowrap rounded-full border bg-surface-raised px-2 py-px font-mono font-semibold leading-4 tracking-wide shadow-[0_2px_6px_rgb(0_0_0/0.5)]",
              emphasis === "upstream"
                ? "border-info/60 text-info"
                : "border-accent/60 text-accent",
            )}
          >
            {edge.relation}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const GraphEdgeComponent = memo(GraphEdgeView);
