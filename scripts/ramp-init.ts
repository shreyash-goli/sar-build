/**
 * `pnpm ramp:init -- --confirm`: replace ALL data in the database at DATABASE_URL with an empty
 * RAMP_SANDBOX workspace, so a read-only Ramp sandbox sync never mixes with the fictional demo.
 * Destructive (same scope as demo:reset); requires --confirm. `pnpm demo:reset` restores the demo.
 */
import { createDbClient } from "@/lib/db";
import { redactSecrets } from "@/lib/security/redact";
import { createRepositories } from "@/lib/repositories";

export const RAMP_WORKSPACE = { id: "ws-ramp-sandbox", name: "Ramp sandbox (read-only)", mode: "RAMP_SANDBOX" } as const;

async function main(): Promise<number> {
  if (!process.argv.includes("--confirm")) {
    console.error("ramp:init deletes all data in this database. Re-run with --confirm (pnpm ramp:init -- --confirm).");
    return 1;
  }
  const db = createDbClient();
  try {
    const cleared = await db.$transaction(async (tx) => {
      const allow = () => undefined; // explicit operator command with --confirm
      const repos = createRepositories(tx, { writeGate: allow, demoResetGate: allow });
      const summary = await repos.demoReset.clearAllData();
      await repos.workspaces.create(RAMP_WORKSPACE);
      return summary;
    });
    console.log(JSON.stringify({ ok: true, operation: "ramp:init", workspace: RAMP_WORKSPACE, cleared }, null, 2));
    return 0;
  } finally {
    await db.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`ramp:init failed: ${redactSecrets(e instanceof Error ? e.message : String(e))}`);
    process.exit(2);
  },
);
