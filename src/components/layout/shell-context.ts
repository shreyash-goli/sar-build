/**
 * Everything the shell (and pages that repeat the chip, like Sources) needs:
 * env status, DB-derived source, and the resolved chip. Server-only; call
 * after `await connection()`.
 */
import { readShellSource, type FreshnessLoader, type ShellFreshness } from "./shell-freshness";
import { readShellStatus, resolveChipMode, type ChipState, type DemoClock } from "./shell-status";

export type ShellContext = {
  chip: ChipState;
  freshness: ShellFreshness;
  demoClock: DemoClock | null;
};

export async function readShellContext(
  env: Record<string, string | undefined> = process.env,
  load?: FreshnessLoader,
): Promise<ShellContext> {
  const status = readShellStatus(env);
  const source = await readShellSource(load);
  return {
    chip: resolveChipMode(status, source.workspace),
    freshness: source.freshness,
    demoClock: status.demoClock,
  };
}
