import { afterEach, describe, expect, it, vi } from "vitest";

import { getModeChipCopy } from "@/components/layout/mode-copy";
import { formatUtc, readShellStatus } from "@/components/layout/shell-status";

// readShellStatus() defaults to process.env; each test stubs the variables it
// needs and afterEach restores the original environment.
afterEach(() => {
  vi.unstubAllEnvs();
});

function stubEnv(vars: { DEMO_MODE?: string; DEMO_NOW?: string }) {
  vi.stubEnv("DEMO_MODE", vars.DEMO_MODE);
  vi.stubEnv("DEMO_NOW", vars.DEMO_NOW);
}

describe("readShellStatus + getModeChipCopy", () => {
  it("DEMO_MODE=true with a valid DEMO_NOW yields DEMO DATA and a formatted clock", () => {
    stubEnv({ DEMO_MODE: "true", DEMO_NOW: "2026-11-17T16:00:00Z" });
    const status = readShellStatus();

    expect(status.mode).toBe("DEMO");
    expect(status.demoClock).toEqual({
      status: "valid",
      iso: "2026-11-17T16:00:00.000Z",
      label: "17 Nov 2026, 16:00 UTC",
    });
    expect(status.lastLoadedAt).toBeNull();

    const copy = getModeChipCopy(status.mode);
    expect(copy.label).toBe("DEMO DATA");
    expect(copy.variant).toBe("warning");
    expect(copy.description.length).toBeGreaterThan(0);
  });

  it("DEMO_MODE=true with an invalid DEMO_NOW yields an explicit invalid clock", () => {
    stubEnv({ DEMO_MODE: "true", DEMO_NOW: "not-a-date" });
    const status = readShellStatus();

    expect(status.mode).toBe("DEMO");
    expect(status.demoClock).toEqual({ status: "invalid" });
    expect(getModeChipCopy(status.mode).label).toBe("DEMO DATA");
  });

  it("DEMO_MODE=true with DEMO_NOW unset yields no clock", () => {
    stubEnv({ DEMO_MODE: "true", DEMO_NOW: undefined });
    const status = readShellStatus();

    expect(status.mode).toBe("DEMO");
    expect(status.demoClock).toBeNull();
    expect(getModeChipCopy(status.mode).label).toBe("DEMO DATA");
  });

  it("DEMO_MODE=true with a blank DEMO_NOW is treated as unset", () => {
    stubEnv({ DEMO_MODE: "true", DEMO_NOW: "   " });
    expect(readShellStatus().demoClock).toBeNull();
  });

  it.each([
    ["false", "false"],
    ["unset", undefined],
    ["empty", ""],
    ["not exactly true", "yes"],
  ])(
    "DEMO_MODE %s yields NO SOURCE CONNECTED and no clock, even with DEMO_NOW set",
    (_case, demoMode) => {
      stubEnv({ DEMO_MODE: demoMode, DEMO_NOW: "2026-11-17T16:00:00Z" });
      const status = readShellStatus();

      expect(status.mode).toBeNull();
      expect(status.demoClock).toBeNull();
      expect(status.lastLoadedAt).toBeNull();

      const copy = getModeChipCopy(status.mode);
      expect(copy.label).toBe("NO SOURCE CONNECTED");
      expect(copy.variant).toBe("neutral");
    },
  );

  it("accepts DEMO_MODE case-insensitively with surrounding whitespace", () => {
    stubEnv({ DEMO_MODE: " TRUE ", DEMO_NOW: undefined });
    expect(readShellStatus().mode).toBe("DEMO");
  });

  it("never yields a sandbox or live mode, and never labels the chip as sandbox", () => {
    for (const demoMode of ["true", "false", undefined, "RAMP_SANDBOX", "sandbox"]) {
      stubEnv({ DEMO_MODE: demoMode, DEMO_NOW: undefined });
      const status = readShellStatus();
      expect([null, "DEMO"]).toContain(status.mode);
      expect(getModeChipCopy(status.mode).label).not.toMatch(/SANDBOX|LIVE/i);
    }
  });

  it("reads from an explicitly passed env instead of process.env", () => {
    stubEnv({ DEMO_MODE: "false", DEMO_NOW: undefined });
    const status = readShellStatus({
      DEMO_MODE: "true",
      DEMO_NOW: "2026-01-02T03:04:00Z",
    });
    expect(status.mode).toBe("DEMO");
    expect(status.demoClock).toMatchObject({
      status: "valid",
      label: "02 Jan 2026, 03:04 UTC",
    });
  });
});

describe("formatUtc", () => {
  it("formats deterministically in UTC regardless of host timezone", () => {
    expect(formatUtc("2026-11-17T23:59:00-05:00")).toBe("18 Nov 2026, 04:59 UTC");
  });
});
