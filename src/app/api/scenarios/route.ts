import { getDb } from "@/lib/db";
import { listScenarios } from "../_lib/scenarios";

export const dynamic = "force-dynamic";

/** GET /api/scenarios[?incidentId=]: past simulations, newest first. */
export async function GET(request: Request): Promise<Response> {
  return listScenarios(request, { db: getDb(), env: process.env });
}
