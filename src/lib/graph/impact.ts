/**
 * Blast radius (blueprint Section 5): which workflows/outcomes a financial
 * condition at `startNodeId` could affect, and through which exact paths.
 *
 * - `confirmed`: CONFIRMED edges only. This is the only set that may count
 *   toward confirmed blast radius.
 * - `possible`: paths that need at least one SUGGESTED edge. Shown separately
 *   ("Possible impacts") and never counted as confirmed.
 * - Paths carry dependency strength; the weakest link describes the path. A
 *   reachable workflow is a *potential* impact, never a claim that it will fail.
 * Ordering is deterministic: end-node criticality, then path length, then path ID.
 */
import type { Criticality, DependencyStrength, GraphNode, NodeKind } from "@/lib/schema";
import {
  enumeratePaths,
  strongerStrength,
  type GraphInput,
  type GraphPath,
  type TraversalOptions,
} from "./traverse";

export const CRITICALITY_RANK: Readonly<Record<Criticality, number>> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  UNKNOWN: 4,
};

export type PotentialImpact = "POTENTIAL_INTERRUPTION" | "POTENTIAL_DEGRADATION" | "MINOR_DEPENDENCY";

const IMPACT_BY_STRENGTH: Readonly<Record<DependencyStrength, PotentialImpact>> = {
  HARD: "POTENTIAL_INTERRUPTION",
  DEGRADED: "POTENTIAL_DEGRADATION",
  OPTIONAL: "MINOR_DEPENDENCY",
};

export type ImpactPath = GraphPath & {
  endNodeKind: NodeKind;
  endNodeCriticality: Criticality;
  potentialImpact: PotentialImpact;
};

export type ImpactedNode = {
  nodeId: string;
  label: string;
  kind: NodeKind;
  criticality: Criticality;
  owner: string | null;
  /** Paths reaching this node, in the same order as the path list. */
  pathIds: string[];
  pathCount: number;
  shortestPathLength: number;
  /** Strongest weakest-link across paths: HARD if any path is all-HARD. */
  strongestDependency: DependencyStrength;
  potentialImpact: PotentialImpact;
};

export type ImpactSet = {
  paths: ImpactPath[];
  /** This set's own completeness: maxPaths/maxSteps hit (paths may be missing). */
  truncated: boolean;
  /** This set's own completeness: some branch stopped at maxDepth. */
  depthLimited: boolean;
  /** Deduplicated by node (T-10): one entry per workflow, with pathCount. */
  workflows: ImpactedNode[];
  outcomes: ImpactedNode[];
};

export type PossibleImpactSet = ImpactSet & {
  /** Union of SUGGESTED edge IDs that possible paths depend on. */
  unconfirmedEdgeIds: string[];
  /** Workflow/outcome IDs that appear ONLY as possible impacts (not confirmed). */
  onlyPossibleNodeIds: string[];
};

export type BlastRadius = {
  startNodeId: string;
  confirmed: ImpactSet;
  possible: PossibleImpactSet;
  /** confirmed.truncated || possible.truncated. */
  truncated: boolean;
  /** confirmed.depthLimited || possible.depthLimited. */
  depthLimited: boolean;
  danglingEdgeIds: string[];
};

function comparePaths(a: ImpactPath, b: ImpactPath): number {
  return (
    CRITICALITY_RANK[a.endNodeCriticality] - CRITICALITY_RANK[b.endNodeCriticality] ||
    a.length - b.length ||
    a.pathId.localeCompare(b.pathId)
  );
}

function toImpactPaths(paths: readonly GraphPath[], nodeById: ReadonlyMap<string, GraphNode>): ImpactPath[] {
  return paths
    .map((p) => {
      const end = nodeById.get(p.endNodeId)!;
      return {
        ...p,
        endNodeKind: end.kind,
        endNodeCriticality: end.criticality,
        potentialImpact: IMPACT_BY_STRENGTH[p.weakestStrength],
      };
    })
    .sort(comparePaths);
}

function aggregate(paths: readonly ImpactPath[], nodeById: ReadonlyMap<string, GraphNode>, kind: NodeKind): ImpactedNode[] {
  const byNode = new Map<string, ImpactPath[]>();
  for (const p of paths) {
    if (p.endNodeKind !== kind) continue;
    const list = byNode.get(p.endNodeId);
    if (list) list.push(p);
    else byNode.set(p.endNodeId, [p]);
  }
  return [...byNode.entries()]
    .map(([nodeId, ps]) => {
      const n = nodeById.get(nodeId)!;
      const strongest = ps.map((p) => p.weakestStrength).reduce(strongerStrength);
      return {
        nodeId,
        label: n.label,
        kind: n.kind,
        criticality: n.criticality,
        owner: n.owner,
        pathIds: ps.map((p) => p.pathId),
        pathCount: ps.length,
        shortestPathLength: Math.min(...ps.map((p) => p.length)),
        strongestDependency: strongest,
        potentialImpact: IMPACT_BY_STRENGTH[strongest],
      };
    })
    .sort(
      (a, b) =>
        CRITICALITY_RANK[a.criticality] - CRITICALITY_RANK[b.criticality] ||
        a.shortestPathLength - b.shortestPathLength ||
        a.nodeId.localeCompare(b.nodeId),
    );
}

function impactSet(
  paths: readonly ImpactPath[],
  nodeById: ReadonlyMap<string, GraphNode>,
  flags: { truncated: boolean; depthLimited: boolean },
): ImpactSet {
  return {
    paths: [...paths],
    truncated: flags.truncated,
    depthLimited: flags.depthLimited,
    workflows: aggregate(paths, nodeById, "WORKFLOW"),
    outcomes: aggregate(paths, nodeById, "OUTCOME"),
  };
}

export function computeBlastRadius(
  graph: GraphInput,
  startNodeId: string,
  options: Omit<TraversalOptions, "includeSuggested"> = {},
): BlastRadius {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const confirmedEnum = enumeratePaths(graph, startNodeId, { ...options, includeSuggested: false });
  const allEnum = enumeratePaths(graph, startNodeId, { ...options, includeSuggested: true });

  const confirmedPaths = toImpactPaths(confirmedEnum.paths, nodeById);
  const possiblePaths = toImpactPaths(
    allEnum.paths.filter((p) => !p.confirmed),
    nodeById,
  );
  const confirmed = impactSet(confirmedPaths, nodeById, confirmedEnum);
  // The possible set comes from the suggested-inclusive enumeration.
  const possibleBase = impactSet(possiblePaths, nodeById, allEnum);
  const confirmedNodeIds = new Set([...confirmed.workflows, ...confirmed.outcomes].map((n) => n.nodeId));

  return {
    startNodeId,
    confirmed,
    possible: {
      ...possibleBase,
      unconfirmedEdgeIds: [...new Set(possiblePaths.flatMap((p) => p.unconfirmedEdgeIds))].sort(),
      onlyPossibleNodeIds: [...possibleBase.workflows, ...possibleBase.outcomes]
        .map((n) => n.nodeId)
        .filter((id) => !confirmedNodeIds.has(id)),
    },
    truncated: confirmedEnum.truncated || allEnum.truncated,
    depthLimited: confirmedEnum.depthLimited || allEnum.depthLimited,
    danglingEdgeIds: confirmedEnum.danglingEdgeIds,
  };
}
