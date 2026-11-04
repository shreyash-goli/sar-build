/**
 * Server-side shell status derived from environment variables.
 *
 * Demo mode and the demo clock come from the shared, framework-free helpers in
 * `@/lib/env` and `@/lib/time`, so the shell always agrees with the server's
 * write gate and injected clock. Labels/tones come from `@/lib/provenance`.
 *
 * The mode chip describes the data on screen: it follows the workspace row in
 * the database (see `resolveChipMode`). DEMO_MODE only governs writes and the
 * demo clock; the env-derived mode is used solely as a fallback when the
 * database cannot be read, and can only ever be DEMO or none.
 *
 * Call only from Server Components after `await connection()` so values are
 * read at request time rather than frozen at build time.
 */
import { isDemoModeEnabled } from "@/lib/env";
import type { WorkspaceMode } from "@/lib/schema/enums";
import { resolveDemoClock } from "@/lib/time";
import { formatUtc } from "./format-utc";

/** Workspace mode shown by the chip, or `null` when no data source is connected. */
export type ShellMode = WorkspaceMode | null;

export type DemoClock =
  | {
      status: "valid";
      iso: string;
      label: string;
      /** Whether DEMO_NOW was set or the blueprint default applied. */
      source: "DEMO_NOW" | "DEFAULT";
    }
  | { status: "invalid" };

export type ShellStatus = {
  /** DEMO_MODE parsed with the shared helper (governs writes and the clock). */
  demoModeEnabled: boolean;
  /** Env-only mode: DEMO or null. Never sandbox/live. Fallback when the DB is unreadable. */
  envMode: Extract<WorkspaceMode, "DEMO"> | null;
  /** Injected demo clock. `null` only when demo mode is off. */
  demoClock: DemoClock | null;
};

export function readShellStatus(
  env: Record<string, string | undefined> = process.env,
): ShellStatus {
  // Shared parser keeps the shell consistent with the server write gate.
  const demoModeEnabled = isDemoModeEnabled(env);

  // Shared resolver keeps the shell clock identical to the server's getNow().
  const clock = resolveDemoClock(env);
  const demoClock: DemoClock | null =
    clock === null
      ? null
      : clock.status === "invalid"
        ? { status: "invalid" }
        : {
            status: "valid",
            iso: clock.iso,
            label: formatUtc(clock.iso),
            source: clock.source,
          };

  return { demoModeEnabled, envMode: demoModeEnabled ? "DEMO" : null, demoClock };
}

/** What the shell knows about the database's workspace, if it could read it. */
export type WorkspaceSource =
  | { status: "available"; workspaceMode: WorkspaceMode | null }
  | { status: "unavailable" };

export type ChipState = {
  mode: ShellMode;
  /** Secondary note, e.g. demo data shown while DEMO_MODE (writes) is off. */
  hint: string | null;
  /** Where the chip's mode came from. */
  basis: "workspace" | "no-workspace" | "env-fallback";
};

/**
 * The chip describes the data on screen:
 * - DB readable, workspace present -> the workspace row's mode (only data can claim sandbox/live)
 * - DB readable, no workspace      -> NO SOURCE CONNECTED
 * - DB unreadable                  -> env fallback (DEMO or none, never sandbox/live)
 * DEMO_MODE off while showing a DEMO workspace adds "Demo mode off · read-only".
 */
export function resolveChipMode(status: ShellStatus, source: WorkspaceSource): ChipState {
  if (source.status === "unavailable") {
    return { mode: status.envMode, hint: null, basis: "env-fallback" };
  }
  if (source.workspaceMode === null) {
    return { mode: null, hint: null, basis: "no-workspace" };
  }
  const hint =
    source.workspaceMode === "DEMO" && !status.demoModeEnabled ? "Demo mode off · read-only" : null;
  return { mode: source.workspaceMode, hint, basis: "workspace" };
}
