/**
 * Funding-period semantics (pure). The workspace timezone is not modeled, so a
 * period comparison is only trusted when it gives the SAME answer for every
 * real-world UTC offset from -12:00 to +14:00, sampled every 15 minutes (this
 * covers half- and quarter-hour zones such as +05:30 and +05:45). Otherwise it
 * is ambiguous and the caller must return UNKNOWN rather than guess.
 */
import type { FundingInterval } from "@/lib/schema";

const HOUR = 3_600_000;
export const DAY_MS = 24 * HOUR;

/** UTC offsets (in minutes) sampled for period checks: -12:00 .. +14:00 in 15-minute steps. */
export const PLAUSIBLE_UTC_OFFSETS_MINUTES: readonly number[] = Array.from({ length: (26 * 60) / 15 + 1 }, (_, i) => -12 * 60 + i * 15);

/** Period key for an instant as seen at a fixed UTC offset (minutes). `null` for UNKNOWN interval. */
export function periodKey(instant: Date, interval: FundingInterval, offsetMinutes = 0): string | null {
  const local = new Date(instant.getTime() + offsetMinutes * 60_000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  switch (interval) {
    case "TOTAL":
      return "TOTAL";
    case "YEARLY":
      return `${y}`;
    case "QUARTERLY":
      return `${y}-Q${Math.floor(m / 3) + 1}`;
    case "MONTHLY":
      return `${y}-${String(m + 1).padStart(2, "0")}`;
    case "WEEKLY": {
      // ISO-style week starting Monday: key = date of that Monday.
      const dow = (local.getUTCDay() + 6) % 7;
      const monday = new Date(Date.UTC(y, m, d - dow));
      return `W${monday.toISOString().slice(0, 10)}`;
    }
    case "DAILY":
      return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    case "UNKNOWN":
      return null;
  }
}

export type PeriodComparison =
  | { status: "SAME"; periodKeyUtc: string }
  | { status: "DIFFERENT"; observedPeriodUtc: string; chargePeriodUtc: string }
  | { status: "AMBIGUOUS"; reason: string }
  | { status: "UNKNOWN_INTERVAL" };

/**
 * Is `charge` in the same funding period as `observed` (when availability was read)?
 * SAME / DIFFERENT only when every plausible offset agrees.
 */
export function comparePeriods(observed: Date, charge: Date, interval: FundingInterval): PeriodComparison {
  if (interval === "UNKNOWN") return { status: "UNKNOWN_INTERVAL" };
  const answers = PLAUSIBLE_UTC_OFFSETS_MINUTES.map(
    (o) => periodKey(observed, interval, o) === periodKey(charge, interval, o),
  );
  const observedPeriodUtc = periodKey(observed, interval)!;
  const chargePeriodUtc = periodKey(charge, interval)!;
  if (answers.every(Boolean)) return { status: "SAME", periodKeyUtc: observedPeriodUtc };
  if (answers.every((a) => !a)) return { status: "DIFFERENT", observedPeriodUtc, chargePeriodUtc };
  return {
    status: "AMBIGUOUS",
    reason: `whether the charge falls in the same ${interval.toLowerCase()} period as the availability reading depends on the workspace timezone`,
  };
}

/**
 * Whole 24-hour periods from `now` until `at` (floor). Timezone-independent.
 * Negative when `at` is in the past.
 */
export function daysUntil(now: Date, at: Date): number {
  return Math.floor((at.getTime() - now.getTime()) / DAY_MS);
}
