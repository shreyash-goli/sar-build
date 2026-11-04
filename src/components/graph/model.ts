/**
 * Pure, deterministic view-model for the dependency graph (FS-07).
 * No React, no DOM: unit-testable and identical on server and client.
 *
 * - Layout: one column per NodeKind in impact order, rows ordered by the mean
 *   row of upstream neighbours (a single barycentre pass) to reduce crossings.
 * - "Needs mapping" comes from the server (GraphShape.vendors[].needsMapping,
 *   computed from canonical vendor/charge/edge data). Here it only seeds the
 *   "unknown lineage" styling; it is a data-completeness fact, not a risk score.
 * - Highlighting uses the shared FS-06 algorithms (computeBlastRadius).
 */
import { CRITICALITY_RANK, computeBlastRadius, enumeratePaths, type BlastRadius, type GraphPath } from "@/lib/graph";
import type { GraphEdge, GraphNode, NodeKind, ReviewStatus } from "@/lib/schema";

export const KIND_ORDER: readonly NodeKind[] = ["FUND", "CARD", "VENDOR", "SERVICE", "WORKFLOW", "OUTCOME"];

export const KIND_LABEL: Readonly<Record<NodeKind, string>> = {
  FUND: "Fund",
  CARD: "Card",
  VENDOR: "Vendor",
  SERVICE: "Service",
  WORKFLOW: "Workflow",
  OUTCOME: "Outcome",
};

export const KIND_PLURAL: Readonly<Record<NodeKind, string>> = {
  FUND: "Funds",
  CARD: "Cards",
  VENDOR: "Vendors",
  SERVICE: "Services",
  WORKFLOW: "Workflows",
  OUTCOME: "Outcomes",
};

export const NODE_WIDTH = 164;
export const NODE_HEIGHT = 76;
/** Column gap (step - width) leaves room for relation labels on highlighted edges. */
export const COLUMN_STEP = 256;
export const ROW_STEP = 108;

export type Position = { x: number; y: number };

/** The nodes/edges part of the server GraphShape (what layout and traversal need). */
export type GraphShape = { nodes: GraphNode[]; edges: GraphEdge[] };

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

/** Deterministic layered layout. Same input -> same coordinates. */
export function computeLayout({ nodes, edges }: GraphShape): Map<string, Position> {
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  const col = (kind: NodeKind) => KIND_ORDER.indexOf(kind);
  const preds = new Map<string, string[]>();
  for (const e of [...edges].sort(byId)) {
    if (e.reviewStatus === "REJECTED") continue;
    const fromKind = kindOf.get(e.fromNodeId);
    const toKind = kindOf.get(e.toNodeId);
    if (!fromKind || !toKind || col(fromKind) >= col(toKind)) continue;
    const list = preds.get(e.toNodeId);
    if (list) list.push(e.fromNodeId);
    else preds.set(e.toNodeId, [e.fromNodeId]);
  }

  const positions = new Map<string, Position>();
  for (const kind of KIND_ORDER) {
    const column = nodes
      .filter((n) => n.kind === kind)
      .map((n) => {
        const ys = (preds.get(n.id) ?? [])
          .map((p) => positions.get(p)?.y)
          .filter((y): y is number => y !== undefined);
        const desired = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Number.POSITIVE_INFINITY;
        return { node: n, desired };
      })
      .sort(
        (a, b) =>
          a.desired - b.desired ||
          CRITICALITY_RANK[a.node.criticality] - CRITICALITY_RANK[b.node.criticality] ||
          a.node.id.localeCompare(b.node.id),
      );

    let prev = Number.NEGATIVE_INFINITY;
    for (const { node, desired } of column) {
      const floor = prev === Number.NEGATIVE_INFINITY ? 0 : prev + ROW_STEP;
      const y = Number.isFinite(desired) ? Math.max(desired, floor) : floor;
      positions.set(node.id, { x: col(kind) * COLUMN_STEP, y });
      prev = y;
    }
  }
  return positions;
}

/** Vendors with no non-rejected incoming PAYS edge (structural roots for the path list). */
export function unpaidVendorIds({ nodes, edges }: GraphShape): Set<string> {
  const funded = new Set(
    edges.filter((e) => e.relation === "PAYS" && e.reviewStatus !== "REJECTED").map((e) => e.toNodeId),
  );
  return new Set(nodes.filter((n) => n.kind === "VENDOR" && !funded.has(n.id)).map((n) => n.id));
}

/**
 * Nodes/edges reachable from a needs-mapping vendor but not from any FUND via
 * non-rejected edges: their funding lineage is unknown. Rendered as "unknown".
 */
export function unknownLineage(
  graph: GraphShape,
  needsMappingVendorIds: ReadonlySet<string>,
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const out = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (e.reviewStatus === "REJECTED") continue;
    const list = out.get(e.fromNodeId);
    if (list) list.push(e);
    else out.set(e.fromNodeId, [e]);
  }
  const reach = (starts: string[]) => {
    const nodes = new Set(starts);
    const edges = new Set<string>();
    const queue = [...starts];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of out.get(id) ?? []) {
        edges.add(e.id);
        if (!nodes.has(e.toNodeId)) {
          nodes.add(e.toNodeId);
          queue.push(e.toNodeId);
        }
      }
    }
    return { nodes, edges };
  };
  const funded = reach(graph.nodes.filter((n) => n.kind === "FUND").map((n) => n.id));
  const unknown = reach([...needsMappingVendorIds]);
  return {
    nodeIds: new Set([...unknown.nodes].filter((id) => !funded.nodes.has(id))),
    edgeIds: new Set([...unknown.edges].filter((id) => !funded.edges.has(id))),
  };
}

/** Confirmed (non-rejected, CONFIRMED) upstream chain feeding a node, for context. */
export function upstreamConfirmed(graph: GraphShape, nodeId: string): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const incoming = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (e.reviewStatus !== "CONFIRMED") continue;
    const list = incoming.get(e.toNodeId);
    if (list) list.push(e);
    else incoming.set(e.toNodeId, [e]);
  }
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const queue = [nodeId];
  const seen = new Set([nodeId]);
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of incoming.get(id) ?? []) {
      edgeIds.add(e.id);
      if (!seen.has(e.fromNodeId)) {
        seen.add(e.fromNodeId);
        nodeIds.add(e.fromNodeId);
        queue.push(e.fromNodeId);
      }
    }
  }
  return { nodeIds, edgeIds };
}

export type Emphasis = {
  /** Downstream nodes/edges on confirmed paths (counts toward blast radius). */
  confirmedNodeIds: Set<string>;
  confirmedEdgeIds: Set<string>;
  /** Nodes/edges reachable only through SUGGESTED edges (never counted). */
  possibleNodeIds: Set<string>;
  possibleEdgeIds: Set<string>;
  /** Confirmed upstream funding chain of the selection (context). */
  upstreamNodeIds: Set<string>;
  upstreamEdgeIds: Set<string>;
};

export type Selection = {
  nodeId: string;
  blast: BlastRadius;
  emphasis: Emphasis;
};

/** Selection model for a clicked node, optionally narrowed to one exact path. */
export function selectNode(graph: GraphShape, nodeId: string, focusPathId: string | null = null): Selection {
  const blast = computeBlastRadius(graph, nodeId);
  const confirmedPaths = blast.confirmed.paths;
  const possiblePaths = blast.possible.paths;
  const focus = focusPathId
    ? [...confirmedPaths, ...possiblePaths].find((p) => p.pathId === focusPathId) ?? null
    : null;

  const collect = (paths: readonly GraphPath[]) => ({
    nodes: new Set(paths.flatMap((p) => p.nodeIds)),
    edges: new Set(paths.flatMap((p) => p.edgeIds)),
  });

  const confirmed = collect(focus ? (focus.confirmed ? [focus] : []) : confirmedPaths);
  const possible = collect(focus ? (focus.confirmed ? [] : [focus]) : possiblePaths);
  // A node on both confirmed and possible paths is shown as confirmed.
  for (const id of confirmed.nodes) possible.nodes.delete(id);
  for (const id of confirmed.edges) possible.edges.delete(id);
  confirmed.nodes.add(nodeId);

  const up = upstreamConfirmed(graph, nodeId);
  return {
    nodeId,
    blast,
    emphasis: {
      confirmedNodeIds: confirmed.nodes,
      confirmedEdgeIds: confirmed.edges,
      possibleNodeIds: possible.nodes,
      possibleEdgeIds: possible.edges,
      upstreamNodeIds: up.nodeIds,
      upstreamEdgeIds: up.edgeIds,
    },
  };
}

export type Filters = {
  kinds: ReadonlySet<NodeKind>;
  reviewStatuses: ReadonlySet<ReviewStatus>;
};

export const DEFAULT_REVIEW_FILTER: readonly ReviewStatus[] = ["CONFIRMED", "SUGGESTED"];

/** Apply kind/review-status filters. Edges to hidden nodes are hidden too. */
export function applyFilters(graph: GraphShape, filters: Filters): GraphShape {
  const nodes = graph.nodes.filter((n) => filters.kinds.has(n.kind));
  const visible = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter(
    (e) => filters.reviewStatuses.has(e.reviewStatus) && visible.has(e.fromNodeId) && visible.has(e.toNodeId),
  );
  return { nodes, edges };
}

/** Case-insensitive label/owner/id search. Empty query matches nothing. */
export function searchNodes(nodes: readonly GraphNode[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return nodes
    .filter((n) => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q) || (n.owner ?? "").toLowerCase().includes(q))
    .map((n) => n.id);
}

export type ListedPath = GraphPath & { rootKind: NodeKind };

/**
 * Every end-to-end path from each root (a FUND, or a vendor nothing pays), for the
 * text alternative. Includes SUGGESTED edges, flagged as unconfirmed.
 */
export function listAllPaths(graph: GraphShape): ListedPath[] {
  const unfunded = unpaidVendorIds(graph);
  const roots = graph.nodes
    .filter((n) => n.kind === "FUND" || unfunded.has(n.id))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id));
  const all: ListedPath[] = [];
  for (const root of roots) {
    const { paths } = enumeratePaths(graph, root.id, { includeSuggested: true, terminalKinds: ["OUTCOME", "WORKFLOW"] });
    // Keep only maximal paths: drop a path that is a strict prefix of another.
    const maximal = paths.filter(
      (p) => !paths.some((q) => q !== p && q.edgeIds.length > p.edgeIds.length && p.edgeIds.every((id, i) => q.edgeIds[i] === id)),
    );
    for (const p of maximal.sort((a, b) => a.pathId.localeCompare(b.pathId))) all.push({ ...p, rootKind: root.kind });
  }
  return all;
}
