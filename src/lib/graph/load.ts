/**
 * Server-only graph read path (FS-07). Not re-exported from ./index.
 * Graph node IDs for financial entities follow `node-<entityId>`
 * (see entityNodeId in src/fixtures/northstar.ts).
 */
import { getEvidenceCategory } from "@/lib/provenance/definitions";
import { SOURCE_CLASS_DISPLAY, getSimulationBadge } from "@/lib/provenance/display";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import type { Repositories } from "@/lib/repositories";
import type { EvidenceRecord, VendorCharge } from "@/lib/schema";
import type { GraphData, GraphEvidenceSummary, GraphVendorStatus, VendorMappingReason } from "./schema";

const UPCOMING = new Set<VendorCharge["status"]>(["SCHEDULED", "FORECAST", "RESCHEDULED"]);
const NODE_PREFIX = "node-";

function summarize(ev: EvidenceRecord): GraphEvidenceSummary {
  const d = SOURCE_CLASS_DISPLAY[ev.classification];
  return {
    id: ev.id,
    classification: ev.classification,
    verificationStatus: ev.verificationStatus,
    excerpt: ev.excerpt,
    label: d.label,
    tone: d.tone,
    category: getEvidenceCategory(ev.classification),
    needsReview: d.needsReview,
    badge: getSimulationBadge({ sourceClass: ev.classification }),
  };
}

/** Graph nodes/edges plus evidence display and vendor mapping status. Sorted by id. */
export async function buildGraphData(repos: Repositories): Promise<GraphData> {
  const [nodes, edges, vendors, charges] = await Promise.all([
    repos.nodes.list(),
    repos.edges.list(),
    repos.vendors.list(),
    repos.vendorCharges.list(),
  ]);
  const cited = [...new Set([...nodes.map((n) => n.evidenceId), ...edges.map((e) => e.evidenceId)])].sort();
  const found = await repos.evidence.listByIds(cited);
  const evidence: Record<string, GraphEvidenceSummary> = {};
  for (const ev of found) evidence[ev.id] = summarize(ev);

  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const vendorStatuses: GraphVendorStatus[] = nodes
    .filter((n) => n.kind === "VENDOR")
    .map((n) => {
      const vendorId = n.id.startsWith(NODE_PREFIX) ? n.id.slice(NODE_PREFIX.length) : null;
      const vendor = vendorId ? vendorById.get(vendorId) : undefined;
      const reasons: VendorMappingReason[] = [];
      if (!vendor) reasons.push("NO_VENDOR_RECORD");
      else if (vendor.billingMethod === "UNKNOWN") reasons.push("BILLING_METHOD_UNKNOWN");
      if (vendor && charges.some((c) => c.vendorId === vendor.id && UPCOMING.has(c.status) && c.fundingSourceId === null)) {
        reasons.push("CHARGE_WITHOUT_FUNDING_SOURCE");
      }
      const paid = edges.some((e) => e.toNodeId === n.id && e.relation === "PAYS" && e.reviewStatus === "CONFIRMED");
      if (!paid && vendor?.billingMethod !== "INVOICE") reasons.push("NO_CONFIRMED_PAYMENT_EDGE");
      return {
        nodeId: n.id,
        vendorId: vendor ? vendor.id : null,
        name: vendor?.name ?? n.label,
        billingMethod: vendor?.billingMethod ?? null,
        needsMapping: reasons.length > 0,
        needsMappingReasons: reasons,
      };
    });

  return {
    nodes,
    edges,
    evidence,
    vendors: vendorStatuses,
    unresolvedEvidenceIds: cited.filter((id) => !(id in evidence)),
  };
}

/** Server-component convenience: the graph from the app DB (read-only). */
export function loadGraph(): Promise<GraphData> {
  return buildGraphData(createReadOnlyRepositories());
}
