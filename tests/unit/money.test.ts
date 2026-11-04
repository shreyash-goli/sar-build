import { describe, expect, it } from "vitest";
import {
  CentsSchema,
  NullableCentsSchema,
  PositiveCentsSchema,
  addCents,
  compareCents,
  formatCents,
  fromNullableCents,
  isGreaterThan,
  knownCents,
  shortfallCents,
  subtractCents,
  toNullableCents,
  unknownCents,
} from "@/lib/schema";

describe("cents schemas", () => {
  it("accepts integer cents", () => {
    expect(CentsSchema.parse(245000)).toBe(245000);
    expect(CentsSchema.parse(-100)).toBe(-100);
  });

  it.each([12.5, 0.1, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects %s", (v) => {
    expect(CentsSchema.safeParse(v).success).toBe(false);
  });

  it("rejects strings and does not coerce", () => {
    expect(CentsSchema.safeParse("100").success).toBe(false);
  });

  it("nullable cents keeps null and rejects undefined", () => {
    expect(NullableCentsSchema.parse(null)).toBeNull();
    expect(NullableCentsSchema.safeParse(undefined).success).toBe(false);
  });

  it("positive cents rejects zero and negatives", () => {
    expect(PositiveCentsSchema.safeParse(0).success).toBe(false);
    expect(PositiveCentsSchema.safeParse(-1).success).toBe(false);
  });
});

describe("null-preserving money arithmetic", () => {
  const a = knownCents(245000);
  const b = knownCents(200000);
  const u = unknownCents("availability not reported");

  it("adds and subtracts known values exactly", () => {
    expect(addCents(a, b)).toEqual(knownCents(445000));
    expect(subtractCents(a, b)).toEqual(knownCents(45000));
  });

  it("returns unknown when either operand is unknown (never treats as 0)", () => {
    expect(addCents(a, u).known).toBe(false);
    expect(addCents(u, a).known).toBe(false);
    expect(subtractCents(a, u).known).toBe(false);
    expect(toNullableCents(addCents(a, u))).toBeNull();
  });

  it("propagates the unknown reason", () => {
    expect(subtractCents(a, u)).toEqual(u);
  });

  it("compare with unknown is UNKNOWN", () => {
    expect(compareCents(a, u)).toBe("UNKNOWN");
    expect(compareCents(u, u)).toBe("UNKNOWN");
    expect(isGreaterThan(a, u)).toBe("UNKNOWN");
    expect(compareCents(a, b)).toBe("GT");
    expect(compareCents(b, a)).toBe("LT");
    expect(compareCents(a, knownCents(245000))).toBe("EQ");
    expect(isGreaterThan(b, a)).toBe(false);
  });

  it("computes the golden-path $450 shortfall exactly", () => {
    expect(shortfallCents(knownCents(245000), knownCents(200000))).toEqual(knownCents(45000));
    expect(shortfallCents(knownCents(100), knownCents(500))).toEqual(knownCents(0));
  });

  it("shortfall with unknown availability is unknown, not the full charge or 0", () => {
    expect(shortfallCents(knownCents(245000), fromNullableCents(null)).known).toBe(false);
  });

  it("fromNullableCents maps null/undefined to unknown and 0 to known 0", () => {
    expect(fromNullableCents(null).known).toBe(false);
    expect(fromNullableCents(undefined).known).toBe(false);
    expect(fromNullableCents(0)).toEqual(knownCents(0));
  });

  it("rejects float cents and overflow", () => {
    expect(() => knownCents(1.5)).toThrow(RangeError);
    expect(() => addCents(knownCents(Number.MAX_SAFE_INTEGER), knownCents(1))).toThrow(RangeError);
  });
});

describe("formatCents", () => {
  it("formats integer cents as USD", () => {
    expect(formatCents(245000)).toBe("$2,450.00");
    expect(formatCents(45000)).toBe("$450.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(-12345)).toBe("-$123.45");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
    expect(formatCents(60000, { compactWholeDollars: true })).toBe("$600");
  });

  it("renders unknown as Unknown, never $0.00", () => {
    expect(formatCents(null)).toBe("Unknown");
    expect(formatCents(unknownCents())).toBe("Unknown");
    expect(formatCents(null, { unknownLabel: "Not reported" })).toBe("Not reported");
    expect(formatCents(knownCents(100))).toBe("$1.00");
  });

  it("refuses to format floats", () => {
    expect(() => formatCents(1.5)).toThrow(RangeError);
  });
});
