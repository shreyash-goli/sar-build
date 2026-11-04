/** POST /api/graph/edges/[id]/review handler body (FS-08; testable without Next). Demo mode only. */
import type { PrismaClient } from "@/generated/prisma/client";
import { isDemoModeEnabled } from "@/lib/env";
import { reviewEdge } from "@/lib/graph/review";
import { EdgeReviewRequestSchema } from "@/lib/graph/review-schema";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { createRepositories } from "@/lib/repositories";
import { IdSchema } from "@/lib/schema";
import { WriteForbiddenError } from "@/lib/security/write-gate";
import { getNow } from "@/lib/time";
import { ApiFailure, buildMeta, handle, jsonData } from "./http";

type Env = Readonly<Record<string, string | undefined>>;
const DEMO_ONLY = "Graph reviews are available only in demo mode (DEMO_MODE=true)";

export function reviewEdgeHandler(request: Request, id: string, ctx: { db: PrismaClient; env: Env }): Promise<Response> {
  return handle(async () => {
    const edgeId = IdSchema.safeParse(id);
    if (!edgeId.success) throw new ApiFailure("BAD_REQUEST", "Invalid edge id");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiFailure("BAD_REQUEST", "Request body must be JSON");
    }
    const parsed = EdgeReviewRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiFailure("BAD_REQUEST", "Invalid review", parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })));
    }
    if (!isDemoModeEnabled(ctx.env)) throw new WriteForbiddenError(DEMO_ONLY);
    const now = getNow({ env: ctx.env });
    const gate = () => {
      if (!isDemoModeEnabled(ctx.env)) throw new WriteForbiddenError(DEMO_ONLY);
    };
    const data = await ctx.db.$transaction(
      (tx) => reviewEdge(createRepositories(tx, { writeGate: gate, demoResetGate: gate }), edgeId.data, parsed.data, now),
      { timeout: 30_000, maxWait: 30_000 },
    );
    return jsonData(data, await buildMeta({ repos: createReadOnlyRepositories(ctx.db), env: ctx.env }));
  });
}
