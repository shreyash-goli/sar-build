/** Conversions between domain (Zod) shapes and Prisma row shapes. */

/** Domain ISO string -> Date. */
export function toDate(iso: string): Date {
  return new Date(iso);
}

export function toDateOrNull(iso: string | null): Date | null {
  return iso === null ? null : new Date(iso);
}

/** Date -> canonical UTC ISO string ("...Z"; ".000" stripped for whole seconds). */
export function fromDate(d: Date): string {
  return d.toISOString().replace(".000Z", "Z");
}

export function fromDateOrNull(d: Date | null): string | null {
  return d === null ? null : fromDate(d);
}

/** Integer cents -> BigInt column. null stays null (unknown is never 0). */
export function centsToDb(cents: number): bigint;
export function centsToDb(cents: number | null): bigint | null;
export function centsToDb(cents: number | null): bigint | null {
  return cents === null ? null : BigInt(cents);
}

/** BigInt column -> integer cents. Throws if outside the safe-integer range. */
export function centsFromDb(v: bigint): number;
export function centsFromDb(v: bigint | null): number | null;
export function centsFromDb(v: bigint | null): number | null {
  if (v === null) return null;
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`Stored cents ${v.toString()} exceed the safe-integer range`);
  }
  return Number(v);
}

export function jsonToDb(value: unknown): string {
  return JSON.stringify(value);
}

export function jsonFromDb(text: string): unknown {
  return JSON.parse(text) as unknown;
}
