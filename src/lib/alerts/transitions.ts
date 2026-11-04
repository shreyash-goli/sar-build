/**
 * Material risk transitions -> ONE in-app alert each (FS-20). Server-only (writes via repositories).
 *
 * Material transitions (classifyTransition, pure):
 *   CREATED       a new incident that is risky (severity not LOW); a new healthy LOW subject is not alerted
 *   RESOLVED      status moved to RESOLVED (risk cleared, or subject no longer evaluated)
 *   REOPENED      a RESOLVED incident is no longer resolved (checked before severity, so a risk
 *                 returning at the SAME severity/category is never silent)
 *   ESCALATED     severity rose      (LOW < UNKNOWN < MEDIUM < HIGH < CRITICAL)
 *   DEESCALATED   severity fell, still unresolved
 *   RECLASSIFIED  same severity, different risk category
 * Amount-only or date-only changes are not material and create no alert.
 *
 * Idempotency: transitions are computed against the PERSISTED incident, so evaluating the
 * same input twice finds no change the second time and creates nothing. The unique
 * alertKey (incident:kind:fromFingerprint->toFingerprint#occurrence) additionally guards
 * against a double insert. Alerts are never sent anywhere: in-app only.
 */
import { randomUUID } from "node:crypto";
import type { Repositories } from "@/lib/repositories";
import type { IncidentStatus, RiskCategory, Severity } from "@/lib/schema";
import { SEVERITY_ESCALATION_RANK } from "@/lib/incidents/status";
import type { Alert, AlertKind } from "./schema";

export type RiskState = {
  status: IncidentStatus;
  severity: Severity;
  category: RiskCategory | null;
  fingerprint: string | null;
};

export function classifyTransition(prev: RiskState | null, next: RiskState): AlertKind | null {
  if (prev === null) return next.severity === "LOW" ? null : "CREATED";
  if (next.status === "RESOLVED") return prev.status === "RESOLVED" ? null : "RESOLVED";
  if (prev.status === "RESOLVED") return "REOPENED";
  const up = SEVERITY_ESCALATION_RANK[next.severity] - SEVERITY_ESCALATION_RANK[prev.severity];
  if (up > 0) return "ESCALATED";
  if (up < 0) return "DEESCALATED";
  if (prev.category !== next.category) return "RECLASSIFIED";
  return null;
}

const article = (word: string) => (/^[AEIOU]/i.test(word) ? "an" : "a");
const label = (c: RiskCategory | null) => (c ? c.toLowerCase().replace(/_/g, " ") : "unknown category");

function text(kind: AlertKind, title: string, prev: RiskState | null, next: RiskState): { title: string; message: string } {
  switch (kind) {
    case "CREATED":
      return { title: `New ${next.severity} risk: ${title}`, message: `The risk engine opened ${article(next.severity)} ${next.severity}-severity incident: ${label(next.category)}.` };
    case "REOPENED":
      return {
        title: `Risk returned (${next.severity}): ${title}`,
        message: `A resolved incident is open again at ${next.severity}${prev!.severity !== next.severity ? ` (was ${prev!.severity} when resolved)` : ""}.`,
      };
    case "ESCALATED":
      return { title: `Risk escalated ${prev!.severity} → ${next.severity}: ${title}`, message: `Severity rose from ${prev!.severity} to ${next.severity}.` };
    case "DEESCALATED":
      return { title: `Risk lowered ${prev!.severity} → ${next.severity}: ${title}`, message: `Severity fell from ${prev!.severity} to ${next.severity}; the incident is still open.` };
    case "RECLASSIFIED":
      return { title: `Risk reclassified: ${title}`, message: `Category changed from ${label(prev!.category)} to ${label(next.category)} at ${next.severity}.` };
    case "RESOLVED":
      return { title: `Risk resolved: ${title}`, message: `The incident is resolved (was ${prev!.severity}).` };
  }
}

export type RecordAlertInput = {
  incidentId: string;
  incidentTitle: string;
  /** Title before this evaluation; a RESOLVED alert names what was resolved. */
  previousTitle: string | null;
  ruleId: string;
  owner: string | null;
  prev: RiskState | null;
  next: RiskState;
  at: string;
};

/** Create the alert for a material transition, or nothing. Call inside the risk engine's transaction. */
export async function recordAlertForTransition(repos: Repositories, input: RecordAlertInput): Promise<Alert | null> {
  const kind = classifyTransition(input.prev, input.next);
  if (kind === null) return null;
  const fp = (x: string | null | undefined) => (x ?? "none").slice(0, 16);
  const base = `${input.incidentId}:${kind}:${fp(input.prev?.fingerprint)}->${fp(input.next.fingerprint)}`;
  const occurrence = (await repos.alerts.listByIncident(input.incidentId)).filter((a) => a.alertKey.startsWith(`${base}#`)).length + 1;
  const alertKey = `${base}#${occurrence}`;
  if (await repos.alerts.findByAlertKey(alertKey)) return null;
  const t = text(kind, kind === "RESOLVED" ? (input.previousTitle ?? input.incidentTitle) : input.incidentTitle, input.prev, input.next);
  return repos.alerts.create({
    id: `alert-${randomUUID()}`,
    alertKey,
    seq: (await repos.alerts.maxSeq()) + 1,
    incidentId: input.incidentId,
    kind,
    severity: input.next.severity,
    previousSeverity: input.prev?.severity ?? null,
    category: input.next.category,
    previousCategory: input.prev?.category ?? null,
    title: t.title,
    message: t.message,
    source: `risk-engine:${input.ruleId}`,
    owner: input.owner,
    link: `/incidents/${input.incidentId}`,
    fromFingerprint: input.prev?.fingerprint ?? null,
    toFingerprint: input.next.fingerprint,
    createdAt: input.at,
    status: "OPEN",
    acknowledgedBy: null,
    acknowledgedAt: null,
    snoozedUntil: null,
    snoozedBy: null,
  });
}
