/**
 * Parse a user-typed dollar amount into integer cents without floating point.
 * Accepts "600", "600.5", "600.50", "$1,250.00". Rejects negatives, zero,
 * more than 2 decimals, and anything non-numeric.
 */
export type ParsedDollars = { ok: true; cents: number } | { ok: false; message: string };

const MAX_DOLLARS_DIGITS = 9; // < $1,000,000,000

export function parseDollarsToCents(input: string): ParsedDollars {
  const raw = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (raw === "") return { ok: false, message: "Enter an amount in dollars." };
  const m = new RegExp(`^(\\d{1,${MAX_DOLLARS_DIGITS}})(?:\\.(\\d{1,2}))?$`).exec(raw);
  if (!m) {
    return { ok: false, message: "Use a positive dollar amount with at most 2 decimals, e.g. 600 or 600.50." };
  }
  const whole = Number.parseInt(m[1]!, 10);
  const frac = Number.parseInt((m[2] ?? "").padEnd(2, "0") || "0", 10);
  const cents = whole * 100 + frac;
  if (cents <= 0) return { ok: false, message: "The amount must be greater than $0." };
  return { ok: true, cents };
}
