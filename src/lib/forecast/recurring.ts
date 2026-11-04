/**
 * Recurring-charge suggestions from transaction history (blueprint Section 5).
 * Pure and deterministic. Output is a MODEL_SUGGESTED, unreviewed hypothesis,
 * never a scheduled charge or a fact.
 *
 * Rules:
 * - Group by vendorId AND fundingSourceId. Transactions without a funding
 *   source are reported as UNKNOWN (payment method is never inferred).
 * - Only VERIFIED charges count: CLEARED, positive amount, AND the
 *   transaction's own evidence record exists and is neither REJECTED nor
 *   MODEL_SUGGESTED. Refunds, reversals, declines, pending, non-positive
 *   amounts and unverifiable evidence are excluded (with a reason).
 * - At least 3 qualifying charges are required.
 * - If the projected next date is already before `now`, the history is stale:
 *   UNKNOWN (STALE_HISTORY). Schedules are never silently rolled forward.
 * - Cadence must be regular (every gap weekly, monthly, quarterly or yearly
 *   within tolerance); otherwise UNKNOWN (IRREGULAR_CADENCE).
 * - Point estimate = median positive amount (even count: floor of the mean of
 *   the two middle values, integer cents). Range is reported as uncertainty;
 *   no statistical calibration is claimed.
 */
import type { EvidenceRecord, Transaction } from "@/lib/schema";
import { DAY_MS } from "./period";

export const RECURRING_CHARGE_RULE_ID = "recurring-charge-suggestion-v1";
export const MIN_RECURRING_SAMPLES = 3;

/** UI label for suggestions: deterministic rule output, not AI. */
export const RECURRING_SUGGESTION_DISPLAY_LABEL = "Suggested from history (rule recurring-charge-suggestion-v1)" as const;

export type Cadence = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

/** Inclusive gap tolerances in days. */
const CADENCE_GAPS: Readonly<Record<Cadence, readonly [number, number]>> = {
  WEEKLY: [6, 8],
  MONTHLY: [27, 32],
  QUARTERLY: [88, 93],
  YEARLY: [360, 370],
};

type GroupRef = {
  ruleId: typeof RECURRING_CHARGE_RULE_ID;
  vendorId: string;
  fundingSourceId: string | null;
  /** Qualifying transactions (CLEARED, amount > 0), oldest first. */
  transactionIds: string[];
  /** Excluded transactions (refund/reversal/decline/pending/non-positive), with reason. */
  excluded: { transactionId: string; reason: string }[];
  evidenceIds: string[];
  inputs: string[];
};

export type RecurringSuggestion = GroupRef & {
  status: "SUGGESTED";
  sourceClass: "MODEL_SUGGESTED";
  reviewStatus: "SUGGESTED";
  /** Render this, not a generic "AI" label: the suggestion comes from a deterministic rule. */
  displayLabel: typeof RECURRING_SUGGESTION_DISPLAY_LABEL;
  fundingSourceId: string;
  cadence: Cadence;
  sampleSize: number;
  medianCents: number;
  uncertainty: {
    amountRangeCents: { min: number; max: number };
    gapDays: { min: number; max: number };
  };
  lastOccurredAt: string;
  nextExpectedAt: string;
  limitations: string[];
};

export type RecurringUnknown = GroupRef & {
  status: "UNKNOWN";
  reason: "INSUFFICIENT_HISTORY" | "IRREGULAR_CADENCE" | "UNATTRIBUTED_FUNDING_SOURCE" | "STALE_HISTORY";
  sampleSize: number;
  detail: string;
};

export type RecurringResult = RecurringSuggestion | RecurringUnknown;

const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");

type EvidenceLookup = ReadonlyMap<string, Pick<EvidenceRecord, "classification" | "verificationStatus">>;

function exclusionReason(t: Transaction, evidence: EvidenceLookup): string | null {
  if (t.state !== "CLEARED") return `state ${t.state}`;
  if (t.amountCents <= 0) return t.amountCents < 0 ? "negative amount (refund/reversal)" : "zero amount";
  const ev = evidence.get(t.evidenceId);
  if (!ev) return `evidence ${t.evidenceId} not found`;
  if (ev.verificationStatus === "REJECTED") return "evidence REJECTED";
  if (ev.classification === "MODEL_SUGGESTED") return "evidence is MODEL_SUGGESTED (not an observed charge)";
  return null;
}

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.floor((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function classifyCadence(gapsDays: readonly number[]): Cadence | null {
  for (const cadence of Object.keys(CADENCE_GAPS) as Cadence[]) {
    const [lo, hi] = CADENCE_GAPS[cadence];
    if (gapsDays.every((g) => g >= lo && g <= hi)) return cadence;
  }
  return null;
}

function addCalendarMonthsUtc(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
}

function nextOccurrence(last: Date, cadence: Cadence): Date {
  switch (cadence) {
    case "WEEKLY":
      return new Date(last.getTime() + 7 * DAY_MS);
    case "MONTHLY":
      return addCalendarMonthsUtc(last, 1);
    case "QUARTERLY":
      return addCalendarMonthsUtc(last, 3);
    case "YEARLY":
      return addCalendarMonthsUtc(last, 12);
  }
}

export type SuggestRecurringInput = {
  transactions: readonly Transaction[];
  /** Evidence records for the transactions (used to require verified charges). */
  evidence: readonly Pick<EvidenceRecord, "id" | "classification" | "verificationStatus">[];
  /** Transactions after `now` are ignored (history only). */
  now: Date;
};

export function suggestRecurringCharges({ transactions, evidence, now }: SuggestRecurringInput): RecurringResult[] {
  const evidenceById: EvidenceLookup = new Map(evidence.map((e) => [e.id, e]));
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (new Date(t.occurredAt).getTime() > now.getTime()) continue;
    const key = `${t.vendorId}\u0000${t.fundingSourceId ?? ""}`;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const results: RecurringResult[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort(
      (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime() || a.id.localeCompare(b.id),
    );
    const qualifying = sorted.filter((t) => exclusionReason(t, evidenceById) === null);
    const excluded = sorted.flatMap((t) => {
      const reason = exclusionReason(t, evidenceById);
      return reason === null ? [] : [{ transactionId: t.id, reason }];
    });
    const evidenceIds = [...new Set(qualifying.map((t) => t.evidenceId))];
    const first = sorted[0]!;
    const ref: GroupRef = {
      ruleId: RECURRING_CHARGE_RULE_ID,
      vendorId: first.vendorId,
      fundingSourceId: first.fundingSourceId,
      transactionIds: qualifying.map((t) => t.id),
      excluded,
      evidenceIds,
      inputs: evidenceIds.map((id) => `evidence:${id}`),
    };

    if (first.fundingSourceId === null) {
      results.push({
        ...ref,
        status: "UNKNOWN",
        reason: "UNATTRIBUTED_FUNDING_SOURCE",
        sampleSize: qualifying.length,
        detail: "Transactions have no funding source; the payment method is not inferred.",
      });
      continue;
    }
    if (qualifying.length < MIN_RECURRING_SAMPLES) {
      results.push({
        ...ref,
        status: "UNKNOWN",
        reason: "INSUFFICIENT_HISTORY",
        sampleSize: qualifying.length,
        detail: `${qualifying.length} qualifying cleared charge(s); at least ${MIN_RECURRING_SAMPLES} are required before suggesting a schedule.`,
      });
      continue;
    }

    const times = qualifying.map((t) => new Date(t.occurredAt).getTime());
    const gaps = times.slice(1).map((t, i) => (t - times[i]!) / DAY_MS);
    const cadence = classifyCadence(gaps);
    if (cadence === null) {
      results.push({
        ...ref,
        status: "UNKNOWN",
        reason: "IRREGULAR_CADENCE",
        sampleSize: qualifying.length,
        detail: `Gaps between charges (${gaps.map((g) => g.toFixed(1)).join(", ")} days) do not match a regular cadence; configure a reviewed schedule instead.`,
      });
      continue;
    }

    const amounts = qualifying.map((t) => t.amountCents).sort((a, b) => a - b);
    const last = new Date(times[times.length - 1]!);
    const next = nextOccurrence(last, cadence);
    if (next.getTime() < now.getTime()) {
      results.push({
        ...ref,
        status: "UNKNOWN",
        reason: "STALE_HISTORY",
        sampleSize: qualifying.length,
        detail: `The ${cadence.toLowerCase()} pattern projects a next charge at ${iso(next)}, which is already past; the history is stale and is not rolled forward.`,
      });
      continue;
    }
    results.push({
      ...ref,
      fundingSourceId: first.fundingSourceId,
      status: "SUGGESTED",
      sourceClass: "MODEL_SUGGESTED",
      reviewStatus: "SUGGESTED",
      displayLabel: RECURRING_SUGGESTION_DISPLAY_LABEL,
      cadence,
      sampleSize: qualifying.length,
      medianCents: median(amounts),
      uncertainty: {
        amountRangeCents: { min: amounts[0]!, max: amounts[amounts.length - 1]! },
        gapDays: { min: Math.min(...gaps), max: Math.max(...gaps) },
      },
      lastOccurredAt: iso(last),
      nextExpectedAt: iso(next),
      limitations: [
        "Suggestion only: not a scheduled charge until a person reviews and configures it.",
        "Generated by a deterministic rule from cleared history, not by an AI model.",
        "Median of past cleared amounts; no statistical calibration is claimed.",
        "Assumes the vendor keeps billing the same funding source on the same cadence.",
      ],
    });
  }

  return results.sort(
    (a, b) => a.vendorId.localeCompare(b.vendorId) || (a.fundingSourceId ?? "").localeCompare(b.fundingSourceId ?? ""),
  );
}
