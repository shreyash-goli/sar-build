import type { RiskCategory } from "@/lib/schema/enums";
import { formatCents } from "@/lib/schema/money";

export type AmountDisplay = { text: string; tone: "default" | "healthy" | "unknown" };

/**
 * One honest amount label for an incident:
 * - NO_RISK: "No shortfall" (+ "· $X headroom" when the margin is known). Never "Unknown".
 * - known amount: the formatted amount.
 * - otherwise (UNKNOWN_DATA, or a genuinely missing value): "Unknown". Never "$0".
 */
export function incidentAmountDisplay(
  incident: { category: RiskCategory; amountCents: number | null },
  marginCents?: number | null,
): AmountDisplay {
  if (incident.category === "NO_RISK") {
    return {
      text: typeof marginCents === "number" ? `No shortfall · ${formatCents(marginCents)} headroom` : "No shortfall",
      tone: "healthy",
    };
  }
  if (incident.amountCents === null) return { text: "Unknown", tone: "unknown" };
  return { text: formatCents(incident.amountCents), tone: "default" };
}

export const AMOUNT_TONE_CLASS: Readonly<Record<AmountDisplay["tone"], string>> = {
  default: "text-foreground",
  healthy: "text-success",
  unknown: "text-warning",
};
