/**
 * Money: integer minor units (cents, USD-only demo).
 *
 * - Amounts are safe integers. Floats are rejected, never rounded.
 * - Unknown money is `null`. It is NEVER coerced or defaulted to 0.
 * - Arithmetic/comparison involving an unknown operand yields unknown.
 * - Format to dollars only at rendering boundaries via `formatCents`.
 */
import * as z from "zod";

/** Integer cents within the JS safe-integer range (may be negative, e.g. refunds). */
export const CentsSchema = z.int("amount must be integer cents");
/** Integer cents >= 0. */
export const NonNegativeCentsSchema = CentsSchema.nonnegative();
/** Integer cents > 0. */
export const PositiveCentsSchema = CentsSchema.positive();

/** Unknown is explicit `null`; the key must still be present (strict null, no default). */
export const NullableCentsSchema = CentsSchema.nullable();
export const NullableNonNegativeCentsSchema = NonNegativeCentsSchema.nullable();

export type KnownCents = { readonly known: true; readonly cents: number };
export type UnknownCents = { readonly known: false; readonly reason: string | null };
export type Money = KnownCents | UnknownCents;

export const UNKNOWN: UnknownCents = Object.freeze({ known: false, reason: null });

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`Expected safe integer cents, received ${String(cents)}`);
  }
}

export function knownCents(cents: number): KnownCents {
  assertCents(cents);
  return { known: true, cents };
}

export function unknownCents(reason: string | null = null): UnknownCents {
  return reason === null ? UNKNOWN : { known: false, reason };
}

/** Lift a nullable DB/API value. `null`/`undefined` become unknown, never 0. */
export function fromNullableCents(cents: number | null | undefined, reason?: string): Money {
  if (cents === null || cents === undefined) return unknownCents(reason ?? null);
  return knownCents(cents);
}

/** Lower back to the storage representation (`null` for unknown). */
export function toNullableCents(money: Money): number | null {
  return money.known ? money.cents : null;
}

function firstUnknown(a: Money, b: Money): UnknownCents | null {
  if (!a.known) return a;
  if (!b.known) return b;
  return null;
}

export function addCents(a: Money, b: Money): Money {
  const u = firstUnknown(a, b);
  if (u) return u;
  return knownCents((a as KnownCents).cents + (b as KnownCents).cents);
}

export function subtractCents(a: Money, b: Money): Money {
  const u = firstUnknown(a, b);
  if (u) return u;
  return knownCents((a as KnownCents).cents - (b as KnownCents).cents);
}

export type Comparison = "LT" | "EQ" | "GT" | "UNKNOWN";

/** Three-way compare. Any unknown operand gives "UNKNOWN" (never a guess). */
export function compareCents(a: Money, b: Money): Comparison {
  if (!a.known || !b.known) return "UNKNOWN";
  if (a.cents < b.cents) return "LT";
  if (a.cents > b.cents) return "GT";
  return "EQ";
}

/** Tri-state boolean for predicates over possibly-unknown money. */
export type TriState = true | false | "UNKNOWN";

export function isGreaterThan(a: Money, b: Money): TriState {
  const c = compareCents(a, b);
  return c === "UNKNOWN" ? "UNKNOWN" : c === "GT";
}

/**
 * `max(0, expected - available)` per Section 5. Unknown if either input is unknown.
 * Callers must apply the charge-projection validation gates before using this.
 */
export function shortfallCents(expected: Money, available: Money): Money {
  const diff = subtractCents(expected, available);
  if (!diff.known) return diff;
  return knownCents(Math.max(0, diff.cents));
}

export type FormatCentsOptions = {
  /** Text rendered for unknown amounts. Default "Unknown". */
  unknownLabel?: string;
  /** Omit ".00" when the amount is whole dollars. Default false. */
  compactWholeDollars?: boolean;
};

/**
 * Render integer cents as USD (e.g. 245000 -> "$2,450.00"). Integer-only math,
 * no float division. `null`/unknown renders as "Unknown", never "$0.00".
 */
export function formatCents(value: number | null | Money, options: FormatCentsOptions = {}): string {
  const { unknownLabel = "Unknown", compactWholeDollars = false } = options;
  const cents =
    value === null ? null : typeof value === "number" ? value : value.known ? value.cents : null;
  if (cents === null) return unknownLabel;
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const rem = abs % 100;
  const dollarsText = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const centsText = compactWholeDollars && rem === 0 ? "" : `.${rem.toString().padStart(2, "0")}`;
  return `${negative ? "-" : ""}$${dollarsText}${centsText}`;
}
