/**
 * FS-21: `pnpm check:provenance` against a clean seed (pass) and a deliberately corrupted
 * copy (fail). The script itself is executed with tsx against a throwaway SQLite file.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient, type PrismaClient } from "@/lib/db";
import { seedNorthstarDemo } from "@/lib/demo/northstar";
import { checkProvenance } from "@/lib/provenance/check";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { createRepositories } from "@/lib/repositories";

const ROOT = resolve(__dirname, "../..");
const DEMO = { DEMO_MODE: "true" } as const;

let dir: string;
let cleanPath: string;
let corruptPath: string;

function runScript(dbPath: string) {
  const r = spawnSync(join(ROOT, "node_modules/.bin/tsx"), ["scripts/check-provenance.ts"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    encoding: "utf8",
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-check-provenance-"));
  cleanPath = join(dir, "clean.db");
  execFileSync(join(ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: `file:${cleanPath}` },
    stdio: "pipe",
  });
  const db = createDbClient(`file:${cleanPath}`);
  await seedNorthstarDemo(db, { env: DEMO });
  await db.$disconnect();

  // Corrupted copy. Raw SQL is used ON PURPOSE: the repositories refuse to write these
  // states (missing evidence, confirming an edge on unreviewed model evidence, invalid
  // snapshots), and the check must catch them if they ever reach the database another way.
  corruptPath = join(dir, "corrupt.db");
  copyFileSync(cleanPath, corruptPath);
  const bad: PrismaClient = createDbClient(`file:${corruptPath}`);
  const writer = createRepositories(bad, { writeGate: () => undefined, demoResetGate: () => undefined });
  await writer.evidence.create({
    id: "ev-model-unreviewed",
    kind: "MODEL",
    sourceSystem: "llm",
    sourceId: "suggestion-1",
    capturedAt: "2026-11-17T16:00:00Z",
    observedAt: null,
    excerpt: "Model guessed this dependency.",
    path: null,
    contentHash: null,
    classification: "MODEL_SUGGESTED",
    verificationStatus: "UNVERIFIED",
  });
  // SQLite enforces foreign keys per connection; disable them on this connection so a
  // dangling evidence reference can be written for the test.
  await bad.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  await bad.$executeRawUnsafe(`UPDATE "Node" SET "evidenceId" = 'ev-does-not-exist' WHERE "id" = 'node-service-otp-gateway'`);
  await bad.$executeRawUnsafe(`UPDATE "VendorCharge" SET "evidenceId" = 'ev-also-missing' WHERE "id" = 'charge-computeharbor-20261121'`);
  await bad.$executeRawUnsafe(
    `UPDATE "Edge" SET "evidenceId" = 'ev-model-unreviewed' WHERE "id" = 'edge-vendor-cloudcomms--service-otp-gateway'`,
  );
  await bad.$executeRawUnsafe(`UPDATE "Incident" SET "snapshotJson" = '{"bogus":true}' WHERE "id" = 'inc-charge-computeharbor-20261121'`);
  // An assertion without inputs (status DERIVED) inside an otherwise valid snapshot.
  const hero = (await bad.incident.findUnique({ where: { id: "inc-charge-cloudcomms-20261119" } }))!;
  const snap = JSON.parse(hero.snapshotJson) as { evaluation: { assertion: { inputs: string[] } } };
  snap.evaluation.assertion.inputs = [];
  await bad.$executeRawUnsafe(`UPDATE "Incident" SET "snapshotJson" = ? WHERE "id" = ?`, JSON.stringify(snap), hero.id);
  // An incident citing evidence that no longer exists.
  const decline = (await bad.incident.findUnique({ where: { id: "inc-tx-webhookworks-20261116" } }))!;
  const dsnap = JSON.parse(decline.snapshotJson) as { evaluation: { assertion: { inputs: string[] } } };
  dsnap.evaluation.assertion.inputs.push("evidence:ev-deleted-record");
  await bad.$executeRawUnsafe(`UPDATE "Incident" SET "snapshotJson" = ? WHERE "id" = ?`, JSON.stringify(dsnap), decline.id);
  await bad.$disconnect();
}, 90_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("check:provenance", () => {
  it("passes on a clean seed (exit 0) and reports what it checked", async () => {
    const r = runScript(cleanPath);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(
      "check:provenance OK (evidence=53 funding_source=3 payment_instrument=3 vendor=4 vendor_charge=3 transaction=3 node=18 edge=15 incident=4)",
    );
    const db = createDbClient(`file:${cleanPath}`);
    expect((await checkProvenance(createReadOnlyRepositories(db))).problems).toEqual([]);
    await db.$disconnect();
  }, 60_000);

  it("fails on a corrupted copy (exit 1) and lists every problem", async () => {
    const r = runScript(corruptPath);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/check:provenance FAILED: 6 problem\(s\)/);
    for (const line of [
      "[EVIDENCE_MISSING] VENDOR_CHARGE charge-computeharbor-20261121: cites missing evidence ev-also-missing",
      "[EVIDENCE_MISSING] NODE node-service-otp-gateway: cites missing evidence ev-does-not-exist",
      "[EDGE_CONFIRMATION_INVALID] EDGE edge-vendor-cloudcomms--service-otp-gateway:",
      "[INCIDENT_SNAPSHOT_INVALID] INCIDENT inc-charge-computeharbor-20261121: snapshot does not parse",
      "[INCIDENT_SNAPSHOT_INVALID] INCIDENT inc-charge-cloudcomms-20261119: snapshot does not parse: evaluation.assertion.inputs",
      "[INCIDENT_INPUT_MISSING] INCIDENT inc-tx-webhookworks-20261116: assertion risk-transaction-tx-webhookworks-20261116 cites missing evidence: ev-deleted-record",
    ]) {
      expect(r.out, line).toContain(line);
    }
    expect(r.out).toContain("unverified MODEL_SUGGESTED (MODEL) evidence is only allowed for synthetic FIXTURE/DEMO_FIXTURE demo data");
    expect(r.out).toContain("(evidence ev-model-unreviewed)");
  }, 60_000);

  it("is read-only: running it does not change the database", async () => {
    const db = createDbClient(`file:${corruptPath}`);
    const before = await db.incident.findMany({ orderBy: { id: "asc" } });
    runScript(corruptPath);
    expect(await db.incident.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    await db.$disconnect();
  }, 60_000);
});
