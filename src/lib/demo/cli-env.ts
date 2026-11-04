/**
 * CLI environment handling for demo seed/reset entrypoints.
 *
 * The package.json / prisma.config.ts commands pass `--default-demo-mode`
 * explicitly. With that flag, an UNSET (undefined) DEMO_MODE defaults to "true"
 * so a clean clone (no .env) can seed the fictional demo. A blank value
 * (`DEMO_MODE=` in the shell or .env) is NOT unset: it is respected and the
 * operation refuses, so a blank line can never trigger a wipe. Any other non-true
 * DEMO_MODE (e.g. from .env, loaded by `tsx --env-file-if-exists=.env`) is
 * respected, and the operation then refuses. Cross-platform; no extra deps.
 */
export const DEFAULT_DEMO_MODE_FLAG = "--default-demo-mode";

export function applyCliDemoDefault(
  argv: readonly string[] = process.argv,
  env: Record<string, string | undefined> = process.env,
): "defaulted" | "inherited" {
  if (argv.includes(DEFAULT_DEMO_MODE_FLAG) && env.DEMO_MODE === undefined) {
    env.DEMO_MODE = "true";
    return "defaulted";
  }
  return "inherited";
}
