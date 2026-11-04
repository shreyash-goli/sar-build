/**
 * Server-only: the choices the Response Studio form offers for one incident.
 * Read-only repositories; nothing here is computed client-side.
 */
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import type { IncidentDetail } from "@/lib/incidents/schema";
import type { StudioOptions } from "@/components/simulator/types";

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

export async function loadStudioOptions(incident: IncidentDetail): Promise<StudioOptions> {
  const repos = createReadOnlyRepositories();
  const [funds, charges, transactions, edges, nodes] = await Promise.all([
    repos.fundingSources.list(),
    repos.vendorCharges.list(),
    repos.transactions.list(),
    repos.edges.list(),
    repos.nodes.list(),
  ]);

  // incidentKey is "charge:<chargeId>" or "transaction:<txId>" (src/lib/risk/classify.ts).
  const [subjectType, ...rest] = incident.incidentKey.split(":");
  const subjectId = rest.join(":");
  const charge = subjectType === "charge" ? (charges.find((c) => c.id === subjectId) ?? null) : null;
  const tx = subjectType === "transaction" ? (transactions.find((t) => t.id === subjectId) ?? null) : null;
  const label = new Map(nodes.map((n) => [n.id, n.label]));

  return {
    funds: [...funds].sort(byId).map((f) => ({
      id: f.id,
      name: f.name,
      availableCents: f.availableCents,
      interval: f.interval,
    })),
    defaultFundId: charge?.fundingSourceId ?? tx?.fundingSourceId ?? null,
    charge: charge
      ? {
          id: charge.id,
          expectedAt: charge.expectedAt,
          expectedCents: charge.expectedCents,
          fundingSourceId: charge.fundingSourceId,
        }
      : null,
    suggestedEdges: edges
      .filter((e) => e.reviewStatus === "SUGGESTED")
      .sort(byId)
      .map((e) => ({
        id: e.id,
        label: `${label.get(e.fromNodeId) ?? e.fromNodeId} ${e.relation} ${label.get(e.toNodeId) ?? e.toNodeId}`,
      })),
    edgeFrom: Object.fromEntries(edges.map((e) => [e.id, e.fromNodeId])),
  };
}
