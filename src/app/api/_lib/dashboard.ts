/** GET /api/dashboard handler body (testable without Next). */
import { buildDashboardData } from "@/lib/dashboard/load";
import { buildMeta, handle, jsonData, type ApiContext } from "./http";

export function getDashboard(ctx: ApiContext): Promise<Response> {
  return handle(async () => {
    const [data, meta] = await Promise.all([buildDashboardData(ctx.repos, ctx.env), buildMeta(ctx)]);
    return jsonData(data, { ...meta, evaluatedAt: data.resultsEvaluatedAt });
  });
}
