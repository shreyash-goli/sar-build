import { getDb } from "@/lib/db";
import { rampSyncHandler } from "../../../_lib/ramp";

export const dynamic = "force-dynamic";

/** POST /api/integrations/ramp/sync: read-only sync (503 when not configured; never writes to Ramp). */
export async function POST(request: Request): Promise<Response> {
  return rampSyncHandler(request, { db: getDb(), env: process.env });
}
