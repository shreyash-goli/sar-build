import type { AlertKind } from "@/lib/alerts/schema";

/** Wording rule: in-app alerts are "raised", never "sent", "notified" or "emailed". */
export const ALERT_KIND_LABEL: Readonly<Record<AlertKind, string>> = {
  CREATED: "New risk",
  REOPENED: "Risk returned",
  ESCALATED: "Escalated",
  DEESCALATED: "De-escalated",
  RECLASSIFIED: "Reclassified",
  RESOLVED: "Resolved",
};

export const SNOOZE_OPTIONS = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days" },
] as const;
