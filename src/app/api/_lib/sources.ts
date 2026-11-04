/** GET /api/sources and GET /api/sources/[id] handler bodies (testable without Next). */
import { buildEvidenceLedger, getEvidenceLedgerEntry } from "@/lib/provenance/ledger";
import { SourcesListQuerySchema } from "@/lib/provenance/ledger-schema";
import { IdSchema } from "@/lib/schema";
import { ApiFailure, buildMeta, handle, jsonData, type ApiContext } from "./http";

function parseQuery(url: URL) {
  const raw: Record<string, string> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    if (values.length > 1) throw new ApiFailure("BAD_REQUEST", `Query parameter "${key}" may only be given once`);
    raw[key] = values[0]!;
  }
  const r = SourcesListQuerySchema.safeParse(raw);
  if (!r.success) {
    throw new ApiFailure(
      "BAD_REQUEST",
      "Invalid query parameters",
      r.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    );
  }
  return r.data;
}

export function listSources(request: Request, ctx: ApiContext): Promise<Response> {
  return handle(async () => {
    const query = parseQuery(new URL(request.url));
    const [data, meta] = await Promise.all([buildEvidenceLedger(ctx.repos, query), buildMeta(ctx)]);
    return jsonData(data, meta);
  });
}

export function getSource(id: string, ctx: ApiContext): Promise<Response> {
  return handle(async () => {
    const parsed = IdSchema.safeParse(id);
    if (!parsed.success) throw new ApiFailure("BAD_REQUEST", "Invalid evidence id");
    const [data, meta] = await Promise.all([getEvidenceLedgerEntry(ctx.repos, parsed.data), buildMeta(ctx)]);
    return jsonData(data, meta);
  });
}
