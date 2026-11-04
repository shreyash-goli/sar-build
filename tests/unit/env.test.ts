import { describe, expect, it } from "vitest";
import { isDemoModeEnabled } from "@/lib/env";

describe("isDemoModeEnabled", () => {
  it.each(["true", "TRUE", "True", " true ", "\ttrue\n"])("enabled for %j", (DEMO_MODE) => {
    expect(isDemoModeEnabled({ DEMO_MODE })).toBe(true);
  });

  it.each([undefined, "", "false", "1", "yes", "on", "truee", "t rue"])("disabled for %j", (DEMO_MODE) => {
    expect(isDemoModeEnabled({ DEMO_MODE })).toBe(false);
  });

  it("ignores unrelated variables", () => {
    expect(isDemoModeEnabled({ demo_mode: "true" })).toBe(false);
  });

  it("defaults to process.env", () => {
    const prev = process.env.DEMO_MODE;
    try {
      process.env.DEMO_MODE = "TRUE";
      expect(isDemoModeEnabled()).toBe(true);
      process.env.DEMO_MODE = "false";
      expect(isDemoModeEnabled()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = prev;
    }
  });
});
