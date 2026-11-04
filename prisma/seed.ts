/**
 * `pnpm db:seed` -> `prisma db seed` -> this file (configured in prisma.config.ts).
 * Idempotent: re-running creates nothing new and never overwrites data.
 */
import { createDbClient } from "@/lib/db";
import { redactSecrets } from "@/lib/security/redact";
import { seedNorthstarDemo } from "@/lib/demo/northstar";
import { applyCliDemoDefault } from "@/lib/demo/cli-env";

async function main() {
  if (applyCliDemoDefault() === "defaulted") console.log("DEMO_MODE was unset; defaulting to true for the fictional demo seed.");
  const db = createDbClient();
  try {
    const summary = await seedNorthstarDemo(db);
    console.log(JSON.stringify({ ok: true, operation: "seed", ...summary }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(`Seed failed: ${redactSecrets(e instanceof Error ? e.message : String(e))}`);
  process.exit(1);
});
