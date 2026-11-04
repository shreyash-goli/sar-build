/**
 * POST /api/imports/manifest handler body (FS-09; testable without Next).
 * Demo mode only; the body is size-capped before parsing; content is text and is never executed.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { isDemoModeEnabled } from "@/lib/env";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { ManifestImportRequestSchema } from "@/lib/providers/import-schema";
import { importManifests } from "@/lib/providers/import-service";
import { MAX_MANIFEST_BYTES, MAX_MANIFEST_FILES } from "@/lib/providers/manifest-import";
import { createRepositories } from "@/lib/repositories";
import { WriteForbiddenError } from "@/lib/security/write-gate";
import { getNow } from "@/lib/time";
import { ApiFailure, buildMeta, handle, jsonData } from "./http";

type Env = Readonly<Record<string, string | undefined>>;
const DEMO_ONLY = "Manifest import is available only in demo mode (DEMO_MODE=true)";
/** Whole request cap: every file at the per-file limit plus JSON overhead. */
export const MAX_IMPORT_REQUEST_BYTES = MAX_MANIFEST_FILES * MAX_MANIFEST_BYTES * 2 + 16 * 1024;

export function importManifestHandler(request: Request, ctx: { db: PrismaClient; env: Env }): Promise<Response> {
  return handle(async () => {
    // Refuse before reading anything from the body.
    if (!isDemoModeEnabled(ctx.env)) throw new WriteForbiddenError(DEMO_ONLY);
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_IMPORT_REQUEST_BYTES) {
      throw new ApiFailure("BAD_REQUEST", "Request is too large", { reason: "MANIFEST_TOO_LARGE", limitBytes: MAX_IMPORT_REQUEST_BYTES });
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_IMPORT_REQUEST_BYTES) {
      throw new ApiFailure("BAD_REQUEST", "Request is too large", { reason: "MANIFEST_TOO_LARGE", limitBytes: MAX_IMPORT_REQUEST_BYTES });
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiFailure("BAD_REQUEST", "Request body must be JSON");
    }
    const parsed = ManifestImportRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiFailure("BAD_REQUEST", "Invalid import", parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })));
    }
    const now = getNow({ env: ctx.env });
    const gate = () => {
      if (!isDemoModeEnabled(ctx.env)) throw new WriteForbiddenError(DEMO_ONLY);
    };
    const data = await ctx.db.$transaction(
      (tx) => importManifests(createRepositories(tx, { writeGate: gate, demoResetGate: gate }), parsed.data, now),
      { timeout: 30_000, maxWait: 30_000 },
    );
    return jsonData(data, await buildMeta({ repos: createReadOnlyRepositories(ctx.db), env: ctx.env }), 201);
  });
}
