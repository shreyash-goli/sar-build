/**
 * Directed graph traversal over FS-02 Node/Edge records (pure, deterministic).
 *
 * Edges run in the impact direction (fund -> card -> vendor -> service ->
 * workflow -> outcome).
 * - REJECTED edges are never traversed.
 * - By default only edges whose review status `countsAsConfirmed` are used.
 *   `includeSuggested` additionally follows SUGGESTED edges (for the separate
 *   "possible impacts" view); such edges are reported as unconfirmed.
 * - Path enumeration uses a per-path visited set (simple paths only), so
 *   cycles terminate. Work is bounded three ways: nodes that cannot reach a
 *   terminal kind are pruned up front (reverse reachability over the same edge
 *   filter), path depth is capped (maxDepth), and total DFS steps are capped
 *   (maxSteps) as well as emitted paths (maxPaths); hitting a cap sets a flag.
 */
import { REVIEW_STATUS_DISPLAY } from "@/lib/provenance/display";
import type { DependencyStrength, GraphEdge, GraphNode, NodeKind } from "@/lib/schema";

export type GraphInput = { readonly nodes: readonly GraphNode[]; readonly edges: readonly GraphEdge[] };

export type TraversalOptions = {
  /** Also follow SUGGESTED edges (never REJECTED). Default false. */
  includeSuggested?: boolean;
  /** Maximum edges per path. Default 12. */
  maxDepth?: number;
  /** Stop enumerating after this many paths (sets `truncated`). Default 5000. */
  maxPaths?: number;
  /** Stop after this many DFS edge expansions (sets `truncated`). Default 50000. */
  maxSteps?: number;
  /** Node kinds that end a collected path. Default WORKFLOW and OUTCOME. */
  terminalKinds?: readonly NodeKind[];
};

export const DEFAULT_MAX_DEPTH = 12;
export const DEFAULT_MAX_PATHS = 5000;
export const DEFAULT_MAX_STEPS = 50_000;
export const DEFAULT_TERMINAL_KINDS: readonly NodeKind[] = ["WORKFLOW", "OUTCOME"];

/** Weakest-first ordering: a path is only as strong as its weakest dependency. */
const STRENGTH_RANK: Readonly<Record<DependencyStrength, number>> = { HARD: 2, DEGRADED: 1, OPTIONAL: 0 };

export function weakestStrength(strengths: readonly DependencyStrength[]): DependencyStrength {
  return strengths.reduce<DependencyStrength>((w, s) => (STRENGTH_RANK[s] < STRENGTH_RANK[w] ? s : w), "HARD");
}

export function strongerStrength(a: DependencyStrength, b: DependencyStrength): DependencyStrength {
  return STRENGTH_RANK[a] >= STRENGTH_RANK[b] ? a : b;
}

export type GraphPath = {
  /** Deterministic: "path:" + edge IDs joined by "|". */
  pathId: string;
  startNodeId: string;
  endNodeId: string;
  nodeIds: string[];
  edgeIds: string[];
  /** Evidence of each edge, aligned with edgeIds. */
  edgeEvidenceIds: string[];
  /** Node and edge evidence along the path, in path order, deduplicated. */
  evidenceIds: string[];
  /** Number of edges. */
  length: number;
  strengths: DependencyStrength[];
  weakestStrength: DependencyStrength;
  /** SUGGESTED (unreviewed) edges on this path; empty for confirmed paths. */
  unconfirmedEdgeIds: string[];
  confirmed: boolean;
};

export type PathEnumeration = {
  paths: GraphPath[];
  /** True when maxPaths or maxSteps was hit; results are then incomplete. */
  truncated: boolean;
  /** True when at least one branch stopped at maxDepth. */
  depthLimited: boolean;
  /**
   * Edges skipped because an endpoint node is missing. Includes dangling edges
   * of ANY review status (CONFIRMED, SUGGESTED or REJECTED), so data problems
   * are visible even when the edge would not have been traversed.
   */
  danglingEdgeIds: string[];
  /** DFS edge expansions performed (diagnostic). */
  steps: number;
};

export class GraphError extends Error {
  constructor(
    readonly code: "UNKNOWN_START_NODE",
    message: string,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

export function pathIdFor(edgeIds: readonly string[]): string {
  return `path:${edgeIds.join("|")}`;
}

function isFollowable(edge: GraphEdge, includeSuggested: boolean): boolean {
  const display = REVIEW_STATUS_DISPLAY[edge.reviewStatus];
  if (display.countsAsConfirmed) return true;
  return includeSuggested && edge.reviewStatus === "SUGGESTED";
}

export type Adjacency = {
  nodeById: ReadonlyMap<string, GraphNode>;
  /** Outgoing followable edges per node, sorted by edge id. */
  out: ReadonlyMap<string, readonly GraphEdge[]>;
  /** Incoming followable edges per node, sorted by edge id. */
  incoming: ReadonlyMap<string, readonly GraphEdge[]>;
  /** Dangling edges of any review status (checked before filtering). */
  danglingEdgeIds: string[];
};

export function buildAdjacency(graph: GraphInput, includeSuggested = false): Adjacency {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  const danglingEdgeIds: string[] = [];
  for (const e of [...graph.edges].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!nodeById.has(e.fromNodeId) || !nodeById.has(e.toNodeId)) {
      danglingEdgeIds.push(e.id);
      continue;
    }
    if (e.fromNodeId === e.toNodeId || !isFollowable(e, includeSuggested)) continue;
    const list = out.get(e.fromNodeId);
    if (list) list.push(e);
    else out.set(e.fromNodeId, [e]);
    const inList = incoming.get(e.toNodeId);
    if (inList) inList.push(e);
    else incoming.set(e.toNodeId, [e]);
  }
  return { nodeById, out, incoming, danglingEdgeIds };
}

/** Nodes that can reach (or are) a node of a terminal kind via followable edges. Reverse BFS. */
export function nodesReachingTerminal(adj: Adjacency, terminalKinds: ReadonlySet<NodeKind>): Set<string> {
  const result = new Set<string>();
  const queue: string[] = [];
  for (const node of adj.nodeById.values()) {
    if (terminalKinds.has(node.kind)) {
      result.add(node.id);
      queue.push(node.id);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    for (const e of adj.incoming.get(queue[i]!) ?? []) {
      if (!result.has(e.fromNodeId)) {
        result.add(e.fromNodeId);
        queue.push(e.fromNodeId);
      }
    }
  }
  return result;
}

export type Reachability = {
  /** Reachable node IDs (excluding start), sorted. */
  nodeIds: string[];
  /** True when traversal stopped at maxDepth with unexplored successors. */
  depthLimited: boolean;
};

/** Node IDs reachable from start (excluding start) via followable edges. BFS with a visited set. */
export function reachableNodeIds(graph: GraphInput, startNodeId: string, options: TraversalOptions = {}): Reachability {
  const { out, nodeById } = buildAdjacency(graph, options.includeSuggested ?? false);
  if (!nodeById.has(startNodeId)) throw new GraphError("UNKNOWN_START_NODE", `Node ${startNodeId} does not exist`);
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const visited = new Set<string>([startNodeId]);
  let frontier = [startNodeId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of out.get(id) ?? []) {
        if (!visited.has(e.toNodeId)) {
          visited.add(e.toNodeId);
          next.push(e.toNodeId);
        }
      }
    }
    frontier = next;
  }
  const depthLimited = frontier.some((id) => (out.get(id) ?? []).some((e) => !visited.has(e.toNodeId)));
  visited.delete(startNodeId);
  return { nodeIds: [...visited].sort(), depthLimited };
}

/**
 * Every simple path from `startNodeId` that ends at a terminal-kind node
 * (a path through a workflow to an outcome yields both). Unsorted; see impact.ts.
 */
export function enumeratePaths(graph: GraphInput, startNodeId: string, options: TraversalOptions = {}): PathEnumeration {
  const includeSuggested = options.includeSuggested ?? false;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxPaths = options.maxPaths ?? DEFAULT_MAX_PATHS;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const terminal = new Set(options.terminalKinds ?? DEFAULT_TERMINAL_KINDS);
  const adj = buildAdjacency(graph, includeSuggested);
  const { nodeById, out, danglingEdgeIds } = adj;
  if (!nodeById.has(startNodeId)) throw new GraphError("UNKNOWN_START_NODE", `Node ${startNodeId} does not exist`);
  // Prune: never descend into nodes from which no terminal is reachable.
  const useful = nodesReachingTerminal(adj, terminal);
  let steps = 0;

  const paths: GraphPath[] = [];
  let truncated = false;
  let depthLimited = false;
  const onPath = new Set<string>([startNodeId]);
  const nodeStack: string[] = [startNodeId];
  const edgeStack: GraphEdge[] = [];

  const emit = () => {
    const edgeIds = edgeStack.map((e) => e.id);
    const strengths = edgeStack.map((e) => e.dependencyStrength);
    const evidence: string[] = [nodeById.get(startNodeId)!.evidenceId];
    for (const e of edgeStack) evidence.push(e.evidenceId, nodeById.get(e.toNodeId)!.evidenceId);
    const unconfirmedEdgeIds = edgeStack.filter((e) => !REVIEW_STATUS_DISPLAY[e.reviewStatus].countsAsConfirmed).map((e) => e.id);
    paths.push({
      pathId: pathIdFor(edgeIds),
      startNodeId,
      endNodeId: nodeStack[nodeStack.length - 1]!,
      nodeIds: [...nodeStack],
      edgeIds,
      edgeEvidenceIds: edgeStack.map((e) => e.evidenceId),
      evidenceIds: [...new Set(evidence)],
      length: edgeStack.length,
      strengths,
      weakestStrength: weakestStrength(strengths),
      unconfirmedEdgeIds,
      confirmed: unconfirmedEdgeIds.length === 0,
    });
  };

  const visit = (nodeId: string) => {
    if (truncated) return;
    for (const e of out.get(nodeId) ?? []) {
      if (onPath.has(e.toNodeId) || !useful.has(e.toNodeId)) continue; // cycle guard + pruning
      if (steps >= maxSteps) {
        truncated = true;
        return;
      }
      steps += 1;
      if (edgeStack.length >= maxDepth) {
        depthLimited = true;
        return;
      }
      onPath.add(e.toNodeId);
      nodeStack.push(e.toNodeId);
      edgeStack.push(e);
      if (terminal.has(nodeById.get(e.toNodeId)!.kind)) {
        if (paths.length >= maxPaths) truncated = true;
        else emit();
      }
      visit(e.toNodeId);
      edgeStack.pop();
      nodeStack.pop();
      onPath.delete(e.toNodeId);
      if (truncated) return;
    }
  };
  visit(startNodeId);

  return { paths, truncated, depthLimited, danglingEdgeIds, steps };
}
