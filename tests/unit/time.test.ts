import { describe, expect, it } from "vitest";
import { DEFAULT_DEMO_NOW, InvalidDemoClockError, getNow, getNowIso, resolveDemoClock } from "@/lib/time";

const realNow = () => new Date("2030-01-01T00:00:00Z");

describe("resolveDemoClock", () => {
  it("exports the blueprint default", () => {
    expect(DEFAULT_DEMO_NOW).toBe("2026-11-17T16:00:00Z");
  });

  it("returns null when demo mode is off", () => {
    expect(resolveDemoClock({})).toBeNull();
    expect(resolveDemoClock({ DEMO_MODE: "false", DEMO_NOW: DEFAULT_DEMO_NOW })).toBeNull();
    expect(resolveDemoClock({ DEMO_MODE: "" })).toBeNull();
  });

  it.each([undefined, "", "   "])("uses the default when DEMO_NOW is %j", (DEMO_NOW) => {
    expect(resolveDemoClock({ DEMO_MODE: "true", DEMO_NOW })).toEqual({ status: "valid", iso: DEFAULT_DEMO_NOW, source: "DEFAULT" });
  });

  it("uses DEMO_NOW and canonicalizes to UTC Z", () => {
    expect(resolveDemoClock({ DEMO_MODE: " TRUE ", DEMO_NOW: "2026-11-20T00:00:00-08:00" })).toEqual({
      status: "valid",
      iso: "2026-11-20T08:00:00Z",
      source: "DEMO_NOW",
    });
  });

  it.each(["2026-11-17 16:00", "2026-11-17T16:00:00", "tomorrow"])("reports invalid DEMO_NOW %j", (DEMO_NOW) => {
    expect(resolveDemoClock({ DEMO_MODE: "true", DEMO_NOW })).toEqual({ status: "invalid", value: DEMO_NOW });
  });

  it("has the same semantics as getNow for every case", () => {
    const cases = [
      {},
      { DEMO_MODE: "true" },
      { DEMO_MODE: "true", DEMO_NOW: "2026-11-20T08:00:00Z" },
      { DEMO_MODE: "true", DEMO_NOW: "bad" },
      { DEMO_MODE: "false", DEMO_NOW: "2026-11-20T08:00:00Z" },
    ];
    for (const env of cases) {
      const clock = resolveDemoClock(env);
      if (clock === null) expect(getNow({ env, realNow })).toEqual(realNow());
      else if (clock.status === "invalid") expect(() => getNow({ env, realNow })).toThrow(InvalidDemoClockError);
      else expect(getNowIso({ env, realNow })).toBe(clock.iso);
    }
  });
});
