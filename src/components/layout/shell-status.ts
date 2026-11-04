/**
 * Server-side shell status derived from environment variables.
 *
 * Labels and tones come from the shared provenance contract
 * (`@/lib/provenance`); this module only decides *which* mode applies.
 *
 * Until a real read-only adapter exists, the only truthful states are the
 * DEMO workspace (DEMO_MODE=true) or no source at all (`null`). This module
 * deliberately never yields RAMP_SANDBOX or RAMP_LIVE_READONLY.
 *
 * Call only from Server Components after `await connection()` so values are
 * read at request time rather than frozen at build time.
 */
import { isDemoModeEnabled } from "@/lib/env";
import type { WorkspaceMode } from "@/lib/schema/enums";

/** Workspace mode, or `null` when no data source is connected. */
export type ShellMode = Extract<WorkspaceMode, "DEMO"> | null;

export type DemoClock =
  | { status: "valid"; iso: string; label: string }
  | { status: "invalid" };

export type ShellStatus = {
  mode: ShellMode;
  /** Injected demo clock. `null` when not in demo mode or DEMO_NOW unset. */
  demoClock: DemoClock | null;
  /**
   * ISO timestamp of the last successful data load, or null when nothing has
   * been loaded. Always null until a data layer is wired into the shell.
   */
  lastLoadedAt: string | null;
};

export function readShellStatus(
  env: Record<string, string | undefined> = process.env,
): ShellStatus {
  // Shared parser keeps the chip consistent with the server write gate.
  const mode: ShellMode = isDemoModeEnabled(env) ? "DEMO" : null;

  let demoClock: DemoClock | null = null;
  const rawNow = env.DEMO_NOW?.trim();
  if (mode === "DEMO" && rawNow) {
    const parsed = new Date(rawNow);
    demoClock = Number.isNaN(parsed.getTime())
      ? { status: "invalid" }
      : {
          status: "valid",
          iso: parsed.toISOString(),
          label: formatUtc(parsed.toISOString()),
        };
  }

  return { mode, demoClock, lastLoadedAt: null };
}

/** Formats an ISO timestamp as "17 Nov 2026, 16:00 UTC" deterministically. */
export function formatUtc(iso: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(d);
  return `${date}, ${time} UTC`;
}
