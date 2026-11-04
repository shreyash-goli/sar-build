/**
 * `pnpm check:provenance`: read-only provenance integrity check of the database at
 * DATABASE_URL (default file:./dev.db). Exits 1 and lists every problem when any
 * record, edge or incident is untraceable; exits 0 otherwise. Never modifies data.
 */
import { createDbClient } from "@/lib/db";
import { redactSecrets } from "@/lib/security/redact";
import { checkProvenance, formatProvenanceReport } from "@/lib/provenance/check";

async function main(): Promise<number> {
  const db = createDbClient();
  try {
    const report = await checkProvenance(db);
    const text = formatProvenanceReport(report);
    if (report.ok) console.log(text);
    else console.error(text);
    return report.ok ? 0 : 1;
  } finally {
    await db.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`check:provenance could not run: ${redactSecrets(e instanceof Error ? e.message : String(e))}`);
    process.exit(2);
  },
);
