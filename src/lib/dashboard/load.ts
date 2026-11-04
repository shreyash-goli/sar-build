/**
 * Server-only Overview loader (FS-12). Derives every number from the incidents
 * materialized by the risk engine (src/lib/incidents) and from stored records.
 * Nothing is hardcoded; unknown amounts are never summed as 0.
 * "Active" = incident status other than RESOLVED.
 * "Alert" = active, status OPEN or ACKNOWLEDGED, and severity not LOW. Only
 * alerts feed the metrics and the exposure list: MONITORING / LOW rows (healthy
 * vendors, or a known shortfall outside the 14-day window) are never counted.
 */
import * as z from "zod";
import { isDemoModeEnabled } from "@/lib/env";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { RepositoryError, type Repositories } from "@/lib/repositories";
import {
  Criticality,
  RiskEvaluationSchema,
  SourceClass,
  type Incident,
  type Severity,
} from "@/lib/schema";
import { METRIC_DEFINITIONS, type DashboardData, type DashboardExposure } from "./schema";

type Env = Readonly<Record<string, string | undefined>>;

/** The parts of IncidentSnapshot the overview reads (validated; anything else is ignored). */
const SnapshotView = z.looseObject({
  evaluation: RiskEvaluationSchema,
  impact: z.looseObject({
    confirmedPathIds: z.array(z.string()),
    confirmedWorkflows: z.array(z.looseObject({ nodeId: z.string(), label: z.string(), criticality: Criticality })),
  }),
  projection: z
    .looseObject({
      status: z.string(),
      vendorId: z.string().optional(),
      shortfallCents: z.int().nullable().optional(),
      marginCents: z.int().nullable().optional(),
      dueInDays: z.int().nullable().optional(),
      expectedAt: z.string().nullable().optional(),
    })
    .nullable(),
  transaction: z.looseObject({ vendorId: z.string(), occurredAt: z.string(), amountCents: z.int() }).nullable(),
});
type View = z.infer<typeof SnapshotView>;

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, UNKNOWN: 3, LOW: 4 };
const CRIT_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 } as const;
const SCORED_SEVERITIES = new Set<Severity>(["CRITICAL", "HIGH", "MEDIUM"]);
const UPCOMING = new Set(["SCHEDULED", "FORECAST", "RESCHEDULED"] as const);

const maxIso = (xs: readonly string[]): string | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => (new Date(b).getTime() > new Date(a).getTime() ? b : a));
const canonical = (s: string | null) => (s === null ? null : new Date(s).toISOString().replace(".000Z", "Z"));

export async function buildDashboardData(repos: Repositories, env: Env = process.env): Promise<DashboardData> {
  const [workspaces, incidents, vendors, charges, transactions, funds, evidence] = await Promise.all([
    repos.workspaces.list(),
    repos.incidents.list(),
    repos.vendors.list(),
    repos.vendorCharges.list(),
    repos.transactions.list(),
    repos.fundingSources.list(),
    repos.evidence.list(),
  ]);

  const workspaceMode = workspaces[0]?.mode ?? (isDemoModeEnabled(env) ? "DEMO" : null);
  if (workspaceMode === null) throw new RepositoryError("NOT_CONFIGURED", "No workspace is configured. Run `pnpm db:seed` in demo mode.");

  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  const unreadableIncidentIds: string[] = [];
  const active: { inc: Incident; view: View; vendorId: string | null }[] = [];
  for (const inc of incidents) {
    if (inc.status === "RESOLVED") continue;
    const parsed = SnapshotView.safeParse(inc.snapshotJson);
    if (!parsed.success) {
      unreadableIncidentIds.push(inc.id);
      continue;
    }
    const v = parsed.data;
    active.push({ inc, view: v, vendorId: inc.primaryVendorId ?? v.projection?.vendorId ?? v.transaction?.vendorId ?? null });
  }

  // --- metrics (alerts only) ---
  const alerts = active.filter(
    (a) => (a.inc.status === "OPEN" || a.inc.status === "ACKNOWLEDGED") && a.view.evaluation.severity !== "LOW",
  );
  const scored = alerts.filter((a) => SCORED_SEVERITIES.has(a.view.evaluation.severity));
  const workflowIds = [...new Set(scored.flatMap((a) => a.view.impact.confirmedWorkflows.map((w) => w.nodeId)))].sort();
  const exposuresActive = alerts.filter((a) => ["PROJECTED_SHORTFALL", "OBSERVED_DECLINE"].includes(a.view.evaluation.category));
  const shortfalls = alerts.filter((a) => a.view.evaluation.category === "PROJECTED_SHORTFALL");
  const knownShortfalls = shortfalls.filter((a) => typeof a.view.projection?.shortfallCents === "number");
  const unknownExposures = [
    ...alerts.filter((a) => a.view.evaluation.category === "UNKNOWN_DATA"),
    ...shortfalls.filter((a) => typeof a.view.projection?.shortfallCents !== "number"),
  ];
  let knownCents = 0;
  for (const a of knownShortfalls) {
    knownCents += a.view.projection!.shortfallCents!;
    if (!Number.isSafeInteger(knownCents)) throw new RangeError("potential shortfall exceeds the safe-integer range");
  }

  // --- exposures and healthy ---
  const exposures: DashboardExposure[] = alerts
    .filter((a) => a.view.evaluation.category !== "NO_RISK")
    .map(({ inc, view, vendorId }) => {
      const cat = view.evaluation.category;
      const amountCents =
        cat === "PROJECTED_SHORTFALL"
          ? (view.projection?.shortfallCents ?? null)
          : cat === "OBSERVED_DECLINE"
            ? (view.transaction?.amountCents ?? null)
            : null;
      return {
        incidentId: inc.id,
        incidentKey: inc.scenarioKey ?? inc.id,
        title: inc.title,
        category: cat,
        severity: view.evaluation.severity,
        confidence: view.evaluation.confidence,
        status: inc.status,
        vendorId,
        vendorName: (vendorId && vendorName.get(vendorId)) || vendorId || "Unknown vendor",
        amountCents,
        dueInDays: cat === "OBSERVED_DECLINE" ? null : (view.projection?.dueInDays ?? null),
        at: canonical(cat === "OBSERVED_DECLINE" ? (view.transaction?.occurredAt ?? null) : (view.projection?.expectedAt ?? null)),
        topWorkflow: view.impact.confirmedWorkflows[0]
          ? {
              nodeId: view.impact.confirmedWorkflows[0].nodeId,
              label: view.impact.confirmedWorkflows[0].label,
              criticality: view.impact.confirmedWorkflows[0].criticality,
            }
          : null,
        confirmedPathCount: view.impact.confirmedPathIds.length,
      };
    })
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        (a.dueInDays ?? Number.POSITIVE_INFINITY) - (b.dueInDays ?? Number.POSITIVE_INFINITY) ||
        a.incidentId.localeCompare(b.incidentId),
    );

  const healthy = active
    .filter((a) => a.view.evaluation.category === "NO_RISK")
    .map(({ inc, view, vendorId }) => ({
      incidentId: inc.id,
      vendorId,
      vendorName: (vendorId && vendorName.get(vendorId)) || vendorId || "Unknown vendor",
      marginCents: view.projection?.marginCents ?? null,
      dueInDays: view.projection?.dueInDays ?? null,
    }))
    .sort((a, b) => a.incidentId.localeCompare(b.incidentId));

  // --- top impacted workflows (confirmed, scored incidents only) ---
  const wf = new Map<string, { nodeId: string; label: string; criticality: z.infer<typeof Criticality>; worstSeverity: Severity; incidentIds: string[] }>();
  for (const { inc, view } of scored) {
    for (const w of view.impact.confirmedWorkflows) {
      const cur = wf.get(w.nodeId);
      if (!cur) wf.set(w.nodeId, { nodeId: w.nodeId, label: w.label, criticality: w.criticality, worstSeverity: view.evaluation.severity, incidentIds: [inc.id] });
      else {
        cur.incidentIds.push(inc.id);
        if (SEVERITY_ORDER[view.evaluation.severity] < SEVERITY_ORDER[cur.worstSeverity]) cur.worstSeverity = view.evaluation.severity;
      }
    }
  }
  const topImpactedWorkflows = [...wf.values()]
    .map((w) => ({ ...w, incidentIds: [...w.incidentIds].sort() }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.worstSeverity] - SEVERITY_ORDER[b.worstSeverity] ||
        CRIT_ORDER[a.criticality] - CRIT_ORDER[b.criticality] ||
        a.label.localeCompare(b.label),
    );

  // --- forecast series ---
  const forecast = vendors.map((v) => ({
    vendorId: v.id,
    vendorName: v.name,
    points: [
      ...transactions
        .filter((t) => t.vendorId === v.id && t.state === "CLEARED" && t.amountCents > 0)
        .map((t) => ({ at: t.occurredAt, amountCents: t.amountCents, kind: "CLEARED" as const, sourceId: t.id })),
      ...charges
        .filter((c) => c.vendorId === v.id && UPCOMING.has(c.status as "SCHEDULED"))
        .map((c) => ({ at: c.expectedAt, amountCents: c.expectedCents, kind: c.status as "SCHEDULED" | "FORECAST" | "RESCHEDULED", sourceId: c.id })),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.sourceId.localeCompare(b.sourceId)),
  }));

  // --- freshness ---
  const sourceEvidence = evidence.filter((e) => e.kind !== "RULE");
  const byClassification = Object.fromEntries(SourceClass.options.map((c) => [c, 0])) as Record<z.infer<typeof SourceClass>, number>;
  for (const e of sourceEvidence) byClassification[e.classification] += 1;

  return {
    workspaceMode,
    lastChangedAt: maxIso(incidents.map((i) => i.updatedAt)),
    resultsEvaluatedAt: maxIso(
      incidents
        .map((i) => (i.snapshotJson as { evaluation?: { assertion?: { evaluatedAt?: unknown } } } | null)?.evaluation?.assertion?.evaluatedAt)
        .filter((x): x is string => typeof x === "string"),
    ),
    metrics: {
      atRiskWorkflows: { value: workflowIds.length, workflowIds, definition: METRIC_DEFINITIONS.atRiskWorkflows },
      unresolvedExposures: {
        value: exposuresActive.length,
        incidentIds: exposuresActive.map((a) => a.inc.id).sort(),
        definition: METRIC_DEFINITIONS.unresolvedExposures,
      },
      potentialShortfall: {
        knownCents,
        incidentIds: knownShortfalls.map((a) => a.inc.id).sort(),
        unknownCount: unknownExposures.length,
        unknownIncidentIds: unknownExposures.map((a) => a.inc.id).sort(),
        definition: METRIC_DEFINITIONS.potentialShortfall,
      },
    },
    exposures,
    healthy,
    topImpactedWorkflows,
    forecast,
    freshness: {
      latestSourceCapturedAt: maxIso(sourceEvidence.map((e) => e.capturedAt)),
      latestFundObservedAt: maxIso(funds.map((f) => f.observedAt)),
      sourceEvidenceCount: sourceEvidence.length,
      byClassification,
    },
    unreadableIncidentIds,
  };
}

/** Server-component convenience: the Overview from the app DB (read-only). */
export function loadDashboard(env: Env = process.env): Promise<DashboardData> {
  return buildDashboardData(createReadOnlyRepositories(), env);
}
