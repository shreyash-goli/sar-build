/** Pure display helpers for the Overview. Client- and server-safe. */
import type { BadgeProps } from "@/components/ui/badge";
import type { ConfidenceTier, RiskCategory, Severity } from "@/lib/schema/enums";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

export const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  UNKNOWN: "Unknown",
};

/** Severity is a status: always shown with its text label, never colour alone. */
export const SEVERITY_VARIANT: Readonly<Record<Severity, BadgeVariant>> = {
  CRITICAL: "danger",
  HIGH: "warning",
  MEDIUM: "accent",
  LOW: "success",
  UNKNOWN: "neutral",
};

export const CATEGORY_LABEL: Readonly<Record<RiskCategory, string>> = {
  PROJECTED_SHORTFALL: "Projected shortfall",
  OBSERVED_DECLINE: "Observed decline",
  UNKNOWN_DATA: "Needs mapping",
  NO_RISK: "No risk found",
};

export const CONFIDENCE_LABEL: Readonly<Record<ConfidenceTier, string>> = {
  HIGH: "High confidence",
  MEDIUM: "Medium confidence",
  LOW: "Low confidence",
  UNKNOWN: "Confidence unknown",
};

/** "17 Nov 2026" in UTC, deterministic. */
export function formatDayUtc(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** Relative due label from engine-computed whole days (relative to the demo clock). */
export function dueLabel(dueInDays: number | null): string | null {
  if (dueInDays === null) return null;
  if (dueInDays === 0) return "Due today";
  if (dueInDays === 1) return "Due tomorrow";
  if (dueInDays > 1) return `Due in ${dueInDays} days`;
  return `${Math.abs(dueInDays)} ${Math.abs(dueInDays) === 1 ? "day" : "days"} overdue`;
}

/** Graph deep link for a node (see /graph ?node=). */
export function graphHref(nodeId: string): string {
  return `/graph?node=${encodeURIComponent(nodeId)}`;
}

/** Graph node id for a vendor record (backend convention: node-<entityId>). */
export function vendorNodeId(vendorId: string): string {
  return `node-${vendorId}`;
}
