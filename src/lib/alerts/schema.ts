/**
 * Client-safe contract for in-app alerts (FS-20).
 *   GET  /api/alerts[?view=active|all][&incidentId=]  -> apiSuccessSchema(AlertListDataSchema)
 *   POST /api/alerts/[id]/ack     AckAlertRequestSchema    -> AlertResponseData
 *   POST /api/alerts/[id]/snooze  SnoozeAlertRequestSchema -> AlertResponseData
 * Alerts are created by the risk engine on material transitions. In-app only: no Slack,
 * email or any external notification is ever sent.
 */
import * as z from "zod";
import { RiskCategory, Severity } from "../schema/enums";
import { IdSchema, IsoDateTimeSchema } from "../schema/primitives";

export const ALERT_CHANNEL_NOTICE = "In-app only: no external notification sent" as const;
export const ALERT_RULE_ID = "alert-transition-v1" as const;
/** Max snooze length under the (demo) clock. */
export const MAX_SNOOZE_DAYS = 30;

export const AlertKind = z.enum(["CREATED", "REOPENED", "ESCALATED", "DEESCALATED", "RECLASSIFIED", "RESOLVED"]);
export type AlertKind = z.infer<typeof AlertKind>;
export const AlertStatus = z.enum(["OPEN", "ACKNOWLEDGED"]);
export type AlertStatus = z.infer<typeof AlertStatus>;

/** Stored alert record (mirrors prisma model Alert). */
export const AlertSchema = z.strictObject({
  id: IdSchema,
  alertKey: z.string().min(1).max(512),
  seq: z.int().positive(),
  incidentId: IdSchema,
  kind: AlertKind,
  severity: Severity,
  previousSeverity: Severity.nullable(),
  category: RiskCategory.nullable(),
  previousCategory: RiskCategory.nullable(),
  title: z.string().min(1),
  message: z.string().min(1),
  /** e.g. "risk-engine:projected-shortfall-v1". */
  source: z.string().min(1),
  owner: z.string().nullable(),
  /** Deep link, always /incidents/<id>. */
  link: z.string().regex(/^\/incidents\/[^/]+$/),
  fromFingerprint: z.string().nullable(),
  toFingerprint: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  status: AlertStatus,
  acknowledgedBy: z.string().nullable(),
  acknowledgedAt: IsoDateTimeSchema.nullable(),
  snoozedUntil: IsoDateTimeSchema.nullable(),
  snoozedBy: z.string().nullable(),
});
export type Alert = z.infer<typeof AlertSchema>;

export const AlertViewSchema = AlertSchema.extend({
  /** "ACTIVE" (shown), "SNOOZED" (hidden until snoozedUntil), "ACKNOWLEDGED". */
  displayState: z.enum(["ACTIVE", "SNOOZED", "ACKNOWLEDGED"]),
  channel: z.literal("IN_APP"),
  notice: z.literal(ALERT_CHANNEL_NOTICE),
});
export type AlertView = z.infer<typeof AlertViewSchema>;

export const AlertListDataSchema = z.strictObject({
  /** Newest first (seq desc). view=active returns only displayState ACTIVE. */
  alerts: z.array(AlertViewSchema),
  counts: z.strictObject({
    active: z.int().nonnegative(),
    snoozed: z.int().nonnegative(),
    acknowledged: z.int().nonnegative(),
    total: z.int().nonnegative(),
  }),
  /** Evaluation clock used for snooze expiry (demo clock in DEMO_MODE). */
  asOf: IsoDateTimeSchema,
  /**
   * True when the clock is the fixed demo clock (DEMO_MODE): time does not advance, so a
   * snooze only expires if DEMO_NOW is moved past snoozedUntil or the demo is reset.
   */
  clockFrozen: z.boolean(),
  /** Human hint for the UI when clockFrozen and something is snoozed; null otherwise. */
  snoozeHint: z.string().nullable(),
  notice: z.literal(ALERT_CHANNEL_NOTICE),
});
export type AlertListData = z.infer<typeof AlertListDataSchema>;

export const AlertListQuerySchema = z.strictObject({
  view: z.enum(["active", "all"]).optional(),
  incidentId: IdSchema.optional(),
});
export type AlertListQuery = z.infer<typeof AlertListQuerySchema>;

const Actor = z.string().trim().min(1, "actor is required").max(80);
export const AckAlertRequestSchema = z.strictObject({ actor: Actor });
export const SnoozeAlertRequestSchema = z.strictObject({
  actor: Actor,
  /** Must be after the current (demo) clock and at most MAX_SNOOZE_DAYS ahead. */
  until: IsoDateTimeSchema,
});

export const AlertResponseDataSchema = z.strictObject({
  alert: AlertViewSchema,
  /** Audit event for this call; null for an idempotent repeat. */
  auditEventId: z.string().nullable(),
  idempotent: z.boolean(),
  notice: z.literal(ALERT_CHANNEL_NOTICE),
});
export type AlertResponseData = z.infer<typeof AlertResponseDataSchema>;
