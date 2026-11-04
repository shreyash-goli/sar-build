/**
 * Counterfactual simulation engine (blueprint Section 5, FS-14). Pure.
 *
 * 1. Deep-clone the normalized snapshot (inputs are never mutated).
 * 2. Validate feasibility and apply ONE SimulationPatch to the clone.
 * 3. Re-run the SAME risk engine (evaluateRisk) on the original and the clone.
 * 4. Emit before/after summaries, a per-incident diff, changed inputs, assumptions
 *    and rule versions. No client-provided score is ever used.
 * Every result is SIMULATION ONLY.
 */
import { evaluateRisk, OBSERVED_DECLINE_RULE_ID, RISK_SEVERITY_RULE_ID, SHORTFALL_RULE_ID, type RiskFinding } from "@/lib/risk";
import type {
  EvidenceRecord,
  FundingSource,
  GraphEdge,
  GraphNode,
  SimulationPatch,
  Transaction,
  Vendor,
  VendorCharge,
} from "@/lib/schema";
import { formatCents } from "@/lib/schema";
import {
  MODELED_CHANGE_ASSUMPTION,
  SIMULATION_LABEL,
  SIMULATION_RULE_ID,
  type ChangedInput,
  type FindingDiff,
  type FindingSummary,
  type SimulationResult,
} from "./schema";

export type WorkspaceSnapshot = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  vendors: Vendor[];
  fundingSources: FundingSource[];
  charges: VendorCharge[];
  transactions: Transaction[];
  evidence: EvidenceRecord[];
};

/** A patch that cannot be applied. `code` maps to HTTP: TARGET_NOT_FOUND -> 404, INFEASIBLE -> 400. */
export class SimulationError extends Error {
  constructor(
    readonly code: "TARGET_NOT_FOUND" | "INFEASIBLE",
    message: string,
    readonly details: { field: string; reason: string },
  ) {
    super(message);
    this.name = "SimulationError";
  }
}

const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");
const notFound = (field: string, what: string, id: string) =>
  new SimulationError("TARGET_NOT_FOUND", `${what} ${id} not found`, { field, reason: `${what} ${id} does not exist` });
const infeasible = (field: string, reason: string) => new SimulationError("INFEASIBLE", `Infeasible patch: ${reason}`, { field, reason });

type Applied = { snapshot: WorkspaceSnapshot; changedInputs: ChangedInput[]; assumptions: string[] };

/** Validate and apply a patch to a deep clone. Throws SimulationError. */
export function applyPatch(base: WorkspaceSnapshot, patch: SimulationPatch, now: Date): Applied {
  const s: WorkspaceSnapshot = structuredClone(base);
  const changedInputs: ChangedInput[] = [];
  const assumptions: string[] = [MODELED_CHANGE_ASSUMPTION];

  switch (patch.kind) {
    case "INCREASE_AVAILABLE_ALLOCATION": {
      const fund = s.fundingSources.find((f) => f.id === patch.fundingSourceId);
      if (!fund) throw notFound("patch.fundingSourceId", "Funding source", patch.fundingSourceId);
      if (fund.availableCents === null) {
        throw infeasible("patch.fundingSourceId", `available allocation of "${fund.name}" is unknown, so an increase cannot be modeled`);
      }
      const after = fund.availableCents + patch.amountCents;
      if (!Number.isSafeInteger(after)) throw infeasible("patch.amountCents", "resulting allocation exceeds the supported range");
      changedInputs.push({ entity: "FUNDING_SOURCE", id: fund.id, field: "availableCents", before: fund.availableCents, after });
      if (fund.limitCents !== null) {
        const limitAfter = fund.limitCents + patch.amountCents;
        if (!Number.isSafeInteger(limitAfter)) throw infeasible("patch.amountCents", "resulting limit exceeds the supported range");
        changedInputs.push({ entity: "FUNDING_SOURCE", id: fund.id, field: "limitCents", before: fund.limitCents, after: limitAfter });
        fund.limitCents = limitAfter;
      }
      fund.availableCents = after;
      assumptions.push(
        `Modeled +${formatCents(patch.amountCents)} allocation on "${fund.name}" for the current ${fund.interval.toLowerCase()} period (limit raised by the same amount).`,
      );
      break;
    }
    case "ASSIGN_ALTERNATE_FUND": {
      const charge = s.charges.find((c) => c.id === patch.vendorChargeId);
      if (!charge) throw notFound("patch.vendorChargeId", "Vendor charge", patch.vendorChargeId);
      const fund = s.fundingSources.find((f) => f.id === patch.fundingSourceId);
      if (!fund) throw notFound("patch.fundingSourceId", "Funding source", patch.fundingSourceId);
      if (charge.fundingSourceId === fund.id) {
        throw infeasible("patch.fundingSourceId", `charge ${charge.id} is already assigned to ${fund.id}`);
      }
      if (fund.availableCents === null) {
        throw infeasible("patch.fundingSourceId", `available allocation of alternate fund "${fund.name}" is unknown`);
      }
      changedInputs.push({ entity: "VENDOR_CHARGE", id: charge.id, field: "fundingSourceId", before: charge.fundingSourceId, after: fund.id });
      charge.fundingSourceId = fund.id;
      assumptions.push(
        `Modeled charge ${charge.id} as paid from "${fund.name}"; no card was re-pointed. Unless a confirmed payment link from that fund to the vendor exists, confidence is capped at LOW.`,
      );
      break;
    }
    case "MARK_CHARGE_RESCHEDULED": {
      const charge = s.charges.find((c) => c.id === patch.vendorChargeId);
      if (!charge) throw notFound("patch.vendorChargeId", "Vendor charge", patch.vendorChargeId);
      const at = new Date(patch.newExpectedAt);
      if (at.getTime() < now.getTime()) throw infeasible("patch.newExpectedAt", "a charge cannot be rescheduled into the past");
      if (charge.status !== "SCHEDULED" && charge.status !== "FORECAST" && charge.status !== "RESCHEDULED") {
        throw infeasible("patch.vendorChargeId", `charge ${charge.id} is ${charge.status} and cannot be rescheduled`);
      }
      changedInputs.push({ entity: "VENDOR_CHARGE", id: charge.id, field: "expectedAt", before: charge.expectedAt, after: iso(at) });
      if (charge.status !== "RESCHEDULED") {
        changedInputs.push({ entity: "VENDOR_CHARGE", id: charge.id, field: "status", before: charge.status, after: "RESCHEDULED" });
      }
      charge.expectedAt = iso(at);
      charge.status = "RESCHEDULED";
      assumptions.push(`Modeled the vendor accepting a new charge date of ${iso(at)}; no vendor agreement is implied.`);
      break;
    }
    case "MARK_DEPENDENCY_VERIFIED": {
      const edge = s.edges.find((e) => e.id === patch.edgeId);
      if (!edge) throw notFound("patch.edgeId", "Edge", patch.edgeId);
      if (edge.reviewStatus !== "SUGGESTED") {
        throw infeasible("patch.edgeId", `edge ${edge.id} is ${edge.reviewStatus}; only SUGGESTED edges can be modeled as verified`);
      }
      changedInputs.push({ entity: "EDGE", id: edge.id, field: "reviewStatus", before: "SUGGESTED", after: "CONFIRMED" });
      edge.reviewStatus = "CONFIRMED";
      assumptions.push(`Modeled edge ${edge.id} as if a reviewer confirmed it; the stored edge stays SUGGESTED until a real review.`);
      break;
    }
  }
  return { snapshot: s, changedInputs, assumptions };
}

function summarize(f: RiskFinding): FindingSummary {
  const p = f.projection;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const scored = p?.status === "SCORED" ? p : null;
  return {
    incidentKey: f.incidentKey,
    title: f.title,
    category: f.evaluation.category,
    severity: f.evaluation.severity,
    confidence: f.evaluation.confidence,
    amountCents: f.evaluation.assertion.amountCents,
    shortfallCents: scored ? scored.shortfallCents : null,
    marginCents: scored ? scored.marginCents : null,
    availableCents: p && p.status !== "NOT_APPLICABLE" ? num(p.availableCents) : null,
    effectiveAvailableCents: scored ? scored.effectiveAvailableCents : null,
    expectedCents: p && p.status !== "NOT_APPLICABLE" ? num(p.expectedCents) : null,
    dueInDays: p && p.status !== "NOT_APPLICABLE" ? (p.dueInDays ?? null) : null,
    confirmedPathIds: f.impact.confirmedPathIds,
  };
}

const COMPARED: readonly (keyof FindingSummary)[] = [
  "category",
  "severity",
  "confidence",
  "amountCents",
  "shortfallCents",
  "marginCents",
  "availableCents",
  "effectiveAvailableCents",
  "expectedCents",
  "dueInDays",
  "confirmedPathIds",
  "title",
];

function diffOne(incidentKey: string, before: FindingSummary | null, after: FindingSummary | null): FindingDiff {
  const changedFields =
    before && after
      ? COMPARED.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map(String)
      : before || after
        ? ["presence"]
        : [];
  return { incidentKey, before, after, changedFields };
}

export type SimulateInput = {
  snapshot: WorkspaceSnapshot;
  patch: SimulationPatch;
  /** The incident the user is simulating for (its incidentKey / Incident.scenarioKey). */
  focusIncidentKey: string;
  now: Date;
};

export function simulate({ snapshot, patch, focusIncidentKey, now }: SimulateInput): SimulationResult {
  const run = (s: WorkspaceSnapshot) =>
    evaluateRisk({
      graph: { nodes: s.nodes, edges: s.edges },
      vendors: s.vendors,
      fundingSources: s.fundingSources,
      charges: s.charges,
      transactions: s.transactions,
      evidence: s.evidence,
      now,
    }).map(summarize);
  const applied = applyPatch(snapshot, patch, now);
  const before = run(structuredClone(snapshot));
  const after = run(applied.snapshot);
  const keys = [...new Set([...before, ...after].map((f) => f.incidentKey))].sort();
  const find = (xs: FindingSummary[], k: string) => xs.find((f) => f.incidentKey === k) ?? null;
  const diff = keys.map((k) => diffOne(k, find(before, k), find(after, k)));
  return {
    label: SIMULATION_LABEL,
    ruleVersion: { simulation: SIMULATION_RULE_ID, shortfall: SHORTFALL_RULE_ID, severity: RISK_SEVERITY_RULE_ID, decline: OBSERVED_DECLINE_RULE_ID },
    evaluatedAt: iso(now),
    focus: diffOne(focusIncidentKey, find(before, focusIncidentKey), find(after, focusIncidentKey)),
    changedInputs: applied.changedInputs,
    assumptions: applied.assumptions,
    before,
    after,
    diff,
  };
}
