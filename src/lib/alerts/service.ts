/**
 * Alert reads and demo actions (FS-20). Server-only.
 * - displayState: ACKNOWLEDGED, SNOOZED (snoozedUntil after `now`), else ACTIVE.
 * - ack / snooze are write-gated by the caller's repositories and audited
 *   ("alert.acknowledged" / "alert.snoozed", subject = alert id). Repeating the same
 *   ack, or the same snooze-until, is idempotent (no new audit event).
 * Nothing here sends a notification anywhere.
 */
import { randomUUID } from "node:crypto";
import { NotFoundError, RepositoryError, type Repositories } from "@/lib/repositories";
import {
  ALERT_CHANNEL_NOTICE,
  MAX_SNOOZE_DAYS,
  type Alert,
  type AlertListData,
  type AlertListQuery,
  type AlertResponseData,
  type AlertView,
} from "./schema";

const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");
const DAY_MS = 86_400_000;

export function toAlertView(a: Alert, now: Date): AlertView {
  const displayState =
    a.status === "ACKNOWLEDGED"
      ? "ACKNOWLEDGED"
      : a.snoozedUntil !== null && new Date(a.snoozedUntil).getTime() > now.getTime()
        ? "SNOOZED"
        : "ACTIVE";
  return { ...a, displayState, channel: "IN_APP", notice: ALERT_CHANNEL_NOTICE };
}

export async function buildAlertList(
  repos: Repositories,
  query: AlertListQuery,
  now: Date,
  clockFrozen = false,
): Promise<AlertListData> {
  const rows = query.incidentId ? await repos.alerts.listByIncident(query.incidentId) : await repos.alerts.list();
  const views = rows.map((a) => toAlertView(a, now)); // seq desc = newest first
  const count = (s: AlertView["displayState"]) => views.filter((v) => v.displayState === s).length;
  return {
    alerts: (query.view ?? "active") === "active" ? views.filter((v) => v.displayState === "ACTIVE") : views,
    counts: { active: count("ACTIVE"), snoozed: count("SNOOZED"), acknowledged: count("ACKNOWLEDGED"), total: views.length },
    asOf: iso(now),
    clockFrozen,
    snoozeHint:
      clockFrozen && count("SNOOZED") > 0
        ? `The demo clock is fixed at ${iso(now)}, so snoozed alerts stay hidden until DEMO_NOW is moved past their snooze time or the demo is reset.`
        : null,
    notice: ALERT_CHANNEL_NOTICE,
  };
}

async function audit(repos: Repositories, a: Alert, action: string, actor: string, details: Record<string, unknown>, now: Date) {
  const e = await repos.auditEvents.create({
    id: `audit-${randomUUID()}`,
    actor,
    action,
    subjectId: a.id,
    detailsJson: JSON.parse(JSON.stringify({ alertId: a.id, incidentId: a.incidentId, notice: ALERT_CHANNEL_NOTICE, ...details })) as never,
    at: iso(now),
  });
  return e.id;
}

export async function ackAlert(repos: Repositories, id: string, actor: string, now: Date): Promise<AlertResponseData> {
  const a = await repos.alerts.findById(id);
  if (!a) throw new NotFoundError("Alert", id);
  if (a.status === "ACKNOWLEDGED") {
    return { alert: toAlertView(a, now), auditEventId: null, idempotent: true, notice: ALERT_CHANNEL_NOTICE };
  }
  const updated = await repos.alerts.update(id, { status: "ACKNOWLEDGED", acknowledgedBy: actor, acknowledgedAt: iso(now) });
  const auditEventId = await audit(repos, updated, "alert.acknowledged", actor, {}, now);
  return { alert: toAlertView(updated, now), auditEventId, idempotent: false, notice: ALERT_CHANNEL_NOTICE };
}

export async function snoozeAlert(
  repos: Repositories,
  id: string,
  req: { actor: string; until: string },
  now: Date,
): Promise<AlertResponseData> {
  const a = await repos.alerts.findById(id);
  if (!a) throw new NotFoundError("Alert", id);
  const until = new Date(req.until);
  if (until.getTime() <= now.getTime()) {
    throw new RepositoryError("BAD_REQUEST", `Snooze until must be after the current time (${iso(now)})`, { field: "until" });
  }
  if (until.getTime() > now.getTime() + MAX_SNOOZE_DAYS * DAY_MS) {
    throw new RepositoryError("BAD_REQUEST", `Snooze is limited to ${MAX_SNOOZE_DAYS} days`, { field: "until" });
  }
  if (a.status === "ACKNOWLEDGED") {
    throw new RepositoryError("INVALID_TRANSITION", "An acknowledged alert cannot be snoozed", { status: a.status });
  }
  if (a.snoozedUntil === iso(until)) {
    return { alert: toAlertView(a, now), auditEventId: null, idempotent: true, notice: ALERT_CHANNEL_NOTICE };
  }
  const updated = await repos.alerts.update(id, { snoozedUntil: iso(until), snoozedBy: req.actor });
  const auditEventId = await audit(repos, updated, "alert.snoozed", req.actor, { snoozedUntil: iso(until), previousSnoozedUntil: a.snoozedUntil }, now);
  return { alert: toAlertView(updated, now), auditEventId, idempotent: false, notice: ALERT_CHANNEL_NOTICE };
}
