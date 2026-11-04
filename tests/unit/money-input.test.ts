import { describe, expect, it } from "vitest";

import { parseDollarsToCents } from "@/components/simulator/money-input";

describe("parseDollarsToCents (integer cents, no floats)", () => {
  it.each([
    ["600", 60000],
    ["600.5", 60050],
    ["600.50", 60050],
    ["0.01", 1],
    ["$1,250.00", 125000],
    ["  42 ", 4200],
    ["999999999.99", 99999999999],
  ])("%j -> %i cents", (input, cents) => {
    expect(parseDollarsToCents(input)).toEqual({ ok: true, cents });
  });

  it("avoids binary floating-point error (0.29 is 29 cents, not 28)", () => {
    // Number("0.29") * 100 === 28.999999999999996 in IEEE-754.
    expect(parseDollarsToCents("0.29")).toEqual({ ok: true, cents: 29 });
    expect(parseDollarsToCents("1.15")).toEqual({ ok: true, cents: 115 });
  });

  it.each(["", "   ", "-5", "abc", "1.234", "0", "0.00", "1e3", "12.", ".5", "1,2,3.4.5", "1000000000"])(
    "rejects %j with a message",
    (input) => {
      const r = parseDollarsToCents(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message.length).toBeGreaterThan(0);
    },
  );

  it("zero is rejected with a specific message", () => {
    expect(parseDollarsToCents("0")).toEqual({ ok: false, message: "The amount must be greater than $0." });
  });
});
