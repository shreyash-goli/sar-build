import { getDb } from "@/lib/db";
import { snoozeAlertHandler } from "../../../_lib/alerts";

export const dynamic = "force-dynamic";

/** POST /api/alerts/[id]/snooze: demo-mode, audited. In-app only: no external notification sent. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return snoozeAlertHandler(request, id, { db: getDb(), env: process.env });
}
