/**
 * Server-only incident read path (FS-13): list/search/filter and investigator
 * detail built from the engine's incident snapshots. Point-in-time facts
 * (evaluation, calculation, cited evidence) come from the snapshot; current
 * labels/owners come from the graph. Missing records render as "Unknown (<id>)".
 */
import * as z from "zod";
import { getEvidenceCategory } from "@/lib/provenance/definitions";
import { SOURCE_CLASS_DISPLAY, getSimulationBadge } from "@/lib/provenance/display";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { NotFoundError, RepositoryError, type Repositories } from "@/lib/repositories";
import {
  Criticality,
  EvidenceMethod,
  RiskEvaluationSchema,
  SourceClass,
  VerificationStatus,
  formatCents,
  type GraphEdge,
  type GraphNode,
  type Incident,
  type Severity,
} from "@/lib/schema";
import { buildRunbook } from "@/lib/actions/runbooks";
import {
  parseIncidentQuery,
  type IncidentCalculation,
  type IncidentDetail,
  type IncidentListData,
  type IncidentListItem,
  type IncidentListQuery,
} from "./schema";

export { parseIncidentQuery };

const Snapshot = z.looseObject({
  subject: z.looseObject({ type: z.enum(["VENDOR_CHARGE", "TRANSACTION"]), id: z.string() }),
  evaluation: RiskEvaluationSchema,
  impact: z.looseObject({
    confirmedPaths: z.array(z.looseObject({ pathId: z.string(), edgeIds: z.array(z.string()) })),
    confirmedPathIds: z.array(z.string()),
    confirmedWorkflows: z.array(z.looseObject({ nodeId: z.string(), label: z.string(), criticality: Criticality })),
    possibleNodeIds: z.array(z.string()),
    complete: z.boolean(),
    paymentLinkConfirmed: z.boolean().optional(),
  }),
  projection: z
    .looseObject({
      status: z.string(),
      vendorId: z.string(),
      fundingSourceId: z.string().nullable(),
      availabilityObservedAt: z.string().nullable().optional(),
      chargeId: z.string(),
      expectedCents: z.int().nullable().optional(),
      availableCents: z.int().nullable().optional(),
      committedBeforeCents: z.int().optional(),
      effectiveAvailableCents: z.int().optional(),
      shortfallCents: z.int().nullable().optional(),
      marginCents: z.int().optional(),
      expectedAt: z.string().nullable().optional(),
      dueInDays: z.int().nullable().optional(),
      periodKeyUtc: z.string().optional(),
      priorChargeIds: z.array(z.string()).optional(),
      assumptions: z.array(z.string()).optional(),
      requestedMappings: z.array(z.looseObject({ code: z.string().optional(), message: z.string() })).optional(),
    })
    .nullable(),
  transaction: z
    .looseObject({
      id: z.string(),
      vendorId: z.string(),
      fundingSourceId: z.string().nullable().optional(),
      occurredAt: z.string(),
      amountCents: z.int(),
      reason: z.string().nullable(),
    })
    .nullable(),
  evidenceSnapshot: z.array(
    z.looseObject({
      id: z.string(),
      kind: EvidenceMethod,
      classification: SourceClass,
      verificationStatus: VerificationStatus,
      sourceSystem: z.string(),
      sourceId: z.string(),
      capturedAt: z.string(),
      excerpt: z.string().nullable(),
    }),
  ),
  missingEvidenceIds: z.array(z.string()),
  resolution: z.enum(["SUBJECT_NO_LONGER_EVALUATED"]).nullable().optional(),
});
type Snap = z.infer<typeof Snapshot>;

/** The incident row exists but its snapshotJson does not match the expected shape (HTTP 500). */
export class IncidentSnapshotUnreadableError extends RepositoryError {
  constructor(incidentId: string) {
    super("INTERNAL_ERROR", "Incident exists but its snapshot could not be read", {
      reason: "INCIDENT_SNAPSHOT_UNREADABLE",
      incidentId,
    });
    this.name = "IncidentSnapshotUnreadableError";
  }
}

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, UNKNOWN: 3, LOW: 4 };
const canonical = (s: string) => new Date(s).toISOString().replace(".000Z", "Z");

type Ctx = {
  nodeById: Map<string, GraphNode>;
  edgeById: Map<string, GraphEdge>;
  vendorName: Map<string, string>;
};

async function context(repos: Repositories): Promise<Ctx> {
  const [nodes, edges, vendors] = await Promise.all([repos.nodes.list(), repos.edges.list(), repos.vendors.list()]);
  return {
    nodeById: new Map(nodes.map((n) => [n.id, n])),
    edgeById: new Map(edges.map((e) => [e.id, e])),
    vendorName: new Map(vendors.map((v) => [v.id, v.name])),
  };
}

function listItem(inc: Incident, s: Snap, ctx: Ctx): IncidentListItem {
  const cat = s.evaluation.category;
  const isDecline = s.subject.type === "TRANSACTION";
  const vendorId = inc.primaryVendorId ?? s.projection?.vendorId ?? s.transaction?.vendorId ?? null;
  const top = s.impact.confirmedWorkflows[0];
  return {
    id: inc.id,
    incidentKey: inc.scenarioKey ?? inc.id,
    title: inc.title,
    signal: isDecline ? "OBSERVED_DECLINE" : "FORECAST",
    category: cat,
    severity: s.evaluation.severity,
    confidence: s.evaluation.confidence,
    status: inc.status,
    vendorId,
    vendorName: (vendorId && ctx.vendorName.get(vendorId)) || vendorId || "Unknown vendor",
    amountCents: isDecline ? (s.transaction?.amountCents ?? null) : cat === "PROJECTED_SHORTFALL" ? (s.projection?.shortfallCents ?? null) : null,
    dueInDays: isDecline ? null : (s.projection?.dueInDays ?? null),
    at: isDecline ? (s.transaction ? canonical(s.transaction.occurredAt) : null) : s.projection?.expectedAt ? canonical(s.projection.expectedAt) : null,
    firstSeenAt: inc.firstSeenAt,
    updatedAt: inc.updatedAt,
    topWorkflow: top
      ? { nodeId: top.nodeId, label: top.label, criticality: top.criticality, owner: ctx.nodeById.get(top.nodeId)?.owner ?? null }
      : null,
    confirmedPathCount: s.impact.confirmedPathIds.length,
    sourceClasses: [...new Set(s.evidenceSnapshot.map((e) => e.classification))].sort(),
  };
}

function parse(inc: Incident): Snap | null {
  const r = Snapshot.safeParse(inc.snapshotJson);
  return r.success ? r.data : null;
}

export async function buildIncidentList(repos: Repositories, query: IncidentListQuery = {}): Promise<IncidentListData> {
  const [incidents, ctx] = await Promise.all([repos.incidents.list(), context(repos)]);
  const unreadableIncidentIds: string[] = [];
  let items: IncidentListItem[] = [];
  for (const inc of incidents) {
    const s = parse(inc);
    if (!s) unreadableIncidentIds.push(inc.id);
    else items.push(listItem(inc, s, ctx));
  }
  const q = query.q?.toLowerCase();
  items = items.filter(
    (i) =>
      (!query.severity || i.severity === query.severity) &&
      (!query.status || i.status === query.status) &&
      (!query.category || i.category === query.category) &&
      (!query.signal || i.signal === query.signal) &&
      (!q || i.title.toLowerCase().includes(q) || i.vendorName.toLowerCase().includes(q)),
  );
  const due = (i: IncidentListItem) => i.dueInDays ?? Number.POSITIVE_INFINITY;
  const sort = query.sort ?? "severity";
  items.sort((a, b) =>
    sort === "updated"
      ? new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() || a.id.localeCompare(b.id)
      : sort === "due"
        ? due(a) - due(b) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id)
        : SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || due(a) - due(b) || a.id.localeCompare(b.id),
  );
  return { incidents: items, total: items.length, unreadableIncidentIds };
}

function calculation(s: Snap): IncidentCalculation {
  const p = s.projection;
  if (s.transaction) {
    return {
      kind: "DECLINE",
      amountCents: s.transaction.amountCents,
      occurredAt: canonical(s.transaction.occurredAt),
      reason: s.transaction.reason,
      transactionId: s.transaction.id,
    };
  }
  if (
    p &&
    p.status === "SCORED" &&
    typeof p.expectedCents === "number" &&
    typeof p.availableCents === "number" &&
    typeof p.shortfallCents === "number" &&
    typeof p.effectiveAvailableCents === "number" &&
    typeof p.committedBeforeCents === "number" &&
    typeof p.marginCents === "number" &&
    typeof p.dueInDays === "number" &&
    p.expectedAt
  ) {
    const steps = [
      `Expected charge: ${formatCents(p.expectedCents)} (${p.chargeId}, due ${p.expectedAt.slice(0, 10)})`,
      `Available allocation: ${formatCents(p.availableCents)}${p.fundingSourceId ? ` (${p.fundingSourceId}, period ${p.periodKeyUtc ?? "unknown"})` : ""}`,
      ...(p.committedBeforeCents > 0
        ? [
            `Earlier charges in the same period: ${formatCents(p.committedBeforeCents)} (${(p.priorChargeIds ?? []).join(", ")})`,
            `Effective available: max(0, ${formatCents(p.availableCents)} − ${formatCents(p.committedBeforeCents)}) = ${formatCents(p.effectiveAvailableCents)}`,
          ]
        : []),
      `Projected shortfall = max(0, ${formatCents(p.expectedCents)} − ${formatCents(p.effectiveAvailableCents)}) = ${formatCents(p.shortfallCents)}`,
      `Modeled margin after the charge: ${formatCents(p.marginCents)}`,
      `Due in ${p.dueInDays} day(s): whole 24-hour periods from the evaluation time`,
    ];
    return {
      kind: "SHORTFALL",
      formula: "shortfall = max(0, expected − max(0, available − earlier charges in the same period))",
      expectedCents: p.expectedCents,
      availableCents: p.availableCents,
      committedBeforeCents: p.committedBeforeCents,
      effectiveAvailableCents: p.effectiveAvailableCents,
      shortfallCents: p.shortfallCents,
      marginCents: p.marginCents,
      expectedAt: canonical(p.expectedAt),
      dueInDays: p.dueInDays,
      periodKeyUtc: p.periodKeyUtc ?? "unknown",
      priorChargeIds: p.priorChargeIds ?? [],
      steps,
      assumptions: p.assumptions ?? [],
    };
  }
  return {
    kind: "UNKNOWN",
    expectedCents: p?.expectedCents ?? null,
    availableCents: p?.availableCents ?? null,
    dueInDays: p?.dueInDays ?? null,
    requestedMappings: s.evaluation.requestedMappings,
  };
}

function nodeView(id: string, ctx: Ctx) {
  const n = ctx.nodeById.get(id);
  return n
    ? { id, label: n.label, kind: n.kind, criticality: n.criticality, owner: n.owner }
    : { id, label: `Unknown (${id})`, kind: null, criticality: null, owner: null };
}

function edgeView(id: string, ctx: Ctx) {
  const e = ctx.edgeById.get(id);
  return e
    ? {
        id,
        fromNodeId: e.fromNodeId,
        toNodeId: e.toNodeId,
        relation: e.relation,
        dependencyStrength: e.dependencyStrength,
        confidenceTier: e.confidenceTier,
        reviewStatus: e.reviewStatus,
        evidenceId: e.evidenceId,
      }
    : { id, fromNodeId: null, toNodeId: null, relation: null, dependencyStrength: null, confidenceTier: null, reviewStatus: null, evidenceId: null };
}

/** Full investigator detail. Throws NotFoundError for unknown IDs. */
export async function buildIncidentDetail(repos: Repositories, id: string): Promise<IncidentDetail> {
  const inc = await repos.incidents.getById(id);
  const s = parse(inc);
  if (!s) throw new IncidentSnapshotUnreadableError(id);
  const ctx = await context(repos);
  const base = listItem(inc, s, ctx);

  const confirmedChains = s.impact.confirmedPaths.map((p) => {
    const edges = p.edgeIds.map((eid) => edgeView(eid, ctx));
    const nodeIds = [edges[0]?.fromNodeId ?? null, ...edges.map((e) => e.toNodeId)].filter((x): x is string => x !== null);
    return { pathId: p.pathId, nodes: nodeIds.map((nid) => nodeView(nid, ctx)), edges };
  });

  const evaluatedAt = new Date(s.evaluation.assertion.evaluatedAt).getTime();
  const timeline: IncidentDetail["timeline"] = [];
  const push = (at: string, kind: IncidentDetail["timeline"][number]["kind"], label: string) =>
    timeline.push({ at: canonical(at), kind, label, projected: new Date(at).getTime() > evaluatedAt });
  // Time AND amount both come from the evaluation snapshot; the current fund row only supplies its name.
  if (s.projection?.fundingSourceId && s.projection.availabilityObservedAt) {
    const fund = await repos.fundingSources.findById(s.projection.fundingSourceId);
    push(
      s.projection.availabilityObservedAt,
      "AVAILABILITY_OBSERVED",
      `Available allocation of "${fund?.name ?? s.projection.fundingSourceId}" observed: ${formatCents(s.projection.availableCents ?? null)}`,
    );
  }
  if (s.transaction) push(s.transaction.occurredAt, "TRANSACTION_DECLINED", `Transaction declined: ${formatCents(s.transaction.amountCents)}${s.transaction.reason ? ` (${s.transaction.reason})` : ""}`);
  push(inc.firstSeenAt, "FIRST_DETECTED", "Incident first detected by the risk engine");
  if (inc.updatedAt !== inc.firstSeenAt) push(inc.updatedAt, "LAST_EVALUATED", "Last re-evaluated with changed results");
  if (s.projection?.expectedAt) push(s.projection.expectedAt, "CHARGE_DUE", `Charge ${s.projection.chargeId} expected`);
  for (const a of await repos.auditEvents.listBySubject(inc.id)) push(a.at, "AUDIT", `${a.actor}: ${a.action}`);
  const KIND_ORDER = ["AVAILABILITY_OBSERVED", "TRANSACTION_DECLINED", "FIRST_DETECTED", "LAST_EVALUATED", "AUDIT", "CHARGE_DUE"];
  timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  const possibleImpacts = s.impact.possibleNodeIds.map((nid) => nodeView(nid, ctx));
  const fundId = s.projection?.fundingSourceId ?? s.transaction?.fundingSourceId ?? null;
  const fundRow = fundId ? await repos.fundingSources.findById(fundId) : null;
  const runbook = buildRunbook({
    incidentKey: base.incidentKey,
    category: s.evaluation.category,
    severity: s.evaluation.severity,
    vendorName: base.vendorName,
    vendorOwner: base.vendorId ? (ctx.nodeById.get(`node-${base.vendorId}`)?.owner ?? null) : null,
    fund: fundRow ? { id: fundRow.id, name: fundRow.name, owner: ctx.nodeById.get(`node-${fundRow.id}`)?.owner ?? null } : null,
    workflows: s.impact.confirmedWorkflows.map((w) => ({ label: w.label, criticality: w.criticality, owner: ctx.nodeById.get(w.nodeId)?.owner ?? null })),
    possibleImpactLabels: possibleImpacts.map((n) => n.label),
    expectedCents: s.projection?.expectedCents ?? null,
    availableCents: s.projection?.availableCents ?? null,
    shortfallCents: s.projection?.shortfallCents ?? null,
    at: base.at,
    dueInDays: base.dueInDays,
    declinedAmountCents: s.transaction?.amountCents ?? null,
    declineReason: s.transaction?.reason ?? null,
    missingCodes: (s.projection?.requestedMappings ?? []).map((m) => m.code).filter((c): c is string => typeof c === "string"),
    // Older snapshots predate the payment-link check; they never asked for this mapping.
    paymentLinkConfirmed: s.impact.paymentLinkConfirmed ?? true,
  });

  return {
    ...base,
    runbook,
    evaluation: s.evaluation,
    calculation: calculation(s),
    confirmedChains,
    possibleImpacts,
    impactComplete: s.impact.complete,
    owners: s.impact.confirmedWorkflows.map((w) => ({ nodeId: w.nodeId, label: w.label, criticality: w.criticality, owner: ctx.nodeById.get(w.nodeId)?.owner ?? null })),
    evidence: s.evidenceSnapshot.map((e) => {
      const d = SOURCE_CLASS_DISPLAY[e.classification];
      return {
        id: e.id,
        kind: e.kind,
        classification: e.classification,
        verificationStatus: e.verificationStatus,
        sourceSystem: e.sourceSystem,
        sourceId: e.sourceId,
        capturedAt: canonical(e.capturedAt),
        excerpt: e.excerpt,
        label: d.label,
        tone: d.tone,
        category: getEvidenceCategory(e.classification),
        badge: getSimulationBadge({ sourceClass: e.classification }),
      };
    }),
    missingEvidenceIds: s.missingEvidenceIds,
    ruleEvidenceId: inc.evidenceId,
    caveats: s.evaluation.assertion.limitations,
    timeline,
    resolution: s.resolution ?? null,
  };
}

/** Server-component convenience: incident list from the app DB (read-only). */
export function loadIncidents(query: IncidentListQuery = {}): Promise<IncidentListData> {
  return buildIncidentList(createReadOnlyRepositories(), query);
}

/** Server-component convenience: incident detail, or null when the id does not exist. */
export async function loadIncident(id: string): Promise<IncidentDetail | null> {
  try {
    return await buildIncidentDetail(createReadOnlyRepositories(), id);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}
