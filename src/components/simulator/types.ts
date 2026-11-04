import type { FundingInterval } from "@/lib/schema/enums";

/** Serializable form options passed from the server page to the studio. */
export type StudioOptions = {
  funds: { id: string; name: string; availableCents: number | null; interval: FundingInterval }[];
  /** The fund paying the incident's charge/transaction, if known. */
  defaultFundId: string | null;
  /** The incident's scheduled charge (forecast incidents only). */
  charge: { id: string; expectedAt: string; expectedCents: number | null; fundingSourceId: string | null } | null;
  suggestedEdges: { id: string; label: string }[];
  /** edgeId -> fromNodeId, to deep-link a pathId into the graph. */
  edgeFrom: Record<string, string>;
};
