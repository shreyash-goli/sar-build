import { describe, expect, it } from "vitest";

import {
  COLUMN_STEP,
  DEFAULT_REVIEW_FILTER,
  KIND_ORDER,
  ROW_STEP,
  applyFilters,
  computeLayout,
  listAllPaths,
  searchNodes,
  selectNode,
  unknownLineage,
  unpaidVendorIds,
  type GraphShape,
} from "@/components/graph/model";
import { loadNorthstarFixture } from "@/fixtures/northstar";
import type { GraphEdge, GraphNode, NodeKind, ReviewStatus } from "@/lib/schema";

const fixture = loadNorthstarFixture();
const demo: GraphShape = { nodes: fixture.nodes, edges: fixture.edges };
const METRICS = "node-vendor-metricsrelay";

const n = (id: string, kind: NodeKind): GraphNode => ({
  id,
  kind,
  label: id,
  criticality: "MEDIUM",
  owner: null,
  evidenceId: `ev-${id}`,
});
const e = (from: string, to: string, reviewStatus: ReviewStatus = "CONFIRMED"): GraphEdge => ({
  id: `edge-${from}--${to}`,
  fromNodeId: from,
  toNodeId: to,
  relation: "PAYS",
  dependencyStrength: "HARD",
  confidenceTier: "HIGH",
  reviewStatus,
  evidenceId: `ev-edge-${from}--${to}`,
});

describe("computeLayout", () => {
  it("is deterministic and independent of input order", () => {
    const a = computeLayout(demo);
    const b = computeLayout({ nodes: [...demo.nodes].reverse(), edges: [...demo.edges].reverse() });
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it("places each kind in its own column in impact order", () => {
    const pos = computeLayout(demo);
    for (const node of demo.nodes) {
      expect(pos.get(node.id)!.x).toBe(KIND_ORDER.indexOf(node.kind) * COLUMN_STEP);
    }
  });

  it("never overlaps nodes within a column", () => {
    const pos = computeLayout(demo);
    for (const kind of KIND_ORDER) {
      const ys = demo.nodes
        .filter((node) => node.kind === kind)
        .map((node) => pos.get(node.id)!.y)
        .sort((x, y) => x - y);
      for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(ROW_STEP);
    }
  });

  it("keeps the hero chain on one row up to the vendor and service", () => {
    const pos = computeLayout(demo);
    const y = pos.get("node-fund-auth")!.y;
    for (const id of ["node-card-auth", "node-vendor-cloudcomms", "node-service-otp-gateway"]) {
      expect(pos.get(id)!.y).toBe(y);
    }
  });

  it("ignores rejected edges when ordering rows", () => {
    const g: GraphShape = {
      nodes: [n("f1", "FUND"), n("f2", "FUND"), n("c", "CARD")],
      edges: [e("f2", "c", "REJECTED")],
    };
    // With the rejected edge ignored, the card has no predecessor and starts at row 0.
    expect(computeLayout(g).get("c")!.y).toBe(0);
  });
});

describe("unpaidVendorIds / unknownLineage", () => {
  it("in the seed, MetricsRelay is the only vendor nothing pays", () => {
    expect([...unpaidVendorIds(demo)]).toEqual([METRICS]);
  });

  it("marks only the MetricsRelay branch as unknown lineage", () => {
    const lineage = unknownLineage(demo, new Set([METRICS]));
    expect([...lineage.nodeIds].sort()).toEqual(
      [METRICS, "node-service-product-analytics", "node-workflow-growth-reporting"].sort(),
    );
    expect([...lineage.edgeIds].sort()).toEqual(
      [
        "edge-vendor-metricsrelay--service-product-analytics",
        "edge-service-product-analytics--workflow-growth-reporting",
      ].sort(),
    );
  });

  it("does not mark nodes that are also reachable from a fund", () => {
    const g: GraphShape = {
      nodes: [n("f", "FUND"), n("v1", "VENDOR"), n("v2", "VENDOR"), n("s", "SERVICE")],
      edges: [e("f", "v1"), e("v1", "s"), e("v2", "s")],
    };
    const lineage = unknownLineage(g, new Set(["v2"]));
    expect([...lineage.nodeIds]).toEqual(["v2"]);
    expect([...lineage.edgeIds]).toEqual(["edge-v2--s"]);
  });

  it("is empty when no vendor needs mapping", () => {
    const lineage = unknownLineage(demo, new Set());
    expect(lineage.nodeIds.size + lineage.edgeIds.size).toBe(0);
  });
});

describe("selectNode", () => {
  it("CloudComms: confirmed downstream, upstream funding chain, nothing possible", () => {
    const s = selectNode(demo, "node-vendor-cloudcomms");
    expect([...s.emphasis.confirmedNodeIds].sort()).toEqual(
      [
        "node-vendor-cloudcomms",
        "node-service-otp-gateway",
        "node-workflow-account-login",
        "node-outcome-customer-checkout",
      ].sort(),
    );
    expect([...s.emphasis.upstreamNodeIds].sort()).toEqual(["node-card-auth", "node-fund-auth"]);
    expect(s.emphasis.possibleNodeIds.size).toBe(0);
    expect(s.blast.confirmed.workflows.map((w) => w.nodeId)).toEqual(["node-workflow-account-login"]);
  });

  it("MetricsRelay: the suggested edge is possible-only, never confirmed", () => {
    const s = selectNode(demo, METRICS);
    expect(s.emphasis.possibleNodeIds.has("node-workflow-growth-reporting")).toBe(true);
    expect(s.emphasis.confirmedNodeIds.has("node-workflow-growth-reporting")).toBe(false);
    expect(s.emphasis.possibleEdgeIds.has("edge-service-product-analytics--workflow-growth-reporting")).toBe(true);
    expect(s.blast.confirmed.workflows).toHaveLength(0);
  });

  it("focusing one path narrows emphasis to exactly that chain", () => {
    const full = selectNode(demo, "node-vendor-cloudcomms");
    const loginOnly = full.blast.confirmed.paths.find((p) => p.endNodeId === "node-workflow-account-login")!;
    const s = selectNode(demo, "node-vendor-cloudcomms", loginOnly.pathId);
    expect([...s.emphasis.confirmedEdgeIds].sort()).toEqual([...loginOnly.edgeIds].sort());
    expect(s.emphasis.confirmedNodeIds.has("node-outcome-customer-checkout")).toBe(false);
  });

  it("an unknown focus path id falls back to the full selection", () => {
    const full = selectNode(demo, "node-vendor-cloudcomms");
    const s = selectNode(demo, "node-vendor-cloudcomms", "path:does-not-exist");
    expect([...s.emphasis.confirmedEdgeIds].sort()).toEqual([...full.emphasis.confirmedEdgeIds].sort());
  });
});

describe("applyFilters / searchNodes", () => {
  it("hides nodes of filtered kinds and every edge touching them", () => {
    const g = applyFilters(demo, {
      kinds: new Set(KIND_ORDER.filter((k) => k !== "SERVICE")),
      reviewStatuses: new Set(DEFAULT_REVIEW_FILTER),
    });
    expect(g.nodes.some((node) => node.kind === "SERVICE")).toBe(false);
    const ids = new Set(g.nodes.map((node) => node.id));
    for (const edge of g.edges) {
      expect(ids.has(edge.fromNodeId) && ids.has(edge.toNodeId)).toBe(true);
    }
  });

  it("filters edges by review status (rejected hidden by default)", () => {
    expect(DEFAULT_REVIEW_FILTER).toEqual(["CONFIRMED", "SUGGESTED"]);
    const g = applyFilters(demo, { kinds: new Set(KIND_ORDER), reviewStatuses: new Set(["CONFIRMED"]) });
    expect(g.edges.every((edge) => edge.reviewStatus === "CONFIRMED")).toBe(true);
    expect(g.edges).toHaveLength(demo.edges.length - 1);
  });

  it("searches label, id and owner case-insensitively; blank matches nothing", () => {
    expect(searchNodes(demo.nodes, "OTP")).toEqual(["node-service-otp-gateway"]);
    expect(searchNodes(demo.nodes, "identity platform").length).toBeGreaterThan(1);
    expect(searchNodes(demo.nodes, "   ")).toEqual([]);
  });
});

describe("listAllPaths", () => {
  it("lists only maximal end-to-end paths from funds and unpaid vendors", () => {
    const paths = listAllPaths(demo);
    expect(paths).toHaveLength(4);
    // No listed path is a strict prefix of another.
    for (const p of paths) {
      for (const q of paths) {
        if (p === q) continue;
        const prefix = p.edgeIds.length < q.edgeIds.length && p.edgeIds.every((id, i) => q.edgeIds[i] === id);
        expect(prefix).toBe(false);
      }
    }
    const metrics = paths.find((p) => p.startNodeId === METRICS)!;
    expect(metrics.confirmed).toBe(false);
    expect(paths.filter((p) => p.confirmed)).toHaveLength(3);
  });

  it("is deterministic", () => {
    expect(listAllPaths(demo).map((p) => p.pathId)).toEqual(listAllPaths(demo).map((p) => p.pathId));
  });
});
