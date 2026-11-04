import { getDb } from "@/lib/db";
import { importManifestHandler } from "../../_lib/imports";

export const dynamic = "force-dynamic";

/** POST /api/imports/manifest: suggest edges from static manifest text (never executed). Demo mode only. */
export async function POST(request: Request): Promise<Response> {
  return importManifestHandler(request, { db: getDb(), env: process.env });
}
