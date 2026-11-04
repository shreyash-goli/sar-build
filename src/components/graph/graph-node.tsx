"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { CircleHelp } from "lucide-react";

import type { GraphNode } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { KIND_ICON } from "./kind-icons";
import { KIND_LABEL, NODE_HEIGHT, NODE_WIDTH } from "./model";

export type NodeEmphasis =
  | "none" // no selection active
  | "selected"
  | "confirmed" // downstream on a confirmed path
  | "possible" // downstream only via SUGGESTED edges
  | "upstream" // confirmed funding chain feeding the selection
  | "muted"; // not related to the selection

export type FsNodeData = {
  node: GraphNode;
  emphasis: NodeEmphasis;
  fundingUnknown: boolean;
  unknownLineage: boolean;
  searchMatch: boolean;
};

export type FsNode = Node<FsNodeData, "fs">;

const KIND_ACCENT: Record<GraphNode["kind"], string> = {
  FUND: "text-info",
  CARD: "text-info",
  VENDOR: "text-foreground",
  SERVICE: "text-muted",
  WORKFLOW: "text-muted",
  OUTCOME: "text-muted",
};

function GraphNodeView({ data }: NodeProps<FsNode>) {
  const { node, emphasis, fundingUnknown, unknownLineage, searchMatch } = data;
  const Icon = KIND_ICON[node.kind];
  const unknown = fundingUnknown || unknownLineage;

  return (
    <div
      data-testid={`graph-node-${node.id}`}
      data-emphasis={emphasis}
      data-unknown={unknown || undefined}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      className={cn(
        "relative flex flex-col justify-center gap-1 rounded-lg border bg-surface-raised px-3 py-2 shadow-[0_6px_18px_-10px_rgb(0_0_0/0.8)] transition-[opacity,border-color,box-shadow] duration-150",
        unknown ? "border-dashed border-warning/60" : "border-border-strong",
        emphasis === "selected" && "border-solid border-accent shadow-[0_0_0_3px_rgb(182_239_91/0.25)]",
        emphasis === "confirmed" && "border-solid border-accent/70",
        emphasis === "possible" && "border-dashed border-accent/50",
        emphasis === "upstream" && "border-solid border-info/60",
        emphasis === "muted" && "opacity-35",
        searchMatch && "ring-2 ring-info ring-offset-2 ring-offset-background",
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="!size-1.5 !border-0 !bg-border-strong" />
      <div className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-subtle">
        <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", KIND_ACCENT[node.kind])} />
        <span className="truncate">{KIND_LABEL[node.kind]}</span>
      </div>
      <div
        className={cn(
          "text-[0.9375rem] font-semibold leading-tight text-foreground",
          fundingUnknown ? "truncate" : "line-clamp-2",
        )}
      >
        {node.label}
      </div>
      {fundingUnknown ? (
        <div className="flex items-center gap-1 text-[0.6875rem] font-medium text-warning">
          <CircleHelp aria-hidden="true" className="size-3 shrink-0" />
          Needs mapping
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} isConnectable={false} className="!size-1.5 !border-0 !bg-border-strong" />
    </div>
  );
}

export const GraphNodeComponent = memo(GraphNodeView);
