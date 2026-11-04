import { afterEach, describe, expect, it, vi } from "vitest";

import { readShellContext } from "@/components/layout/shell-context";
import {
  deriveFreshness,
  deriveWorkspaceMode,
  readShellFreshness,
  readShellSource,
} from "@/components/layout/shell-freshness";

afterEach(() => {
  vi.restoreAllMocks();
});

const demoWs = [{ mode: "DEMO" as const }];

describe("deriveFreshness", () => {
  it("no workspace -> No data loaded, even if evidence rows exist", () => {
    expect(
      deriveFreshness({ workspaces: [], evidence: [{ capturedAt: "2026-11-17T16:00:00Z" }] }),
    ).toEqual({ status: "none" });
  });

  it("workspace but zero evidence -> No data loaded", () => {
    expect(deriveFreshness({ workspaces: demoWs, evidence: [] })).toEqual({ status: "none" });
  });

  it("uses the LATEST evidence capturedAt and labels demo data honestly", () => {
    const f = deriveFreshness({
      workspaces: demoWs,
      evidence: [
        { capturedAt: "2026-11-10T09:00:00Z" },
        { capturedAt: "2026-11-17T16:00:00Z" },
        { capturedAt: "2026-11-12T23:30:00Z" },
      ],
    });
    expect(f).toEqual({
      status: "loaded",
      capturedAt: "2026-11-17T16:00:00.000Z",
      subject: "Demo data",
      capturedLabel: "17 Nov 2026, 16:00 UTC",
      label: "Demo data captured 17 Nov 2026, 16:00 UTC",
    });
  });

  it("compares instants, not strings, across offsets", () => {
    const f = deriveFreshness({
      workspaces: demoWs,
      evidence: [
        { capturedAt: "2026-11-17T20:00:00+05:00" }, // 15:00Z
        { capturedAt: "2026-11-17T15:30:00Z" },
      ],
    });
    expect(f).toMatchObject({ status: "loaded", capturedAt: "2026-11-17T15:30:00.000Z" });
  });

  it("non-demo workspaces are not labelled as demo data", () => {
    const f = deriveFreshness({
      workspaces: [{ mode: "RAMP_SANDBOX" }],
      evidence: [{ capturedAt: "2026-11-17T16:00:00Z" }],
    });
    expect(f).toMatchObject({ status: "loaded", subject: "Data" });
    if (f.status === "loaded") expect(f.label).not.toMatch(/demo/i);
  });

  it("evidence without any parseable timestamp -> unavailable, never a made-up time", () => {
    expect(
      deriveFreshness({ workspaces: demoWs, evidence: [{ capturedAt: "not-a-date" }] }),
    ).toEqual({ status: "unavailable" });
  });
});

describe("readShellFreshness", () => {
  it("returns unavailable (and does not throw) when the DB read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = await readShellFreshness(async () => {
      throw new Error("no such table: EvidenceRecord");
    });
    expect(f).toEqual({ status: "unavailable" });
  });

  it("derives from the loader's data", async () => {
    const f = await readShellFreshness(async () => ({
      workspaces: demoWs,
      evidence: [{ capturedAt: "2026-11-17T16:00:00Z" }],
    }));
    expect(f).toMatchObject({ status: "loaded", label: "Demo data captured 17 Nov 2026, 16:00 UTC" });
  });
});

describe("readShellSource / readShellContext", () => {
  it("returns workspace mode alongside freshness from one read", async () => {
    const src = await readShellSource(async () => ({
      workspaces: demoWs,
      evidence: [{ capturedAt: "2026-11-17T16:00:00Z" }],
    }));
    expect(src.workspace).toEqual({ status: "available", workspaceMode: "DEMO" });
    expect(src.freshness).toMatchObject({ status: "loaded" });
  });

  it("no workspace -> available with null mode and No data loaded", async () => {
    const src = await readShellSource(async () => ({ workspaces: [], evidence: [] }));
    expect(src).toEqual({ freshness: { status: "none" }, workspace: { status: "available", workspaceMode: null } });
  });

  it("DB failure -> unavailable for both, never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const src = await readShellSource(async () => {
      throw new Error("SQLITE_ERROR: no such table: Workspace");
    });
    expect(src).toEqual({ freshness: { status: "unavailable" }, workspace: { status: "unavailable" } });
  });

  it("mixed workspace modes never overclaim liveness", () => {
    expect(deriveWorkspaceMode([{ mode: "RAMP_LIVE_READONLY" }, { mode: "DEMO" }])).toBe("DEMO");
    expect(deriveWorkspaceMode([{ mode: "RAMP_LIVE_READONLY" }, { mode: "RAMP_SANDBOX" }])).toBe("RAMP_SANDBOX");
    expect(deriveWorkspaceMode([])).toBeNull();
  });

  it("QA case end-to-end: DEMO_MODE=false with a seeded DEMO workspace shows DEMO DATA + hint", async () => {
    const ctx = await readShellContext({ DEMO_MODE: "false" }, async () => ({
      workspaces: demoWs,
      evidence: [{ capturedAt: "2026-11-17T16:00:00Z" }],
    }));
    expect(ctx.chip).toEqual({ mode: "DEMO", hint: "Demo mode off · read-only", basis: "workspace" });
    expect(ctx.demoClock).toBeNull();
    expect(ctx.freshness).toMatchObject({ label: "Demo data captured 17 Nov 2026, 16:00 UTC" });
  });

  it("DB unavailable falls back to the env chip with Source status unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = await readShellContext({ DEMO_MODE: "true" }, async () => {
      throw new Error("unreachable");
    });
    expect(ctx.chip).toEqual({ mode: "DEMO", hint: null, basis: "env-fallback" });
    expect(ctx.freshness).toEqual({ status: "unavailable" });
  });
});
