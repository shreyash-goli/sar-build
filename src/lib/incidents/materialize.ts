/**
 * Incident builder (FS-11). Evaluates the workspace with the pure risk engine
 * and upserts one incident per risk subject, keyed by a stable incidentKey
 * (stored in Incident.scenarioKey, which is unique). Reruns never duplicate
 * incidents (T-13) and, when nothing changed, write nothing at all.
 *
 * Rule lineage: every evaluation is persisted as an append-only DERIVED
 * evidence record (kind RULE). Its ID and sourceId include a fingerprint of
 * the evaluation (excluding evaluatedAt), so an unchanged rerun reuses the
 * same record and a changed result appends a new one; existing evidence is
 * never modified. The incident cites that record (Incident.evidenceId), and
 * snapshotJson holds the full evaluation plus a snapshot of every cited input.
 *
 * Writes go through the repositories, so they pass the caller's write gate.
 * Call inside a transaction (e.g. resetNorthstarDemo) for atomicity.
 */
import { createHash } from "node:crypto";
import type { Repositories } from "@/lib/repositories";
import { RiskEvaluationSchema, type EvidenceRecord, type Incident, type Severity } from "@/lib/schema";
import { evaluateRisk, type RiskFinding } from "@/lib/risk";
import { isEscalation, nextIncidentStatus } from "./status";

export const INCIDENT_SNAPSHOT_VERSION = 1;
export const RISK_ENGINE_SOURCE_SYSTEM = "failsafe-risk-engine";

const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");

function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/** Stable incident row ID for a finding (one per subject). */
export function incidentIdFor(f: Pick<RiskFinding, "subject">): string {
  return `inc-${f.subject.id}`;
}

/** Fingerprint of an evaluation, independent of evaluation time. */
export function evaluationFingerprint(f: RiskFinding): string {
  const { evaluatedAt: _ignored, ...assertion } = f.evaluation.assertion;
  void _ignored;
  return createHash("sha256")
    .update(canonical({ key: f.incidentKey, evaluation: { ...f.evaluation, assertion }, impact: f.impact }))
    .digest("hex");
}

export type EvidenceSnapshotEntry = Pick<
  EvidenceRecord,
  "id" | "kind" | "classification" | "verificationStatus" | "sourceSystem" | "sourceId" | "capturedAt" | "excerpt"
>;

export type IncidentSnapshot = {
  version: typeof INCIDENT_SNAPSHOT_VERSION;
  incidentKey: string;
  subject: RiskFinding["subject"];
  evaluation: RiskFinding["evaluation"];
  impact: RiskFinding["impact"];
  projection: RiskFinding["projection"];
  transaction: RiskFinding["transaction"];
  evidenceSnapshot: EvidenceSnapshotEntry[];
  missingEvidenceIds: string[];
  fingerprint: string;
  resolution: null | "SUBJECT_NO_LONGER_EVALUATED";
  /** Severity before the most recent severity change (null if it never changed). */
  previousSeverity: Severity | null;
  /** True when the most recent severity change was an escalation (it re-opens an ACKNOWLEDGED incident). */
  escalated: boolean;
};

export type MaterializeSummary = {
  evaluatedAt: string;
  findings: number;
  created: string[];
  updated: string[];
  unchanged: string[];
  resolved: string[];
  ruleEvidenceCreated: string[];
};

export async function evaluateWorkspaceRisk(repos: Repositories, now: Date): Promise<RiskFinding[]> {
  const [nodes, edges, vendors, fundingSources, charges, transactions, evidence] = await Promise.all([
    repos.nodes.list(),
    repos.edges.list(),
    repos.vendors.list(),
    repos.fundingSources.list(),
    repos.vendorCharges.list(),
    repos.transactions.list(),
    repos.evidence.list(),
  ]);
  return evaluateRisk({ graph: { nodes, edges }, vendors, fundingSources, charges, transactions, evidence, now });
}

const snapshotEntry = (e: EvidenceRecord): EvidenceSnapshotEntry => ({
  id: e.id,
  kind: e.kind,
  classification: e.classification,
  verificationStatus: e.verificationStatus,
  sourceSystem: e.sourceSystem,
  sourceId: e.sourceId,
  capturedAt: e.capturedAt,
  excerpt: e.excerpt,
});

function sameIncident(a: Incident, b: Incident): boolean {
  const pick = (i: Incident) => ({
    status: i.status,
    severity: i.severity,
    title: i.title,
    primaryVendorId: i.primaryVendorId,
    detectionRule: i.detectionRule,
    snapshotJson: i.snapshotJson,
    evidenceId: i.evidenceId,
  });
  return canonical(pick(a)) === canonical(pick(b));
}

/** Evaluate and upsert incidents. Idempotent for unchanged inputs. */
export async function materializeIncidents(repos: Repositories, now: Date): Promise<MaterializeSummary> {
  const findings = await evaluateWorkspaceRisk(repos, now);
  const evaluatedAt = iso(now);
  const summary: MaterializeSummary = {
    evaluatedAt,
    findings: findings.length,
    created: [],
    updated: [],
    unchanged: [],
    resolved: [],
    ruleEvidenceCreated: [],
  };
  const seenKeys = new Set<string>();

  for (const f of findings) {
    const evaluation = RiskEvaluationSchema.parse(f.evaluation);
    seenKeys.add(f.incidentKey);
    const fingerprint = evaluationFingerprint(f);
    const id = incidentIdFor(f);

    // Append-only rule evidence, reused when the evaluation is unchanged.
    const ruleEvidenceId = `ev-rule-${f.subject.id}-${fingerprint.slice(0, 12)}`;
    if ((await repos.evidence.findById(ruleEvidenceId)) === null) {
      await repos.evidence.create({
        id: ruleEvidenceId,
        kind: "RULE",
        sourceSystem: RISK_ENGINE_SOURCE_SYSTEM,
        sourceId: `${evaluation.assertion.assertionId}#${fingerprint.slice(0, 12)}`,
        capturedAt: evaluatedAt,
        observedAt: null,
        excerpt: `${evaluation.assertion.claim}. Rule ${evaluation.assertion.ruleId}; severity ${evaluation.severity}; confidence ${evaluation.confidence}; ${evaluation.assertion.inputs.length} cited input(s).`,
        path: null,
        contentHash: fingerprint,
        classification: "DERIVED",
        verificationStatus: "UNVERIFIED",
      });
      summary.ruleEvidenceCreated.push(ruleEvidenceId);
    }

    const existing = await repos.incidents.findByScenarioKey(f.incidentKey);
    // Severity history: record the prior severity on change; carry it forward otherwise (idempotent reruns).
    const prevSnap = (existing?.snapshotJson ?? null) as Partial<IncidentSnapshot> | null;
    const changed = existing !== null && existing.severity !== evaluation.severity;
    const previousSeverity: Severity | null = changed ? existing.severity : (prevSnap?.previousSeverity ?? null);
    const escalated = changed ? isEscalation(existing.severity, evaluation.severity) : (prevSnap?.escalated ?? false);

    const inputIds = evaluation.assertion.inputs.map((i) => i.replace(/^evidence:/, ""));
    const found = await repos.evidence.listByIds(inputIds);
    const snapshot: IncidentSnapshot = {
      version: INCIDENT_SNAPSHOT_VERSION,
      incidentKey: f.incidentKey,
      subject: f.subject,
      evaluation,
      impact: f.impact,
      projection: f.projection,
      transaction: f.transaction,
      evidenceSnapshot: found.map(snapshotEntry),
      missingEvidenceIds: inputIds.filter((x) => !found.some((e) => e.id === x)),
      fingerprint,
      resolution: null,
      previousSeverity,
      escalated,
    };

    const next: Incident = {
      id: existing?.id ?? id,
      scenarioKey: f.incidentKey,
      status: nextIncidentStatus(existing?.status ?? null, evaluation.severity, existing?.severity ?? null),
      severity: evaluation.severity,
      title: f.title,
      firstSeenAt: existing?.firstSeenAt ?? evaluatedAt,
      updatedAt: existing?.updatedAt ?? evaluatedAt,
      primaryVendorId: (await repos.vendors.findById(f.vendorId)) ? f.vendorId : null,
      detectionRule: evaluation.assertion.ruleId,
      snapshotJson: JSON.parse(JSON.stringify(snapshot)) as Incident["snapshotJson"],
      evidenceId: ruleEvidenceId,
    };

    if (!existing) {
      await repos.incidents.create(next);
      summary.created.push(next.id);
    } else if (sameIncident(existing, next)) {
      summary.unchanged.push(existing.id);
    } else {
      const { id: _id, ...patch } = { ...next, updatedAt: evaluatedAt };
      void _id;
      await repos.incidents.update(existing.id, patch);
      summary.updated.push(existing.id);
    }
  }

  // Subjects no longer evaluated: resolve, keep history.
  for (const inc of await repos.incidents.list()) {
    if (inc.scenarioKey === null || seenKeys.has(inc.scenarioKey) || inc.status === "RESOLVED") continue;
    const prev = (inc.snapshotJson ?? {}) as Record<string, unknown>;
    await repos.incidents.update(inc.id, {
      status: "RESOLVED",
      updatedAt: evaluatedAt,
      snapshotJson: { ...prev, resolution: "SUBJECT_NO_LONGER_EVALUATED" } as Incident["snapshotJson"],
    });
    summary.resolved.push(inc.id);
  }

  return summary;
}
