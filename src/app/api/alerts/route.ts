import { getDb } from "@/lib/db";
import { listAlertsHandler } from "../_lib/alerts";

export const dynamic = "force-dynamic";

/** GET /api/alerts[?view=active|all][&incidentId=]: in-app alerts (never sent externally). */
export async function GET(request: Request): Promise<Response> {
  return listAlertsHandler(request, { db: getDb(), env: process.env });
}
