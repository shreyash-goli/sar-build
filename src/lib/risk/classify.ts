/**
 * Risk classifier v1 (blueprint Section 5). Pure and deterministic.
 *
 * Severity (confirmed dependency graph ONLY; suggested edges never raise it):
 *   CRITICAL  observed decline, or verified projected shortfall due in <= 3 days,
 *             AND a confirmed path reaches a CRITICAL workflow.
 *   HIGH      verified shortfall due in <= 7 days (or observed decline) AND a
 *             confirmed path reaches a HIGH or CRITICAL workflow.
 *   MEDIUM    verified shortfall due in <= 14 days (or observed decline) AND at
 *             least one confirmed operational path.
 *   LOW       known valid inputs, no projected shortfall, no observed decline in
 *             the scoring window. Also: a verified shortfall beyond 14 days.
 *   UNKNOWN   missing funding/payment/forecast evidence (UNKNOWN_DATA), or a
 *             shortfall/decline with no confirmed dependency path to score.
 * Confidence is separate from severity: the weakest confidenceTier of the
 * confirmed edges on the paths that drive severity, capped at MEDIUM when the
 * availability reading is stale, and capped at LOW when the fund -> vendor
 * payment link is not confirmed in the graph (the engine then starts from the
 * vendor node, keeps severity, adds a caveat and requests the mapping);
 * UNKNOWN when severity is UNKNOWN.
 *
 * Wording: a shortfall or decline is POTENTIAL interruption risk. It is never
 * claimed to be a vendor suspension or a service outage.
 */
import {
  projectCharges,
  type ChargeProjection,
  type ProjectableCharge,
  type ScoredProjection,
  type UnknownProjection,
} from "@/lib/forecast";
import { computeBlastRadius, reachableNodeIds, type GraphInput, type ImpactPath } from "@/lib/graph";
import {
  formatCents,
  type ConfidenceTier,
  type Criticality,
  type EvidenceRecord,
  type FundingSource,
  type RiskEvaluation,
  type RiskReason,
  type Severity,
  type Transaction,
  type Vendor,
} from "@/lib/schema";

export const RISK_SEVERITY_RULE_ID = "risk-severity-v1";
export const OBSERVED_DECLINE_RULE_ID = "observed-decline-v1";
export const SHORTFALL_RULE_ID = "projected-shortfall-v1";

export const SEVERITY_THRESHOLD_DAYS = { CRITICAL: 3, HIGH: 7, MEDIUM: 14 } as const;
/** Declines older than this (relative to now) are outside the scoring window. */
export const DECLINE_WINDOW_DAYS = 14;

const DAY_MS = 86_400_000;
const CONFIDENCE_RANK: Readonly<Record<ConfidenceTier, number>> = { HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };
const nodeIdFor = (entityId: string) => `node-${entityId}`;
const day = (iso: string) => iso.slice(0, 10);
const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");

export type RiskSubject = { type: "VENDOR_CHARGE"; id: string } | { type: "TRANSACTION"; id: string };

export type ImpactPathRef = {
  pathId: string;
  edgeIds: string[];
  endNodeId: string;
  endNodeKind: "WORKFLOW" | "OUTCOME" | string;
  endNodeCriticality: Criticality;
};

export type ImpactSummary = {
  startNodeId: string | null;
  /** Confirmed paths through the vendor node, structured (blast-radius order). */
  confirmedPaths: ImpactPathRef[];
  /** Confirmed paths through the vendor node (blast-radius order). */
  confirmedPathIds: string[];
  confirmedWorkflows: { nodeId: string; label: string; criticality: Criticality }[];
  confirmedOutcomeIds: string[];
  /** Workflows/outcomes reachable only via SUGGESTED edges: shown, never scored. */
  possibleNodeIds: string[];
  /** Edge IDs of every confirmed path (for evidence citation). */
  confirmedEdgeIds: string[];
  /** False when the confirmed traversal hit a depth/size bound. */
  complete: boolean;
  /**
   * True when a CONFIRMED path runs from the funding source's node to the vendor's
   * node. False means the engine fell back to starting at the vendor: the payment
   * link is unconfirmed, so confidence is capped at LOW and a mapping is requested.
   */
  paymentLinkConfirmed: boolean;
};

export type RiskFinding = {
  /** Stable dedupe key per subject: "charge:<id>" or "transaction:<id>". */
  incidentKey: string;
  subject: RiskSubject;
  vendorId: string;
  vendorName: string;
  fundingSourceId: string | null;
  title: string;
  evaluation: RiskEvaluation;
  impact: ImpactSummary;
  /** Present for VENDOR_CHARGE subjects. */
  projection: ChargeProjection | null;
  /** Present for TRANSACTION subjects. */
  transaction: Transaction | null;
};

export type RiskInput = {
  graph: GraphInput;
  charges: readonly ProjectableCharge[];
  vendors: readonly Vendor[];
  fundingSources: readonly FundingSource[];
  transactions: readonly Transaction[];
  evidence: readonly Pick<EvidenceRecord, "id" | "classification" | "verificationStatus">[];
  now: Date;
};

function impactFor(graph: GraphInput, nodeIds: ReadonlySet<string>, vendorId: string, fundingSourceId: string | null): ImpactSummary {
  const vendorNode = nodeIdFor(vendorId);
  const fundNode = fundingSourceId ? nodeIdFor(fundingSourceId) : null;
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  // The fund -> card -> vendor payment link counts only if CONFIRMED edges connect them.
  const paymentLinkConfirmed =
    fundNode !== null && nodeIds.has(fundNode) && nodeIds.has(vendorNode) && reachableNodeIds(graph, fundNode).nodeIds.includes(vendorNode);
  const start = paymentLinkConfirmed ? fundNode : nodeIds.has(vendorNode) ? vendorNode : null;

  if (start !== null) {
    const br = computeBlastRadius(graph, start);
    const through = (p: ImpactPath) => p.nodeIds.includes(vendorNode);
    const paths = br.confirmed.paths.filter(through);
    const possible = br.possible.paths.filter(through);
    const confirmedEnds = new Set(paths.map((p) => p.endNodeId));
    const workflows = [...new Set(paths.filter((p) => p.endNodeKind === "WORKFLOW").map((p) => p.endNodeId))].map((id) => {
      const n = nodeById.get(id)!;
      return { nodeId: id, label: n.label, criticality: n.criticality };
    });
    return {
      startNodeId: start,
      confirmedPaths: paths.map((p) => ({
        pathId: p.pathId,
        edgeIds: p.edgeIds,
        endNodeId: p.endNodeId,
        endNodeKind: p.endNodeKind,
        endNodeCriticality: p.endNodeCriticality,
      })),
      confirmedPathIds: paths.map((p) => p.pathId),
      confirmedWorkflows: workflows,
      confirmedOutcomeIds: [...new Set(paths.filter((p) => p.endNodeKind === "OUTCOME").map((p) => p.endNodeId))],
      possibleNodeIds: [...new Set(possible.map((p) => p.endNodeId))].filter((id) => !confirmedEnds.has(id)).sort(),
      confirmedEdgeIds: [...new Set(paths.flatMap((p) => p.edgeIds))],
      complete: !br.confirmed.truncated && !br.confirmed.depthLimited,
      paymentLinkConfirmed,
    };
  }
  return {
    startNodeId: null,
    confirmedPaths: [],
    confirmedPathIds: [],
    confirmedWorkflows: [],
    confirmedOutcomeIds: [],
    possibleNodeIds: [],
    confirmedEdgeIds: [],
    complete: true,
    paymentLinkConfirmed,
  };
}

/** Caveats when the fund -> vendor payment link is not confirmed (severity kept; confidence capped LOW). */
function paymentLinkCaveat(
  impact: ImpactSummary,
  fundingSourceId: string | null,
  vendorName: string,
  fundName: string | null,
): { limitations: string[]; requestedMappings: string[] } {
  if (impact.paymentLinkConfirmed) return { limitations: [], requestedMappings: [] };
  const fund = fundName ?? fundingSourceId;
  return {
    limitations: [
      fund
        ? `Payment link from ${fund} to ${vendorName} is not confirmed in the dependency graph`
        : `Payment link to ${vendorName} is not confirmed in the dependency graph (no funding source recorded)`,
    ],
    requestedMappings: [`Confirm which card/fund pays ${vendorName}.`],
  };
}

function capConfidence(c: ConfidenceTier, impact: ImpactSummary): ConfidenceTier {
  return !impact.paymentLinkConfirmed && CONFIDENCE_RANK[c] > CONFIDENCE_RANK.LOW ? "LOW" : c;
}

/** Severity from confirmed workflows; `days` (null for declines) limits how far up the ladder it may climb. */
function graphSeverity(
  impact: ImpactSummary,
  days: number | null,
): { severity: Severity; thresholdDays: number | null; drivingCriticalities: readonly Criticality[] } {
  const crits = new Set(impact.confirmedWorkflows.map((w) => w.criticality));
  const within = (limit: number) => days === null || days <= limit;
  if (within(SEVERITY_THRESHOLD_DAYS.CRITICAL) && crits.has("CRITICAL"))
    return { severity: "CRITICAL", thresholdDays: days === null ? null : SEVERITY_THRESHOLD_DAYS.CRITICAL, drivingCriticalities: ["CRITICAL"] };
  if (within(SEVERITY_THRESHOLD_DAYS.HIGH) && (crits.has("CRITICAL") || crits.has("HIGH")))
    return { severity: "HIGH", thresholdDays: days === null ? null : SEVERITY_THRESHOLD_DAYS.HIGH, drivingCriticalities: ["CRITICAL", "HIGH"] };
  if (within(SEVERITY_THRESHOLD_DAYS.MEDIUM) && impact.confirmedPathIds.length > 0)
    return { severity: "MEDIUM", thresholdDays: days === null ? null : SEVERITY_THRESHOLD_DAYS.MEDIUM, drivingCriticalities: [] };
  if (impact.confirmedPathIds.length === 0) return { severity: "UNKNOWN", thresholdDays: null, drivingCriticalities: [] };
  return { severity: "LOW", thresholdDays: SEVERITY_THRESHOLD_DAYS.MEDIUM, drivingCriticalities: [] };
}

/** Weakest confidenceTier over the edges of the given paths (HIGH when there are none). */
function pathConfidence(graph: GraphInput, paths: readonly ImpactPathRef[]): ConfidenceTier {
  const edgeById = new Map(graph.edges.map((e) => [e.id, e]));
  return paths
    .flatMap((p) => p.edgeIds)
    .map((id) => edgeById.get(id)?.confidenceTier ?? "UNKNOWN")
    .reduce<ConfidenceTier>((min, t) => (CONFIDENCE_RANK[t] < CONFIDENCE_RANK[min] ? t : min), "HIGH");
}

/** Paths that justify the severity: those ending at a workflow of a driving criticality (all paths for MEDIUM). */
function drivingPaths(impact: ImpactSummary, criticalities: readonly Criticality[]): ImpactPathRef[] {
  if (criticalities.length === 0) return impact.confirmedPaths;
  return impact.confirmedPaths.filter((p) => p.endNodeKind === "WORKFLOW" && criticalities.includes(p.endNodeCriticality));
}

function syntheticLimitations(inputs: readonly string[], evidence: ReadonlyMap<string, { classification: string }>): string[] {
  const classes = new Set(inputs.map((i) => evidence.get(i.replace(/^evidence:/, ""))?.classification));
  const out: string[] = [];
  if (classes.has("DEMO_FIXTURE")) out.push("Inputs are synthetic demo data (DEMO_FIXTURE), not live business records.");
  if (classes.has("RAMP_SANDBOX")) out.push("Inputs include Ramp sandbox test data.");
  return out;
}

function evidenceInputs(graph: GraphInput, base: readonly string[], impact: ImpactSummary): string[] {
  const edgeById = new Map(graph.edges.map((e) => [e.id, e]));
  const edgeEvidence = impact.confirmedEdgeIds.map((id) => edgeById.get(id)?.evidenceId).filter((x): x is string => !!x);
  return [...new Set([...base, ...edgeEvidence.map((id) => `evidence:${id}`)])];
}

function workflowPhrase(impact: ImpactSummary): string {
  const top = impact.confirmedWorkflows[0];
  return top ? `potential interruption of ${top.label} (${top.criticality})` : "no confirmed operational path";
}

function chargeFinding(input: RiskInput, p: ChargeProjection, ctx: Ctx): RiskFinding | null {
  if (p.status === "NOT_APPLICABLE") return null;
  const vendor = ctx.vendorById.get(p.vendorId);
  const vendorName = vendor?.name ?? p.vendorId;
  const impact = impactFor(input.graph, ctx.nodeIds, p.vendorId, p.fundingSourceId);
  const subject: RiskSubject = { type: "VENDOR_CHARGE", id: p.chargeId };
  const base = {
    incidentKey: `charge:${p.chargeId}`,
    subject,
    vendorId: p.vendorId,
    vendorName,
    fundingSourceId: p.fundingSourceId,
    impact,
    projection: p,
    transaction: null,
  };
  const assertionId = `risk-charge-${p.chargeId}`;

  if (p.status === "UNKNOWN_DATA") return unknownChargeFinding(input, p, ctx, base, assertionId);

  if (!p.hasShortfall) {
    // LOW requires no observed decline for the vendor in the window; the decline incident covers it otherwise.
    if (ctx.declinedVendorIds.has(p.vendorId)) return null;
    const inputs = evidenceInputs(input.graph, p.inputs, impact);
    const link = paymentLinkCaveat(impact, p.fundingSourceId, vendorName, p.fundingSourceId ? (ctx.fundName.get(p.fundingSourceId) ?? null) : null);
    const confidence = capConfidence(capForStaleness(pathConfidence(input.graph, impact.confirmedPaths), p), impact);
    return {
      ...base,
      title: `${vendorName}: no projected shortfall for ${formatCents(p.expectedCents)} charge due ${day(p.expectedAt)}`,
      evaluation: {
        category: "NO_RISK",
        severity: "LOW",
        confidence,
        reasons: [
          {
            riskRuleId: SHORTFALL_RULE_ID,
            thresholdDays: null,
            amountCents: 0,
            daysUntil: p.dueInDays,
            confirmedImpactedPathIds: impact.confirmedPathIds,
            detail: `Expected ${formatCents(p.expectedCents)} vs effective available ${formatCents(p.effectiveAvailableCents)}: modeled margin ${formatCents(p.marginCents)}. No observed decline in the last ${DECLINE_WINDOW_DAYS} days.`,
          },
        ],
        assertion: {
          assertionId,
          claim: `No projected funding shortfall for ${vendorName} charge due ${day(p.expectedAt)} (margin ${formatCents(p.marginCents)})`,
          status: "DERIVED",
          ruleId: SHORTFALL_RULE_ID,
          inputs,
          evaluatedAt: iso(input.now),
          amountCents: 0,
          limitations: [...link.limitations, ...syntheticLimitations(inputs, ctx.evidenceById), ...p.assumptions],
        },
        requestedMappings: link.requestedMappings,
      },
    };
  }

  return shortfallFinding(input, p, ctx, base, assertionId);
}

type Base = Omit<RiskFinding, "title" | "evaluation">;
type Ctx = {
  vendorById: ReadonlyMap<string, Vendor>;
  fundName: ReadonlyMap<string, string>;
  nodeIds: ReadonlySet<string>;
  declinedVendorIds: ReadonlySet<string>;
  evidenceById: ReadonlyMap<string, { classification: string }>;
};

function capForStaleness(c: ConfidenceTier, p: ScoredProjection): ConfidenceTier {
  return p.availabilityStale && CONFIDENCE_RANK[c] > CONFIDENCE_RANK.MEDIUM ? "MEDIUM" : c;
}

function unknownChargeFinding(input: RiskInput, p: UnknownProjection, ctx: Ctx, base: Base, assertionId: string): RiskFinding {
  const requestedMappings = p.requestedMappings.map((m) => m.message);
  const inputs = evidenceInputs(input.graph, p.inputs, base.impact);
  return {
    ...base,
    title: `${base.vendorName}: risk unknown, needs mapping`,
    evaluation: {
      category: "UNKNOWN_DATA",
      severity: "UNKNOWN",
      confidence: "UNKNOWN",
      reasons: [
        {
          riskRuleId: SHORTFALL_RULE_ID,
          thresholdDays: null,
          amountCents: null,
          daysUntil: p.dueInDays,
          confirmedImpactedPathIds: base.impact.confirmedPathIds,
          detail: `Cannot score funding exposure: missing ${p.requestedMappings.map((m) => m.code).join(", ")}.`,
        },
      ],
      assertion: {
        assertionId,
        claim: `Funding risk for ${base.vendorName} charge ${p.chargeId} cannot be determined: required inputs are missing`,
        status: "UNKNOWN",
        ruleId: SHORTFALL_RULE_ID,
        inputs,
        evaluatedAt: iso(input.now),
        amountCents: null,
        limitations: [...requestedMappings, ...syntheticLimitations(inputs, ctx.evidenceById)],
      },
      requestedMappings,
    },
  };
}

function shortfallFinding(input: RiskInput, p: ScoredProjection, ctx: Ctx, base: Base, assertionId: string): RiskFinding {
  const g = graphSeverity(base.impact, p.dueInDays);
  // Beyond 14 days with a confirmed path: LOW; with no confirmed path: UNKNOWN (dependency evidence missing).
  const severity = g.severity;
  const drivingRefs = drivingPaths(base.impact, g.drivingCriticalities);
  const driving = drivingRefs.map((x) => x.pathId);
  const link = paymentLinkCaveat(base.impact, p.fundingSourceId, base.vendorName, p.fundingSourceId ? (ctx.fundName.get(p.fundingSourceId) ?? null) : null);
  const confidence =
    severity === "UNKNOWN" ? "UNKNOWN" : capConfidence(capForStaleness(pathConfidence(input.graph, drivingRefs), p), base.impact);
  const inputs = evidenceInputs(input.graph, p.inputs, base.impact);
  const outsideWindow = severity === "LOW";
  const windowNote = `Projected shortfall due in ${p.dueInDays} days is outside the ${SEVERITY_THRESHOLD_DAYS.MEDIUM}-day scoring window; monitoring`;
  const requestedMappings = [
    ...(severity === "UNKNOWN" ? [`Map which services and workflows depend on ${base.vendorName} (no confirmed dependency path).`] : []),
    ...link.requestedMappings,
  ];
  const reasons: RiskReason[] = [
    {
      riskRuleId: SHORTFALL_RULE_ID,
      thresholdDays: g.thresholdDays,
      amountCents: p.shortfallCents,
      daysUntil: p.dueInDays,
      confirmedImpactedPathIds: base.impact.confirmedPathIds,
      detail: `Expected ${formatCents(p.expectedCents)} vs effective available ${formatCents(p.effectiveAvailableCents)} on the ${day(p.expectedAt)} charge: projected shortfall ${formatCents(p.shortfallCents)}, due in ${p.dueInDays} day(s).`,
    },
    {
      riskRuleId: RISK_SEVERITY_RULE_ID,
      thresholdDays: g.thresholdDays,
      amountCents: p.shortfallCents,
      daysUntil: p.dueInDays,
      confirmedImpactedPathIds: driving,
      detail:
        severity === "UNKNOWN"
          ? "No confirmed dependency path from this vendor; severity cannot be scored."
          : outsideWindow
            ? windowNote
            : `${severity}: ${workflowPhrase(base.impact)} via ${driving.length} confirmed path(s). Suggested edges are not counted.`,
    },
  ];
  return {
    ...base,
    title: `Projected ${formatCents(p.shortfallCents)} funding shortfall for ${base.vendorName}`,
    evaluation: {
      category: "PROJECTED_SHORTFALL",
      severity,
      confidence,
      reasons,
      assertion: {
        assertionId,
        claim: `Projected ${formatCents(p.shortfallCents)} funding shortfall for ${base.vendorName} charge due ${day(p.expectedAt)} (${workflowPhrase(base.impact)})`,
        status: "DERIVED",
        ruleId: SHORTFALL_RULE_ID,
        inputs,
        evaluatedAt: iso(input.now),
        amountCents: p.shortfallCents,
        limitations: [
          ...link.limitations,
          ...(outsideWindow ? [windowNote] : []),
          ...syntheticLimitations(inputs, ctx.evidenceById),
          "Potential interruption risk only: whether the vendor would suspend service is unknown.",
          ...p.assumptions,
          ...(base.impact.complete ? [] : ["Dependency traversal hit a size/depth bound; impact may be incomplete."]),
        ],
      },
      requestedMappings,
    },
  };
}

function declineFinding(input: RiskInput, t: Transaction, ctx: Ctx): RiskFinding {
  const vendorName = ctx.vendorById.get(t.vendorId)?.name ?? t.vendorId;
  const impact = impactFor(input.graph, ctx.nodeIds, t.vendorId, t.fundingSourceId);
  const g = graphSeverity(impact, null);
  const severity = g.severity === "LOW" ? "MEDIUM" : g.severity;
  const drivingRefs = drivingPaths(impact, g.drivingCriticalities);
  const driving = drivingRefs.map((x) => x.pathId);
  const link = paymentLinkCaveat(impact, t.fundingSourceId, vendorName, t.fundingSourceId ? (ctx.fundName.get(t.fundingSourceId) ?? null) : null);
  const confidence = severity === "UNKNOWN" ? "UNKNOWN" : capConfidence(pathConfidence(input.graph, drivingRefs), impact);
  const vendorEvidence = ctx.vendorById.get(t.vendorId)?.evidenceId;
  const inputs = evidenceInputs(
    input.graph,
    [`evidence:${t.evidenceId}`, ...(vendorEvidence ? [`evidence:${vendorEvidence}`] : [])],
    impact,
  );
  const synthetic = ctx.evidenceById.get(t.evidenceId)?.classification === "DEMO_FIXTURE";
  const reasonNote = t.reason
    ? synthetic
      ? `Decline reason "${t.reason}" is local demo terminology, not a verified Ramp enum.`
      : `Decline reason "${t.reason}" is recorded as reported by the source.`
    : "No decline reason was recorded.";
  return {
    incidentKey: `transaction:${t.id}`,
    subject: { type: "TRANSACTION", id: t.id },
    vendorId: t.vendorId,
    vendorName,
    fundingSourceId: t.fundingSourceId,
    impact,
    projection: null,
    transaction: t,
    title: `Observed transaction decline: ${vendorName} ${formatCents(t.amountCents)}`,
    evaluation: {
      category: "OBSERVED_DECLINE",
      severity,
      confidence,
      reasons: [
        {
          riskRuleId: OBSERVED_DECLINE_RULE_ID,
          thresholdDays: null,
          amountCents: t.amountCents,
          daysUntil: Math.floor((new Date(t.occurredAt).getTime() - input.now.getTime()) / DAY_MS),
          confirmedImpactedPathIds: impact.confirmedPathIds,
          detail: `${vendorName} charge of ${formatCents(t.amountCents)} was declined on ${day(t.occurredAt)}.${t.reason ? ` Reason: ${t.reason}.` : ""}`,
        },
        {
          riskRuleId: RISK_SEVERITY_RULE_ID,
          thresholdDays: null,
          amountCents: t.amountCents,
          daysUntil: null,
          confirmedImpactedPathIds: driving,
          detail:
            severity === "UNKNOWN"
              ? "No confirmed dependency path from this vendor; severity cannot be scored."
              : `${severity}: ${workflowPhrase(impact)} via ${driving.length} confirmed path(s), pending vendor service-status confirmation.`,
        },
      ],
      assertion: {
        assertionId: `risk-transaction-${t.id}`,
        claim: `Observed transaction decline for ${vendorName} (${formatCents(t.amountCents)} on ${day(t.occurredAt)}); ${workflowPhrase(impact)}`,
        status: "DERIVED",
        ruleId: OBSERVED_DECLINE_RULE_ID,
        inputs,
        evaluatedAt: iso(input.now),
        amountCents: t.amountCents,
        limitations: [
          "Observed transaction decline; vendor service impact unconfirmed. This is not a confirmed outage.",
          reasonNote,
          ...link.limitations,
          ...syntheticLimitations(inputs, ctx.evidenceById),
        ],
      },
      requestedMappings: [
        ...(severity === "UNKNOWN" ? [`Map which services and workflows depend on ${vendorName} (no confirmed dependency path).`] : []),
        ...link.requestedMappings,
      ],
    },
  };
}

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, UNKNOWN: 3, LOW: 4 };

/**
 * Evaluate every upcoming charge and every recent observed decline.
 * Ordered by severity (CRITICAL, HIGH, MEDIUM, UNKNOWN, LOW), then incidentKey.
 */
export function evaluateRisk(input: RiskInput): RiskFinding[] {
  const nowMs = input.now.getTime();
  const declines = input.transactions.filter((t) => {
    const at = new Date(t.occurredAt).getTime();
    return t.state === "DECLINED" && at <= nowMs && at >= nowMs - DECLINE_WINDOW_DAYS * DAY_MS;
  });
  const ctx: Ctx = {
    vendorById: new Map(input.vendors.map((v) => [v.id, v])),
    fundName: new Map(input.fundingSources.map((f) => [f.id, f.name])),
    nodeIds: new Set(input.graph.nodes.map((n) => n.id)),
    declinedVendorIds: new Set(declines.map((t) => t.vendorId)),
    evidenceById: new Map(input.evidence.map((e) => [e.id, e])),
  };
  const projections = projectCharges({
    charges: input.charges,
    vendors: input.vendors,
    fundingSources: input.fundingSources,
    now: input.now,
  });
  const findings = [
    ...projections.map((p) => chargeFinding(input, p, ctx)).filter((f): f is RiskFinding => f !== null),
    ...declines.map((t) => declineFinding(input, t, ctx)),
  ];
  return findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.evaluation.severity] - SEVERITY_ORDER[b.evaluation.severity] || a.incidentKey.localeCompare(b.incidentKey),
  );
}
