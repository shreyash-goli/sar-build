/**
 * Source freshness for the app shell, derived server-side from the database.
 *
 * Read-only: uses the ledger's read-only repositories (any write throws).
 * Never fabricates a timestamp:
 * - no workspace or no evidence  -> "none"        ("No data loaded")
 * - DB unreachable / unmigrated   -> "unavailable" ("Source status unavailable")
 * - otherwise                     -> "loaded" with the latest evidence capturedAt
 *
 * Call only from Server Components after `await connection()`.
 */
import type { WorkspaceMode } from "@/lib/schema/enums";
import { type WorkspaceSource } from "./shell-status";
import { logServerError } from "@/lib/security/redact";
import { formatUtc } from "./format-utc";

export type ShellFreshness =
  | { status: "none" }
  | { status: "unavailable" }
  | {
      status: "loaded";
      /** Latest evidence capturedAt (ISO). */
      capturedAt: string;
      subject: "Demo data" | "Data";
      /** Formatted capturedAt, e.g. "17 Nov 2026, 16:00 UTC". */
      capturedLabel: string;
      /** Full label, e.g. "Demo data captured 17 Nov 2026, 16:00 UTC". */
      label: string;
    };

export type FreshnessInputs = {
  workspaces: readonly { mode: WorkspaceMode }[];
  evidence: readonly { capturedAt: string }[];
};

const NONE: ShellFreshness = { status: "none" };
const UNAVAILABLE: ShellFreshness = { status: "unavailable" };

/** Pure derivation, unit-testable without a database. */
export function deriveFreshness({
  workspaces,
  evidence,
}: FreshnessInputs): ShellFreshness {
  if (workspaces.length === 0 || evidence.length === 0) return NONE;

  let latestMs = Number.NEGATIVE_INFINITY;
  let latestIso: string | null = null;
  for (const e of evidence) {
    const ms = Date.parse(e.capturedAt);
    if (Number.isFinite(ms) && ms > latestMs) {
      latestMs = ms;
      latestIso = e.capturedAt;
    }
  }
  // Evidence exists but no usable timestamp: say so rather than invent one.
  if (latestIso === null) return UNAVAILABLE;

  const isDemo = workspaces.every((w) => w.mode === "DEMO");
  const subject = isDemo ? "Demo data" : "Data";
  const capturedLabel = formatUtc(latestIso);
  return {
    status: "loaded",
    capturedAt: new Date(latestMs).toISOString(),
    subject,
    capturedLabel,
    label: `${subject} captured ${capturedLabel}`,
  };
}

export type FreshnessLoader = () => Promise<FreshnessInputs>;

async function loadFromDb(): Promise<FreshnessInputs> {
  // Imported lazily so a broken DB client can't take down the shell module.
  const { createReadOnlyRepositories } = await import("@/lib/provenance/ledger");
  const repos = createReadOnlyRepositories();
  const [workspaces, evidence] = await Promise.all([
    repos.workspaces.list(),
    repos.evidence.list(),
  ]);
  return { workspaces, evidence };
}

/**
 * Workspace mode shown by the chip. With several workspaces of different
 * modes, the least-live one wins (DEMO < RAMP_SANDBOX < RAMP_LIVE_READONLY) so
 * the chip never overclaims live data.
 */
const LIVENESS: Readonly<Record<WorkspaceMode, number>> = {
  DEMO: 0,
  RAMP_SANDBOX: 1,
  RAMP_LIVE_READONLY: 2,
};

export function deriveWorkspaceMode(workspaces: readonly { mode: WorkspaceMode }[]): WorkspaceMode | null {
  if (workspaces.length === 0) return null;
  return workspaces.map((w) => w.mode).reduce((a, b) => (LIVENESS[b] < LIVENESS[a] ? b : a));
}

export type ShellSource = {
  freshness: ShellFreshness;
  workspace: WorkspaceSource;
};

/** One DB read for the shell. Never throws: failures become "unavailable". */
export async function readShellSource(load: FreshnessLoader = loadFromDb): Promise<ShellSource> {
  try {
    const inputs = await load();
    return {
      freshness: deriveFreshness(inputs),
      workspace: { status: "available", workspaceMode: deriveWorkspaceMode(inputs.workspaces) },
    };
  } catch (error) {
    logServerError("shell", error);
    return { freshness: UNAVAILABLE, workspace: { status: "unavailable" } };
  }
}

/** Never throws: any read failure becomes `{ status: "unavailable" }`. */
export async function readShellFreshness(
  load: FreshnessLoader = loadFromDb,
): Promise<ShellFreshness> {
  return (await readShellSource(load)).freshness;
}
