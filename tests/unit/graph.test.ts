import { describe, expect, it } from "vitest";
import { loadNorthstarFixture } from "@/fixtures/northstar";
import {
  GraphError,
  computeBlastRadius,
  enumeratePaths,
  pathIdFor,
  reachableNodeIds,
  type GraphInput,
} from "@/lib/graph";
import type { Criticality, DependencyStrength, GraphEdge, GraphNode, NodeKind, ReviewStatus } from "@/lib/schema";

const n = (id: string, kind: NodeKind, criticality: Criticality = "HIGH"): GraphNode => ({
  id,
  kind,
  label: id,
  criticality,
  owner: null,
  evidenceId: `ev-${id}`,
});
const e = (
  from: string,
  to: string,
  opts: { status?: ReviewStatus; strength?: DependencyStrength; id?: string } = {},
): GraphEdge => ({
  id: opts.id ?? `${from}>${to}`,
  fromNodeId: from,
  toNodeId: to,
  relation: "REQUIRES",
  dependencyStrength: opts.strength ?? "HARD",
  confidenceTier: "HIGH",
  reviewStatus: opts.status ?? "CONFIRMED",
  evidenceId: `ev-${from}>${to}`,
});

describe("linear graph", () => {
  const g: GraphInput = {
    nodes: [n("f", "FUND"), n("c", "CARD"), n("v", "VENDOR"), n("s", "SERVICE"), n("w", "WORKFLOW", "CRITICAL"), n("o", "OUTCOME")],
    edges: [e("f", "c"), e("c", "v"), e("v", "s"), e("s", "w"), e("w", "o", { strength: "DEGRADED" })],
  };

  it("collects paths ending at workflows and outcomes with node, edge and evidence IDs", () => {
    const br = computeBlastRadius(g, "f");
    expect(br.confirmed.paths.map((p) => p.endNodeId)).toEqual(["w", "o"]);
    const [toW, toO] = br.confirmed.paths;
    expect(toW).toMatchObject({
      pathId: "path:f>c|c>v|v>s|s>w",
      nodeIds: ["f", "c", "v", "s", "w"],
      edgeIds: ["f>c", "c>v", "v>s", "s>w"],
      edgeEvidenceIds: ["ev-f>c", "ev-c>v", "ev-v>s", "ev-s>w"],
      length: 4,
      weakestStrength: "HARD",
      potentialImpact: "POTENTIAL_INTERRUPTION",
      confirmed: true,
      unconfirmedEdgeIds: [],
    });
    expect(toW!.evidenceIds).toEqual(["ev-f", "ev-f>c", "ev-c", "ev-c>v", "ev-v", "ev-v>s", "ev-s", "ev-s>w", "ev-w"]);
    expect(toO).toMatchObject({ length: 5, weakestStrength: "DEGRADED", potentialImpact: "POTENTIAL_DEGRADATION" });
    expect(pathIdFor(toO!.edgeIds)).toBe(toO!.pathId);
    expect(br.confirmed.workflows.map((w) => w.nodeId)).toEqual(["w"]);
    expect(br.confirmed.outcomes.map((w) => w.nodeId)).toEqual(["o"]);
  });

  it("a start node with no outgoing edges yields no impact", () => {
    const br = computeBlastRadius(g, "o");
    expect(br.confirmed.paths).toEqual([]);
    expect(br.possible.paths).toEqual([]);
  });

  it("unknown start node throws a typed error", () => {
    expect(() => computeBlastRadius(g, "nope")).toThrow(GraphError);
  });
});

describe("branching graph and ordering", () => {
  const g: GraphInput = {
    nodes: [
      n("f", "FUND"),
      n("s1", "SERVICE"),
      n("s2", "SERVICE"),
      n("wLow", "WORKFLOW", "LOW"),
      n("wCrit", "WORKFLOW", "CRITICAL"),
      n("wHigh", "WORKFLOW", "HIGH"),
    ],
    edges: [e("f", "s1"), e("f", "s2"), e("s1", "wLow"), e("s2", "wHigh"), e("s1", "s2"), e("s2", "wCrit", { strength: "OPTIONAL" })],
  };

  it("sorts by end criticality, then length, then path ID", () => {
    const br = computeBlastRadius(g, "f");
    expect(br.confirmed.paths.map((p) => p.pathId)).toEqual([
      "path:f>s2|s2>wCrit",
      "path:f>s1|s1>s2|s2>wCrit",
      "path:f>s2|s2>wHigh",
      "path:f>s1|s1>s2|s2>wHigh",
      "path:f>s1|s1>wLow",
    ]);
    expect(br.confirmed.workflows.map((w) => w.nodeId)).toEqual(["wCrit", "wHigh", "wLow"]);
    expect(br.confirmed.workflows[0]).toMatchObject({ potentialImpact: "MINOR_DEPENDENCY", strongestDependency: "OPTIONAL" });
  });

  it("is deterministic regardless of input order", () => {
    const shuffled: GraphInput = { nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() };
    expect(computeBlastRadius(shuffled, "f")).toEqual(computeBlastRadius(g, "f"));
  });
});

describe("T-10: multiple paths to the same workflow", () => {
  const g: GraphInput = {
    nodes: [n("f", "FUND"), n("a", "SERVICE"), n("b", "SERVICE"), n("w", "WORKFLOW", "CRITICAL")],
    edges: [e("f", "a"), e("f", "b", { strength: "DEGRADED" }), e("a", "w", { strength: "DEGRADED" }), e("b", "w")],
  };
  it("one workflow entry with a separate path count", () => {
    const br = computeBlastRadius(g, "f");
    expect(br.confirmed.paths).toHaveLength(2);
    expect(br.confirmed.workflows).toHaveLength(1);
    expect(br.confirmed.workflows[0]).toMatchObject({
      nodeId: "w",
      pathCount: 2,
      pathIds: ["path:f>a|a>w", "path:f>b|b>w"],
      shortestPathLength: 2,
      strongestDependency: "DEGRADED",
    });
  });
  it("the strongest path wins when one path is all HARD", () => {
    const hard = { ...g, edges: [e("f", "a"), e("a", "w"), e("f", "b", { strength: "OPTIONAL" }), e("b", "w")] };
    expect(computeBlastRadius(hard, "f").confirmed.workflows[0]).toMatchObject({ strongestDependency: "HARD", potentialImpact: "POTENTIAL_INTERRUPTION" });
  });
});

describe("T-09: cycles terminate with stable, deduplicated paths", () => {
  const g: GraphInput = {
    nodes: [n("f", "FUND"), n("a", "SERVICE"), n("b", "SERVICE"), n("w", "WORKFLOW")],
    edges: [e("f", "a"), e("a", "b"), e("b", "a"), e("b", "w"), e("w", "f")],
  };
  it("terminates and returns each simple path once", () => {
    const br = computeBlastRadius(g, "f");
    expect(br.confirmed.paths.map((p) => p.pathId)).toEqual(["path:f>a|a>b|b>w"]);
    expect(new Set(br.confirmed.paths.map((p) => p.pathId)).size).toBe(br.confirmed.paths.length);
    expect(reachableNodeIds(g, "f").nodeIds).toEqual(["a", "b", "w"]);
    expect(computeBlastRadius(g, "f")).toEqual(br);
  });
  it("bounds depth and path count on dense cyclic graphs", () => {
    const ids = Array.from({ length: 9 }, (_, i) => `x${i}`);
    const dense: GraphInput = {
      nodes: [n("f", "FUND"), ...ids.map((id) => n(id, "WORKFLOW"))],
      edges: [...ids.map((id) => e("f", id)), ...ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => e(a, b)))],
    };
    const limited = enumeratePaths(dense, "f", { maxDepth: 3 });
    expect(limited.depthLimited).toBe(true);
    expect(Math.max(...limited.paths.map((p) => p.length))).toBeLessThanOrEqual(3);
    const capped = enumeratePaths(dense, "f", { maxPaths: 50 });
    expect(capped.truncated).toBe(true);
    expect(capped.paths).toHaveLength(50);
  });
});

describe("work bounds (QA: unbounded DFS without terminals)", () => {
  const mesh = (layers: number, width: number, terminal: boolean): GraphInput => {
    const ids = (l: number) => Array.from({ length: width }, (_, i) => `L${l}N${i}`);
    const nodes = [n("f", "FUND"), ...Array.from({ length: layers }, (_, l) => ids(l).map((id) => n(id, "SERVICE"))).flat()];
    const edges = [...ids(0).map((id) => e("f", id))];
    for (let l = 0; l + 1 < layers; l++) for (const a of ids(l)) for (const b of ids(l + 1)) edges.push(e(a, b));
    if (terminal) {
      nodes.push(n("w", "WORKFLOW"));
      for (const a of ids(layers - 1)) edges.push(e(a, "w"));
    }
    return { nodes, edges };
  };

  it("a dense mesh with no terminal nodes is pruned: fast, empty, no flags", () => {
    const g = mesh(11, 5, false);
    const t0 = Date.now();
    const res = enumeratePaths(g, "f");
    expect(Date.now() - t0).toBeLessThan(200);
    expect(res).toMatchObject({ paths: [], truncated: false, depthLimited: false, steps: 0 });
    const br = computeBlastRadius(g, "f");
    expect(br.confirmed).toMatchObject({ paths: [], truncated: false, depthLimited: false });
  });

  it("hitting the step budget sets truncated (and stays fast)", () => {
    const g = mesh(11, 5, true); // 5^11 paths to w: far beyond any budget
    const t0 = Date.now();
    const res = enumeratePaths(g, "f", { maxSteps: 2000, maxPaths: 1_000_000 });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(res.truncated).toBe(true);
    expect(res.steps).toBe(2000);
    const def = enumeratePaths(g, "f", { maxPaths: 1_000_000 });
    expect(def.truncated).toBe(true);
    expect(def.steps).toBe(50_000);
  });

  it("pruning does not drop real paths", () => {
    const g: GraphInput = {
      nodes: [n("f", "FUND"), n("dead", "SERVICE"), n("dead2", "SERVICE"), n("s", "SERVICE"), n("w", "WORKFLOW")],
      edges: [e("f", "dead"), e("dead", "dead2"), e("dead2", "dead"), e("f", "s"), e("s", "w")],
    };
    const res = enumeratePaths(g, "f");
    expect(res.paths.map((p) => p.pathId)).toEqual(["path:f>s|s>w"]);
    expect(res.steps).toBe(2);
  });

  it("reachableNodeIds reports depthLimited on a 20-node chain", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `c${i}`);
    const g: GraphInput = { nodes: ids.map((id) => n(id, "SERVICE")), edges: ids.slice(1).map((id, i) => e(ids[i]!, id)) };
    const limited = reachableNodeIds(g, "c0");
    expect(limited.depthLimited).toBe(true);
    expect(limited.nodeIds).toHaveLength(12);
    const full = reachableNodeIds(g, "c0", { maxDepth: 19 });
    expect(full).toEqual({ nodeIds: ids.slice(1).sort(), depthLimited: false });
  });

  it("confirmed and possible sets carry their own completeness flags", () => {
    const ids = Array.from({ length: 15 }, (_, i) => `c${i}`);
    const g: GraphInput = {
      nodes: [n("f", "FUND"), n("w", "WORKFLOW"), ...ids.map((id) => n(id, "SERVICE")), n("wFar", "WORKFLOW")],
      edges: [
        e("f", "w"),
        e("f", "c0", { status: "SUGGESTED" }),
        ...ids.slice(1).map((id, i) => e(ids[i]!, id)),
        e("c14", "wFar"),
      ],
    };
    const br = computeBlastRadius(g, "f");
    expect(br.confirmed).toMatchObject({ truncated: false, depthLimited: false });
    expect(br.confirmed.workflows.map((w) => w.nodeId)).toEqual(["w"]);
    expect(br.possible.depthLimited).toBe(true);
    expect(br.depthLimited).toBe(true);
  });
});

describe("orphans and dangling edges", () => {
  it("orphan nodes are unreachable; edges to missing nodes are reported, not traversed", () => {
    const g: GraphInput = {
      nodes: [n("f", "FUND"), n("w", "WORKFLOW"), n("orphan", "WORKFLOW")],
      edges: [e("f", "w"), e("f", "ghost")],
    };
    const br = computeBlastRadius(g, "f");
    expect(br.confirmed.workflows.map((w) => w.nodeId)).toEqual(["w"]);
    expect(br.danglingEdgeIds).toEqual(["f>ghost"]);
    expect(computeBlastRadius(g, "orphan").confirmed.paths).toEqual([]);
  });

  it("danglingEdgeIds includes dangling SUGGESTED and REJECTED edges too", () => {
    const g: GraphInput = {
      nodes: [n("f", "FUND"), n("w", "WORKFLOW")],
      edges: [e("f", "w"), e("f", "ghost-s", { status: "SUGGESTED" }), e("ghost-r", "w", { status: "REJECTED" })],
    };
    expect(computeBlastRadius(g, "f").danglingEdgeIds).toEqual(["f>ghost-s", "ghost-r>w"]);
  });
});

describe("T-07 / T-08: suggested and rejected edges", () => {
  const g: GraphInput = {
    nodes: [n("f", "FUND"), n("s", "SERVICE"), n("wConf", "WORKFLOW"), n("wSug", "WORKFLOW", "CRITICAL"), n("wRej", "WORKFLOW", "CRITICAL")],
    edges: [e("f", "s"), e("s", "wConf"), e("s", "wSug", { status: "SUGGESTED" }), e("s", "wRej", { status: "REJECTED" }), e("wConf", "wSug", { status: "SUGGESTED" })],
  };

  it("suggested edges are absent from the confirmed blast radius", () => {
    const br = computeBlastRadius(g, "f");
    expect(br.confirmed.workflows.map((w) => w.nodeId)).toEqual(["wConf"]);
    expect(br.confirmed.paths.every((p) => p.confirmed && p.unconfirmedEdgeIds.length === 0)).toBe(true);
    expect(reachableNodeIds(g, "f").nodeIds).toEqual(["s", "wConf"]);
  });

  it("suggested paths appear only in possible impacts, with unconfirmed edges marked", () => {
    const br = computeBlastRadius(g, "f");
    expect(br.possible.paths.map((p) => p.pathId)).toEqual(["path:f>s|s>wSug", "path:f>s|s>wConf|wConf>wSug"]);
    expect(br.possible.paths.every((p) => !p.confirmed)).toBe(true);
    expect(br.possible.paths[1]!.unconfirmedEdgeIds).toEqual(["wConf>wSug"]);
    expect(br.possible.unconfirmedEdgeIds).toEqual(["s>wSug", "wConf>wSug"]);
    expect(br.possible.onlyPossibleNodeIds).toEqual(["wSug"]);
    expect(br.possible.workflows[0]).toMatchObject({ nodeId: "wSug", pathCount: 2 });
  });

  it("rejected edges are never traversed, even for possible impacts", () => {
    const br = computeBlastRadius(g, "f");
    const all = [...br.confirmed.paths, ...br.possible.paths];
    expect(all.some((p) => p.edgeIds.includes("s>wRej"))).toBe(false);
    expect(all.some((p) => p.endNodeId === "wRej")).toBe(false);
    expect(reachableNodeIds(g, "f", { includeSuggested: true }).nodeIds).toEqual(["s", "wConf", "wSug"]);
  });
});

describe("Northstar fixture", () => {
  const fx = loadNorthstarFixture();
  const graph: GraphInput = { nodes: fx.nodes, edges: fx.edges };

  it("fund-auth reaches Account login and Customer checkout with precise path IDs", () => {
    const br = computeBlastRadius(graph, "node-fund-auth");
    expect(br.confirmed.paths.map((p) => p.pathId)).toEqual([
      "path:edge-fund-auth--card-auth|edge-card-auth--vendor-cloudcomms|edge-vendor-cloudcomms--service-otp-gateway|edge-service-otp-gateway--workflow-account-login",
      "path:edge-fund-auth--card-auth|edge-card-auth--vendor-cloudcomms|edge-vendor-cloudcomms--service-otp-gateway|edge-service-otp-gateway--workflow-account-login|edge-workflow-account-login--outcome-customer-checkout",
    ]);
    const [login, checkout] = br.confirmed.paths;
    expect(login).toMatchObject({ endNodeId: "node-workflow-account-login", length: 4, weakestStrength: "HARD", potentialImpact: "POTENTIAL_INTERRUPTION" });
    expect(checkout).toMatchObject({ endNodeId: "node-outcome-customer-checkout", length: 5, weakestStrength: "DEGRADED", potentialImpact: "POTENTIAL_DEGRADATION" });
    expect(checkout!.nodeIds).toEqual([
      "node-fund-auth",
      "node-card-auth",
      "node-vendor-cloudcomms",
      "node-service-otp-gateway",
      "node-workflow-account-login",
      "node-outcome-customer-checkout",
    ]);
    expect(checkout!.edgeEvidenceIds).toEqual(checkout!.edgeIds.map((id) => `ev-${id}`));
    expect(br.confirmed.workflows).toHaveLength(1);
    expect(br.confirmed.workflows[0]).toMatchObject({ nodeId: "node-workflow-account-login", criticality: "CRITICAL", pathCount: 1, owner: "Identity Platform" });
    expect(br.confirmed.outcomes.map((o) => o.nodeId)).toEqual(["node-outcome-customer-checkout"]);
    expect(br.possible.paths).toEqual([]);
    // The healthy ComputeHarbor path into login is not part of fund-auth's blast radius.
    expect(br.confirmed.paths.some((p) => p.nodeIds.includes("node-service-app-hosting"))).toBe(false);
  });

  it("every fixture path cites existing evidence", () => {
    const ev = new Set(fx.evidence.map((x) => x.id));
    for (const start of fx.nodes.filter((x) => x.kind === "FUND" || x.kind === "VENDOR")) {
      const br = computeBlastRadius(graph, start.id);
      for (const p of [...br.confirmed.paths, ...br.possible.paths]) for (const id of p.evidenceIds) expect(ev.has(id), id).toBe(true);
    }
  });

  it("WebhookWorks reaches On-call escalation", () => {
    const br = computeBlastRadius(graph, "node-vendor-webhookworks");
    expect(br.confirmed.workflows.map((w) => w.nodeId)).toEqual(["node-workflow-oncall-escalation"]);
    expect(br.confirmed.paths[0]!.pathId).toBe(
      "path:edge-vendor-webhookworks--service-incident-monitoring|edge-service-incident-monitoring--workflow-oncall-escalation",
    );
    expect(computeBlastRadius(graph, "node-fund-monitoring").confirmed.workflows.map((w) => w.nodeId)).toEqual([
      "node-workflow-oncall-escalation",
    ]);
  });

  it("MetricsRelay's weekly growth reporting appears only in possible impacts", () => {
    const br = computeBlastRadius(graph, "node-vendor-metricsrelay");
    expect(br.confirmed.workflows).toEqual([]);
    expect(br.confirmed.paths).toEqual([]);
    expect(br.possible.workflows.map((w) => w.nodeId)).toEqual(["node-workflow-growth-reporting"]);
    expect(br.possible.onlyPossibleNodeIds).toEqual(["node-workflow-growth-reporting"]);
    expect(br.possible.unconfirmedEdgeIds).toEqual(["edge-service-product-analytics--workflow-growth-reporting"]);
    expect(br.possible.paths[0]).toMatchObject({ confirmed: false, weakestStrength: "DEGRADED" });
  });

  it("fund-infra (healthy ComputeHarbor) also reaches login and checkout via app hosting", () => {
    const br = computeBlastRadius(graph, "node-fund-infra");
    expect(br.confirmed.workflows.map((w) => w.nodeId)).toEqual(["node-workflow-account-login"]);
    expect(br.confirmed.paths[0]!.nodeIds).toContain("node-service-app-hosting");
  });
});
