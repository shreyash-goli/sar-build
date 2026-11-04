"use client";

import "@xyflow/react/dist/style.css";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { ChevronDown, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";

import type { GraphData } from "@/lib/graph";
import type { NodeKind, ReviewStatus } from "@/lib/schema";
import { REVIEW_STATUS_DISPLAY } from "@/lib/provenance";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GraphEdgeComponent, type EdgeEmphasis, type FsEdge } from "./graph-edge";
import { GraphLegend } from "./graph-legend";
import { EdgeInspector } from "./inspector";
import { GraphNodeComponent, type FsNode, type NodeEmphasis } from "./graph-node";
import {
  DEFAULT_REVIEW_FILTER,
  KIND_LABEL,
  KIND_ORDER,
  KIND_PLURAL,
  NODE_HEIGHT,
  NODE_WIDTH,
  applyFilters,
  computeLayout,
  listAllPaths,
  searchNodes,
  selectNode,
  unknownLineage,
  type ListedPath,
} from "./model";
import { PathList } from "./path-list";
import { SelectionPanel } from "./selection-panel";

const nodeTypes = { fs: GraphNodeComponent };
const edgeTypes = { fs: GraphEdgeComponent };

// Marker colours must be literal values (SVG attributes do not resolve CSS vars).
const MARKER_COLOR: Record<EdgeEmphasis | "unknown", string> = {
  none: "#2c3b58",
  muted: "#2c3b58",
  confirmed: "#b6ef5b",
  possible: "#b6ef5b",
  upstream: "#5fd4ee",
  unknown: "#f5c04e",
};

// Map React Flow's theme variables onto FailSafe tokens.
const FLOW_THEME = {
  "--xy-background-color": "var(--background)",
  "--xy-minimap-background-color": "var(--surface)",
  "--xy-controls-button-background-color": "var(--surface-raised)",
  "--xy-controls-button-background-color-hover": "var(--surface-hover)",
  "--xy-controls-button-color": "var(--muted)",
  "--xy-controls-button-color-hover": "var(--foreground)",
  "--xy-controls-button-border-color": "var(--border-strong)",
  "--xy-node-boxshadow-selected": "none",
} as React.CSSProperties;

const REVIEW_ORDER: readonly ReviewStatus[] = ["CONFIRMED", "SUGGESTED", "REJECTED"];
const FIT_PADDING = 0.06;

export type GraphExplorerProps = {
  graph: GraphData;
  initialNodeId: string | null;
  initialPathId: string | null;
};

export function GraphExplorer(props: GraphExplorerProps) {
  return (
    <ReactFlowProvider>
      <Explorer {...props} />
    </ReactFlowProvider>
  );
}

function syncUrl(nodeId: string | null, pathId: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (nodeId) params.set("node", nodeId);
  else params.delete("node");
  if (pathId) params.set("path", pathId);
  else params.delete("path");
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

function Explorer({ graph, initialNodeId, initialPathId }: GraphExplorerProps) {
  const flow = useReactFlow();

  const nodeById = React.useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const edgeById = React.useMemo(() => new Map(graph.edges.map((e) => [e.id, e])), [graph.edges]);
  const positions = React.useMemo(() => computeLayout(graph), [graph]);
  // "Needs mapping" is computed server-side from canonical vendor/charge/edge data.
  const vendorByNode = React.useMemo(() => new Map(graph.vendors.map((v) => [v.nodeId, v])), [graph.vendors]);
  const needsMapping = React.useMemo(
    () => new Set(graph.vendors.filter((v) => v.needsMapping).map((v) => v.nodeId)),
    [graph.vendors],
  );
  const lineage = React.useMemo(() => unknownLineage(graph, needsMapping), [graph, needsMapping]);

  const [selectedId, setSelectedId] = React.useState<string | null>(
    initialNodeId && nodeById.has(initialNodeId) ? initialNodeId : null,
  );
  const [focusPathId, setFocusPathId] = React.useState<string | null>(selectedId ? initialPathId : null);
  const [query, setQuery] = React.useState("");
  const [kinds, setKinds] = React.useState<Set<NodeKind>>(() => new Set(KIND_ORDER));
  const [reviews, setReviews] = React.useState<Set<ReviewStatus>>(() => new Set(DEFAULT_REVIEW_FILTER));
  const [announcement, setAnnouncement] = React.useState("");
  const [inspectedEdgeId, setInspectedEdgeId] = React.useState<string | null>(null);
  const closeInspector = React.useCallback(() => setInspectedEdgeId(null), []);

  const visible = React.useMemo(() => applyFilters(graph, { kinds, reviewStatuses: reviews }), [graph, kinds, reviews]);
  // Blast radius always uses the full graph: filters change what is drawn, never what is true.
  const selection = React.useMemo(
    () => (selectedId ? selectNode(graph, selectedId, focusPathId) : null),
    [graph, selectedId, focusPathId],
  );
  const matches = React.useMemo(() => new Set(searchNodes(visible.nodes, query)), [visible.nodes, query]);
  const allPaths = React.useMemo(() => listAllPaths(visible), [visible]);

  const canvasRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLElement>(null);

  /**
   * After a user selection, scroll the minimum needed so the top of the
   * details panel is on screen, without pushing the canvas's top edge under
   * the sticky top bar. No-op when the panel is already visible.
   */
  const revealPanel = React.useCallback(() => {
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      const canvas = canvasRef.current;
      if (!panel || !canvas) return;
      const wantVisible = Math.min(320, window.innerHeight * 0.35);
      const deficit = panel.getBoundingClientRect().top - (window.innerHeight - wantVisible);
      if (deficit <= 0) return;
      const header = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
      const room = canvas.getBoundingClientRect().top - header - 8;
      const delta = Math.min(deficit, Math.max(0, room));
      if (delta <= 0) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollBy({ top: delta, behavior: reduce ? "auto" : "smooth" });
    });
  }, []);

  const select = React.useCallback(
    (nodeId: string | null, pathId: string | null = null) => {
      setSelectedId(nodeId);
      setFocusPathId(pathId);
      syncUrl(nodeId, pathId);
      if (!nodeId) {
        setAnnouncement("Selection cleared.");
        return;
      }
      const s = selectNode(graph, nodeId, pathId);
      const targets = [...s.blast.confirmed.workflows, ...s.blast.confirmed.outcomes].map((n) => n.label);
      const label = nodeById.get(nodeId)?.label ?? nodeId;
      setAnnouncement(
        targets.length
          ? `${label} selected. ${targets.length} confirmed downstream: ${targets.join(", ")}.`
          : `${label} selected. No confirmed downstream workflows or outcomes.`,
      );
    },
    [graph, nodeById],
  );

  const nodeEmphasis = (id: string): NodeEmphasis => {
    if (!selection) return "none";
    const e = selection.emphasis;
    if (id === selection.nodeId) return "selected";
    if (e.confirmedNodeIds.has(id)) return "confirmed";
    if (e.possibleNodeIds.has(id)) return "possible";
    if (!focusPathId && e.upstreamNodeIds.has(id)) return "upstream";
    return "muted";
  };

  const edgeEmphasis = (id: string): EdgeEmphasis => {
    if (!selection) return "none";
    const e = selection.emphasis;
    if (e.confirmedEdgeIds.has(id)) return "confirmed";
    if (e.possibleEdgeIds.has(id)) return "possible";
    if (!focusPathId && e.upstreamEdgeIds.has(id)) return "upstream";
    return "muted";
  };

  const flowNodes: FsNode[] = visible.nodes.map((n) => {
    const emphasis = nodeEmphasis(n.id);
    const fundingUnknown = needsMapping.has(n.id);
    return {
      id: n.id,
      type: "fs",
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      selected: n.id === selectedId,
      draggable: false,
      connectable: false,
      ariaLabel: `${KIND_LABEL[n.kind]}: ${n.label}${fundingUnknown ? ", needs mapping" : ""}${
        emphasis === "confirmed" ? ", confirmed downstream of selection" : ""
      }`,
      data: {
        node: n,
        emphasis,
        fundingUnknown,
        unknownLineage: lineage.nodeIds.has(n.id),
        searchMatch: matches.has(n.id),
      },
    };
  });

  const flowEdges: FsEdge[] = visible.edges.map((e) => {
    const emphasis = edgeEmphasis(e.id);
    const unknown = lineage.edgeIds.has(e.id);
    const color = emphasis === "none" && unknown ? MARKER_COLOR.unknown : MARKER_COLOR[emphasis];
    return {
      id: e.id,
      type: "fs",
      source: e.fromNodeId,
      target: e.toNodeId,
      // Focusable + selectable so Tab/Enter (and click) open the edge inspector.
      focusable: true,
      selectable: true,
      selected: e.id === inspectedEdgeId,
      ariaLabel: `Edge: ${nodeById.get(e.fromNodeId)?.label ?? e.fromNodeId} ${e.relation} ${
        nodeById.get(e.toNodeId)?.label ?? e.toNodeId
      }, ${REVIEW_STATUS_DISPLAY[e.reviewStatus].label.toLowerCase()}. Press Enter to inspect.`,
      // data-* is valid on <g> but absent from React's SVG attribute types.
      domAttributes: { "data-review-status": e.reviewStatus } as React.SVGAttributes<SVGGElement>,
      zIndex: e.id === inspectedEdgeId ? 2 : emphasis === "none" || emphasis === "muted" ? 0 : 1,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      data: { edge: e, emphasis, unknownLineage: unknown, inspected: e.id === inspectedEdgeId },
    };
  });

  // Edge selection (click or Enter on a focused edge) opens the inspector.
  const onEdgesChange = (changes: EdgeChange<FsEdge>[]) => {
    const picked = changes.find((c) => c.type === "select" && c.selected);
    if (picked && "id" in picked) setInspectedEdgeId(picked.id);
  };

  // Keyboard (Enter on a focused node) and mouse selection both arrive here.
  const onNodesChange = (changes: NodeChange<FsNode>[]) => {
    const picked = changes.find((c) => c.type === "select" && c.selected);
    if (picked && "id" in picked) {
      if (picked.id !== selectedId) {
        select(picked.id);
        revealPanel();
      }
      return;
    }
    // Deselect events are ignored: React Flow emits them when an edge is clicked,
    // and inspecting an edge must not drop the node's blast-radius view. The pane
    // click and the "Clear selection" button clear it explicitly.
  };

  const fitTo = (ids: string[]) => {
    if (ids.length === 0) return;
    void flow.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.4, duration: 300, maxZoom: 1.2 });
  };

  const onSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const ids = [...matches];
    if (ids.length === 0) return;
    fitTo(ids);
    if (ids.length === 1) select(ids[0]!);
  };

  const resetAll = () => {
    setQuery("");
    setKinds(new Set(KIND_ORDER));
    setReviews(new Set(DEFAULT_REVIEW_FILTER));
    select(null);
    void flow.fitView({ padding: FIT_PADDING, duration: 300 });
  };

  const toggle = <T,>(set: Set<T>, value: T, update: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  };

  const showPath = (p: ListedPath) => {
    select(p.startNodeId, p.pathId);
    fitTo(p.nodeIds);
    document.getElementById("graph-canvas")?.scrollIntoView({ block: "nearest" });
  };

  // Look the inspected edge up in the FULL graph so a just-rejected (hidden) edge still shows its outcome.
  const inspectedEdge = inspectedEdgeId ? (edgeById.get(inspectedEdgeId) ?? null) : null;
  // Keep the inspected edge visible beside the drawer (right side on sm+, bottom sheet on mobile).
  React.useEffect(() => {
    if (!inspectedEdge) return;
    const wide = window.matchMedia("(min-width: 640px)").matches;
    void flow.fitView({
      nodes: [{ id: inspectedEdge.fromNodeId }, { id: inspectedEdge.toNodeId }],
      padding: wide
        ? { top: "48px", bottom: "48px", left: "48px", right: "392px" }
        : { top: "32px", left: "24px", right: "24px", bottom: "60%" },
      maxZoom: 1,
      duration: 300,
    });
  }, [inspectedEdge, flow]);

  const inspectEdge = (edgeId: string) => {
    setInspectedEdgeId(edgeId);
    document.getElementById("graph-canvas")?.scrollIntoView({ block: "nearest" });
  };

  const hiddenSelection = selectedId !== null && !visible.nodes.some((n) => n.id === selectedId);

  const filtersChanged =
    kinds.size !== KIND_ORDER.length ||
    reviews.size !== DEFAULT_REVIEW_FILTER.length ||
    !DEFAULT_REVIEW_FILTER.every((r) => reviews.has(r));
  const confirmedTargets = selection
    ? [...selection.blast.confirmed.workflows, ...selection.blast.confirmed.outcomes]
    : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar: search, filters (disclosure), reset. One row on desktop. */}
      <div className="flex flex-wrap items-center gap-2">
        <form role="search" onSubmit={onSearchSubmit} className="relative flex w-full min-w-0 items-center sm:w-72">
          <label htmlFor="graph-search" className="sr-only">
            Search nodes
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 size-4 text-subtle" />
          <input
            id="graph-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vendor, service, owner…"
            aria-describedby="graph-search-status"
            className="h-9 w-full min-w-0 rounded-md border border-border-strong bg-surface-raised pl-8 pr-9 text-sm text-foreground placeholder:text-subtle"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-1 flex size-7 cursor-pointer items-center justify-center rounded text-subtle hover:text-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </form>

        <details className="group relative">
          <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-border-strong bg-surface-raised px-3 text-sm font-medium text-foreground hover:bg-surface-hover [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal aria-hidden="true" className="size-4 text-subtle" />
            Filters
            {filtersChanged ? (
              <span className="rounded-full bg-accent-soft px-1.5 text-xs text-accent" data-testid="filters-modified">
                modified
              </span>
            ) : null}
            <ChevronDown aria-hidden="true" className="size-4 text-subtle transition-transform group-open:rotate-180" />
          </summary>
          <div className="absolute left-0 z-20 mt-2 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-4 rounded-xl border border-border-strong bg-surface-raised p-4 shadow-2xl">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-xs font-medium text-muted">Node kinds</legend>
              <div className="flex flex-wrap gap-1.5">
                {KIND_ORDER.map((k) => (
                  <FilterChip
                    key={k}
                    checked={kinds.has(k)}
                    onChange={() => toggle(kinds, k, setKinds)}
                    label={KIND_PLURAL[k]}
                    name="kind"
                    value={k}
                  />
                ))}
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-xs font-medium text-muted">Edge review status</legend>
              <div className="flex flex-wrap gap-1.5">
                {REVIEW_ORDER.map((r) => (
                  <FilterChip
                    key={r}
                    checked={reviews.has(r)}
                    onChange={() => toggle(reviews, r, setReviews)}
                    label={REVIEW_STATUS_DISPLAY[r].label}
                    name="review"
                    value={r}
                  />
                ))}
              </div>
            </fieldset>
            <p className="text-xs text-subtle">
              Filters change what is drawn. Impact is always computed on the full graph.
            </p>
          </div>
        </details>

        <Button variant="ghost" size="sm" onClick={resetAll}>
          <RotateCcw aria-hidden="true" />
          Reset view
        </Button>

        <p id="graph-search-status" aria-live="polite" className="ml-auto text-xs text-subtle">
          {query.trim()
            ? matches.size === 0
              ? "No matching nodes"
              : `${matches.size} matching ${matches.size === 1 ? "node" : "nodes"}. Press Enter to zoom${matches.size === 1 ? " and select" : ""}.`
            : `${visible.nodes.length} nodes · ${visible.edges.length} edges`}
        </p>
      </div>

      <p aria-live="polite" className="sr-only" data-testid="graph-announcer">
        {announcement}
      </p>

      <div
        id="graph-canvas"
        data-testid="graph-canvas"
        ref={canvasRef}
        className="relative scroll-mt-24 h-[min(64vh,580px)] min-h-[360px] overflow-hidden rounded-xl border border-border bg-background xl:h-[440px]"
      >
        {visible.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
            Every node kind is filtered out. Turn a kind back on to see the graph.
          </div>
        ) : (
          <ReactFlow<FsNode, FsEdge>
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onEdgeClick={(_e, edge) => setInspectedEdgeId(edge.id)}
            onPaneClick={() => {
              if (inspectedEdgeId) setInspectedEdgeId(null);
              else if (selectedId) select(null);
            }}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable
            elementsSelectable
            fitView
            fitViewOptions={{ padding: FIT_PADDING }}
            minZoom={0.15}
            onInit={(instance) => {
              // Deep link (?node=): frame the selected chain instead of the whole graph.
              if (!selection) return;
              const e = selection.emphasis;
              const ids = [...e.confirmedNodeIds, ...e.possibleNodeIds, ...e.upstreamNodeIds];
              void instance.fitView({ nodes: ids.map((id) => ({ id })), padding: FIT_PADDING });
            }}
            maxZoom={2}
            colorMode="dark"
            style={FLOW_THEME}
            proOptions={{ hideAttribution: true }}
            aria-label="Dependency graph canvas"
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#22304a" />
            <Controls
              showInteractive={false}
              fitViewOptions={{ padding: FIT_PADDING, duration: 300 }}
              position="bottom-left"
            />
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              ariaLabel="Graph overview minimap"
              bgColor="#0e1524"
              maskColor="rgb(9 14 24 / 0.65)"
              style={{ width: 150, height: 90 }}
              nodeColor={(n) => {
                const e = (n as FsNode).data.emphasis;
                return e === "selected" || e === "confirmed" ? "#b6ef5b" : e === "upstream" ? "#5fd4ee" : "#2c3b58";
              }}
              nodeStrokeWidth={0}
              className="!hidden md:!block"
            />
          </ReactFlow>
        )}

        {selection ? (
          <div
            data-testid="canvas-summary"
            className="pointer-events-none absolute left-3 top-3 max-w-[calc(100%-1.5rem)] rounded-lg border border-accent/40 bg-background/90 px-3 py-2 text-xs text-muted shadow-lg backdrop-blur sm:max-w-md"
          >
            <span className="font-semibold text-foreground">{nodeById.get(selection.nodeId)?.label}</span>
            {focusPathId ? (
              <span> · showing one exact path</span>
            ) : confirmedTargets.length ? (
              <span>
                {" "}
                · {confirmedTargets.length} confirmed downstream:{" "}
                <span className="text-accent">{confirmedTargets.map((t) => t.label).join(", ")}</span>
              </span>
            ) : (
              <span> · no confirmed downstream workflows</span>
            )}
          </div>
        ) : null}
        {inspectedEdge ? (
          <EdgeInspector
            edge={inspectedEdge}
            nodeById={nodeById}
            evidence={graph.evidence[inspectedEdge.evidenceId] ?? null}
            onClose={closeInspector}
          />
        ) : null}
        {hiddenSelection ? (
          <p className="absolute bottom-3 left-14 rounded-md border border-warning/40 bg-surface px-2.5 py-1.5 text-xs text-foreground">
            The selected node is hidden by the current filters.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <aside
          ref={panelRef}
          id="selection-details"
          aria-label="Selection details"
          className="min-w-0 scroll-mt-20 rounded-xl border border-border bg-surface"
        >
          <SelectionPanel
            selection={selection}
            focusPathId={focusPathId}
            vendorStatus={selectedId ? vendorByNode.get(selectedId) ?? null : null}
            evidence={selection ? graph.evidence[nodeById.get(selection.nodeId)!.evidenceId] ?? null : null}
            nodeById={nodeById}
            edgeById={edgeById}
            onFocusPath={(pathId) => select(selectedId, pathId)}
            onClear={() => select(null)}
          />
        </aside>
        <div className="rounded-xl border border-border bg-surface px-5 py-4">
          <GraphLegend />
        </div>
      </div>

      <PathList
        paths={allPaths}
        nodeById={nodeById}
        edgeById={edgeById}
        needsMapping={needsMapping}
        onShow={showPath}
        onInspectEdge={inspectEdge}
      />
    </div>
  );
}

function FilterChip({
  checked,
  onChange,
  label,
  name,
  value,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  name: string;
  value: string;
}) {
  return (
    <label
      className={cn(
        "relative flex h-8 cursor-pointer select-none items-center rounded-full border px-3 text-xs font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
        checked
          ? "border-accent/40 bg-accent-soft text-foreground"
          : "border-border-strong bg-transparent text-subtle line-through decoration-subtle/60",
      )}
    >
      <input type="checkbox" name={name} value={value} checked={checked} onChange={onChange} className="sr-only" />
      {label}
    </label>
  );
}

