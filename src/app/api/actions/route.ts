import { getDb } from "@/lib/db";
import { listActionsHandler } from "../_lib/actions";

export const dynamic = "force-dynamic";

/** GET /api/actions[?incidentId=]: action proposals, newest first. SIMULATION ONLY. */
export async function GET(request: Request): Promise<Response> {
  return listActionsHandler(request, { db: getDb(), env: process.env });
}
