/**
 * Server-side shell status derived from environment variables.
 *
 * FS-01 scope: the only modes that can be truthfully claimed without a source
 * adapter are "demo" (DEMO_MODE=true) and "none". A Ramp sandbox mode is
 * deliberately NOT representable here until a real read-only adapter exists.
 *
 * Call only from Server Components after `await connection()` so the values
 * are read at request time rather than frozen at build time.
 */
export type SourceModeKind = "demo" | "none";

export type ShellStatus = {
  mode: SourceModeKind;
  /** Injected demo clock (ISO 8601) when in demo mode and DEMO_NOW is valid. */
  demoClock: string | null;
  /**
   * ISO timestamp of the last successful data load, or null when nothing has
   * been loaded. Always null in FS-01: no data layer exists yet.
   */
  lastLoadedAt: string | null;
};

export function readShellStatus(
  env: Record<string, string | undefined> = process.env,
): ShellStatus {
  const mode: SourceModeKind =
    env.DEMO_MODE?.trim().toLowerCase() === "true" ? "demo" : "none";

  let demoClock: string | null = null;
  if (mode === "demo" && env.DEMO_NOW) {
    const parsed = new Date(env.DEMO_NOW);
    if (!Number.isNaN(parsed.getTime())) demoClock = parsed.toISOString();
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
