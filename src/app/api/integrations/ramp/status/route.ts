import { getDb } from "@/lib/db";
import { rampStatusHandler } from "../../../_lib/ramp";

export const dynamic = "force-dynamic";

/** GET /api/integrations/ramp/status: read-only Ramp connection status (never the credentials). */
export async function GET(): Promise<Response> {
  return rampStatusHandler({ db: getDb(), env: process.env });
}
