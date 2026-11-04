/**
 * `pnpm demo:reset`: restore the fictional Northstar demo workspace.
 * Refuses unless DEMO_MODE is enabled. Transactional: clears incidents (and,
 * by cascade, simulations and proposals), audit events and all demo rows,
 * then reseeds the fixture. Incidents/simulations/proposals are not recreated;
 * the risk engine (FS-11) regenerates them. Core logic lives in
 * src/lib/demo/northstar.ts (resetNorthstarDemo) for reuse by POST /api/demo/reset.
 */
import { createDbClient } from "@/lib/db";
import { applyCliDemoDefault } from "@/lib/demo/cli-env";
import { resetNorthstarDemo } from "@/lib/demo/northstar";

async function main() {
  if (applyCliDemoDefault() === "defaulted") console.log("DEMO_MODE was unset; defaulting to true for the fictional demo reset.");
  const db = createDbClient();
  try {
    const summary = await resetNorthstarDemo(db);
    console.log(JSON.stringify({ ok: true, operation: "reset", ...summary }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(`Demo reset failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
