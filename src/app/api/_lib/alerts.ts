/** Alert handler bodies (FS-20; testable without Next). Writes are demo-mode only. In-app only. */
import type * as z from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { AckAlertRequestSchema, AlertListQuerySchema, SnoozeAlertRequestSchema } from "@/lib/alerts/schema";
import { ackAlert, buildAlertList, snoozeAlert } from "@/lib/alerts/service";
import { isDemoModeEnabled } from "@/lib/env";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { createRepositories, type Repositories } from "@/lib/repositories";
import { IdSchema } from "@/lib/schema";
import { WriteForbiddenError } from "@/lib/security/write-gate";
import { getNow, resolveDemoClock } from "@/lib/time";
import { ApiFailure, buildMeta, handle, jsonData } from "./http";

type Env = Readonly<Record<string, string | undefined>>;
type Ctx = { db: PrismaClient; env: Env };
const DEMO_ONLY = "Alert actions are available only in demo mode (DEMO_MODE=true)";
const issues = (i: readonly { path: PropertyKey[]; message: string }[]) => i.map((x) => ({ path: x.path.map(String).join("."), message: x.message }));

export function listAlertsHandler(request: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const url = new URL(request.url);
    const raw: Record<string, string> = {};
    for (const key of new Set(url.searchParams.keys())) {
      const values = url.searchParams.getAll(key);
      if (values.length > 1) throw new ApiFailure("BAD_REQUEST", `"${key}" may only be given once`);
      if (values[0] !== "") raw[key] = values[0]!;
    }
    const q = AlertListQuerySchema.safeParse(raw);
    if (!q.success) throw new ApiFailure("BAD_REQUEST", "Invalid query parameters", issues(q.error.issues));
    const repos = createReadOnlyRepositories(ctx.db);
    if (q.data.incidentId) await repos.incidents.getById(q.data.incidentId); // 404
    const now = getNow({ env: ctx.env });
    const [data, meta] = await Promise.all([buildAlertList(repos, q.data, now, resolveDemoClock(ctx.env) !== null), buildMeta({ repos, env: ctx.env })]);
    return jsonData(data, meta);
  });
}

async function mutate<S extends z.ZodType, T>(
  request: Request,
  id: string,
  ctx: Ctx,
  schema: S,
  fn: (repos: Repositories, id: string, body: z.output<S>, now: Date) => Promise<T>,
): Promise<Response> {
  if (!isDemoModeEnabled(ctx.env)) throw new WriteForbiddenError(DEMO_ONLY);
  const alertId = IdSchema.safeParse(id);
  if (!alertId.success) throw new ApiFailure("BAD_REQUEST", "Invalid alert id");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiFailure("BAD_REQUEST", "Request body must be JSON");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiFailure("BAD_REQUEST", "Invalid request", issues(parsed.error.issues));
  const now = getNow({ env: ctx.env });
  const gate = () => {
    if (!isDemoModeEnabled(ctx.env)) throw new WriteForbiddenError(DEMO_ONLY);
  };
  const data = await ctx.db.$transaction((tx) => fn(createRepositories(tx, { writeGate: gate, demoResetGate: gate }), alertId.data, parsed.data, now));
  return jsonData(data, await buildMeta({ repos: createReadOnlyRepositories(ctx.db), env: ctx.env }));
}

export function ackAlertHandler(request: Request, id: string, ctx: Ctx): Promise<Response> {
  return handle(() => mutate(request, id, ctx, AckAlertRequestSchema, (repos, alertId, body, now) => ackAlert(repos, alertId, body.actor, now)));
}

export function snoozeAlertHandler(request: Request, id: string, ctx: Ctx): Promise<Response> {
  return handle(() => mutate(request, id, ctx, SnoozeAlertRequestSchema, (repos, alertId, body, now) => snoozeAlert(repos, alertId, body, now)));
}
