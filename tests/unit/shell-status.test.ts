import { afterEach, describe, expect, it, vi } from "vitest";

import { getModeChipCopy } from "@/components/layout/mode-copy";
import { isDemoModeEnabled } from "@/lib/env";
import { formatUtc, readShellStatus, resolveChipMode } from "@/components/layout/shell-status";
import { DEFAULT_DEMO_NOW, resolveDemoClock } from "@/lib/time";

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

    expect(status.envMode).toBe("DEMO");
    expect(status.demoClock).toEqual({
      status: "valid",
      iso: "2026-11-17T16:00:00Z",
      label: "17 Nov 2026, 16:00 UTC",
      source: "DEMO_NOW",
    });

    const copy = getModeChipCopy(status.envMode);
    expect(copy.label).toBe("DEMO DATA");
    expect(copy.variant).toBe("warning");
    expect(copy.description.length).toBeGreaterThan(0);
  });

  it("DEMO_MODE=true with an invalid DEMO_NOW yields an explicit invalid clock", () => {
    stubEnv({ DEMO_MODE: "true", DEMO_NOW: "not-a-date" });
    const status = readShellStatus();

    expect(status.envMode).toBe("DEMO");
    expect(status.demoClock).toEqual({ status: "invalid" });
    expect(getModeChipCopy(status.envMode).label).toBe("DEMO DATA");
  });

  it("DEMO_MODE=true with DEMO_NOW unset shows the default demo clock (matches the server)", () => {
    stubEnv({ DEMO_MODE: "true", DEMO_NOW: undefined });
    const status = readShellStatus();

    expect(status.envMode).toBe("DEMO");
    expect(status.demoClock).toEqual({
      status: "valid",
      iso: DEFAULT_DEMO_NOW,
      label: "17 Nov 2026, 16:00 UTC",
      source: "DEFAULT",
    });
    expect(getModeChipCopy(status.envMode).label).toBe("DEMO DATA");
  });

  it("DEMO_MODE=true with a blank DEMO_NOW uses the default demo clock", () => {
    stubEnv({ DEMO_MODE: "true", DEMO_NOW: "   " });
    expect(readShellStatus().demoClock).toMatchObject({
      status: "valid",
      iso: DEFAULT_DEMO_NOW,
      source: "DEFAULT",
    });
  });

  it("a DEMO_NOW without a timezone is invalid, as on the server", () => {
    stubEnv({ DEMO_MODE: "true", DEMO_NOW: "2026-11-17T16:00:00" });
    expect(readShellStatus().demoClock).toEqual({ status: "invalid" });
  });

  it("canonicalizes an offset DEMO_NOW to UTC", () => {
    stubEnv({ DEMO_MODE: "true", DEMO_NOW: "2026-11-20T00:00:00-08:00" });
    expect(readShellStatus().demoClock).toMatchObject({
      iso: "2026-11-20T08:00:00Z",
      label: "20 Nov 2026, 08:00 UTC",
    });
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

      expect(status.envMode).toBeNull();
      expect(status.demoClock).toBeNull();

      const copy = getModeChipCopy(status.envMode);
      expect(copy.label).toBe("NO SOURCE CONNECTED");
      expect(copy.variant).toBe("neutral");
    },
  );

  it("accepts DEMO_MODE case-insensitively with surrounding whitespace", () => {
    stubEnv({ DEMO_MODE: " TRUE ", DEMO_NOW: undefined });
    expect(readShellStatus().envMode).toBe("DEMO");
  });

  it("never yields a sandbox or live mode, and never labels the chip as sandbox", () => {
    for (const demoMode of ["true", "false", undefined, "RAMP_SANDBOX", "sandbox"]) {
      stubEnv({ DEMO_MODE: demoMode, DEMO_NOW: undefined });
      const status = readShellStatus();
      expect([null, "DEMO"]).toContain(status.envMode);
      expect(getModeChipCopy(status.envMode).label).not.toMatch(/SANDBOX|LIVE/i);
    }
  });

  it("reads from an explicitly passed env instead of process.env", () => {
    stubEnv({ DEMO_MODE: "false", DEMO_NOW: undefined });
    const status = readShellStatus({
      DEMO_MODE: "true",
      DEMO_NOW: "2026-01-02T03:04:00Z",
    });
    expect(status.envMode).toBe("DEMO");
    expect(status.demoClock).toMatchObject({
      status: "valid",
      label: "02 Jan 2026, 03:04 UTC",
    });
  });
});

describe("DEMO_MODE parsing matches the shared server gate", () => {
  it.each(["true", "TRUE", " True ", "false", "", "yes", "1", undefined])(
    "DEMO_MODE=%j: chip mode agrees with isDemoModeEnabled",
    (demoMode) => {
      const env = { DEMO_MODE: demoMode };
      expect(readShellStatus(env).envMode === "DEMO").toBe(isDemoModeEnabled(env));
    },
  );

  it("DEMO_MODE=TRUE enables demo mode in both the chip and the write gate", () => {
    stubEnv({ DEMO_MODE: "TRUE", DEMO_NOW: undefined });
    expect(isDemoModeEnabled()).toBe(true);
    expect(getModeChipCopy(readShellStatus().envMode).label).toBe("DEMO DATA");
  });
});

describe("demo clock agrees with the shared server resolver", () => {
  it.each([
    ["true", "2026-11-17T16:00:00Z"],
    ["true", undefined],
    ["true", ""],
    ["true", "garbage"],
    ["true", "2026-11-17T16:00:00"],
    ["false", "2026-11-17T16:00:00Z"],
    [undefined, undefined],
  ])("DEMO_MODE=%j DEMO_NOW=%j", (demoMode, demoNow) => {
    const env = { DEMO_MODE: demoMode, DEMO_NOW: demoNow };
    const shared = resolveDemoClock(env);
    const shell = readShellStatus(env).demoClock;
    if (shared === null) expect(shell).toBeNull();
    else if (shared.status === "invalid") expect(shell).toEqual({ status: "invalid" });
    else expect(shell).toMatchObject({ status: "valid", iso: shared.iso, source: shared.source });
  });
});

describe("formatUtc", () => {
  it("formats deterministically in UTC regardless of host timezone", () => {
    expect(formatUtc("2026-11-17T23:59:00-05:00")).toBe("18 Nov 2026, 04:59 UTC");
  });
});

describe("resolveChipMode: the chip describes the data on screen", () => {
  const demoOn = () => readShellStatus({ DEMO_MODE: "true" });
  const demoOff = () => readShellStatus({ DEMO_MODE: "false" });

  it("DEMO_MODE=false + seeded DEMO workspace -> DEMO DATA with a read-only hint (QA case)", () => {
    const chip = resolveChipMode(demoOff(), { status: "available", workspaceMode: "DEMO" });
    expect(chip).toEqual({ mode: "DEMO", hint: "Demo mode off · read-only", basis: "workspace" });
    expect(getModeChipCopy(chip.mode).label).toBe("DEMO DATA");
  });

  it("DEMO_MODE=true + DEMO workspace -> DEMO DATA, no hint", () => {
    expect(resolveChipMode(demoOn(), { status: "available", workspaceMode: "DEMO" })).toEqual({
      mode: "DEMO",
      hint: null,
      basis: "workspace",
    });
  });

  it.each([
    ["demo on", demoOn],
    ["demo off", demoOff],
  ])("no workspace (%s) -> NO SOURCE CONNECTED whose copy only says no source is connected", (_c, status) => {
    const chip = resolveChipMode(status(), { status: "available", workspaceMode: null });
    expect(chip).toEqual({ mode: null, hint: null, basis: "no-workspace" });
    const copy = getModeChipCopy(chip.mode);
    expect(copy.label).toBe("NO SOURCE CONNECTED");
    expect(copy.description).toBe("No data source is connected.");
    expect(copy.description).not.toMatch(/demo|live/i);
  });

  it("DB unavailable -> env fallback, which is DEMO or none and never sandbox/live", () => {
    expect(resolveChipMode(demoOn(), { status: "unavailable" })).toEqual({
      mode: "DEMO",
      hint: null,
      basis: "env-fallback",
    });
    expect(resolveChipMode(demoOff(), { status: "unavailable" })).toEqual({
      mode: null,
      hint: null,
      basis: "env-fallback",
    });
  });

  it("only a workspace row can make the chip claim sandbox or live", () => {
    const sandbox = resolveChipMode(demoOff(), { status: "available", workspaceMode: "RAMP_SANDBOX" });
    expect(sandbox).toMatchObject({ mode: "RAMP_SANDBOX", hint: null, basis: "workspace" });
    expect(getModeChipCopy(sandbox.mode).label).toBe("SANDBOX DATA");

    const live = resolveChipMode(demoOn(), { status: "available", workspaceMode: "RAMP_LIVE_READONLY" });
    expect(getModeChipCopy(live.mode).label).toBe("RAMP LIVE (READ-ONLY)");

    for (const env of [{ DEMO_MODE: "true" }, { DEMO_MODE: "false" }, {}]) {
      for (const source of [{ status: "unavailable" as const }, { status: "available" as const, workspaceMode: null }]) {
        expect(resolveChipMode(readShellStatus(env), source).mode ?? "NONE").toMatch(/^(DEMO|NONE)$/);
      }
    }
  });
});
