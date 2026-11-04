/** Shared, framework-free environment flag parsing (server and client safe). */

type FlagEnv = Readonly<Record<string, string | undefined>>;

/** DEMO_MODE is enabled when its trimmed value equals "true" (case-insensitive). */
export function isDemoModeEnabled(env: FlagEnv = process.env): boolean {
  return env.DEMO_MODE?.trim().toLowerCase() === "true";
}
