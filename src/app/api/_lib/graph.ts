/** GET /api/graph handler body (testable without Next). */
import { buildGraphData } from "@/lib/graph/load";
import { buildMeta, handle, jsonData, type ApiContext } from "./http";

export function getGraph(ctx: ApiContext): Promise<Response> {
  return handle(async () => {
    const [data, meta] = await Promise.all([buildGraphData(ctx.repos), buildMeta(ctx)]);
    return jsonData(data, meta);
  });
}
