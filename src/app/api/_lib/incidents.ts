/** GET /api/incidents and GET /api/incidents/[id] handler bodies (testable without Next). */
import { buildIncidentDetail, buildIncidentList } from "@/lib/incidents/load";
import { parseIncidentQuery } from "@/lib/incidents/schema";
import { IdSchema } from "@/lib/schema";
import { ApiFailure, buildMeta, handle, jsonData, type ApiContext } from "./http";

export function listIncidents(request: Request, ctx: ApiContext): Promise<Response> {
  return handle(async () => {
    const url = new URL(request.url);
    const params: Record<string, string[]> = {};
    for (const key of new Set(url.searchParams.keys())) params[key] = url.searchParams.getAll(key);
    const parsed = parseIncidentQuery(params);
    if (!parsed.ok) throw new ApiFailure("BAD_REQUEST", "Invalid query parameters", parsed.issues);
    const [data, meta] = await Promise.all([buildIncidentList(ctx.repos, parsed.query), buildMeta(ctx)]);
    return jsonData(data, { ...meta, evaluatedAt: latest(data.incidents.map((i) => i.updatedAt)) });
  });
}

export function getIncident(id: string, ctx: ApiContext): Promise<Response> {
  return handle(async () => {
    const parsed = IdSchema.safeParse(id);
    if (!parsed.success) throw new ApiFailure("BAD_REQUEST", "Invalid incident id");
    const [data, meta] = await Promise.all([buildIncidentDetail(ctx.repos, parsed.data), buildMeta(ctx)]);
    return jsonData(data, { ...meta, evaluatedAt: data.updatedAt });
  });
}

function latest(xs: readonly string[]): string | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => (new Date(b).getTime() > new Date(a).getTime() ? b : a));
}
