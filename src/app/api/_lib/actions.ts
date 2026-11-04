/**
 * Action proposal handler bodies (FS-15; testable without Next).
 * Writes are demo-mode only and transactional; every response carries the
 * SIMULATION ONLY notice.
 */
import type * as z from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { buildActionList } from "@/lib/actions/load";
import {
  ApproveActionRequestSchema,
  ProposeActionRequestSchema,
  RejectActionRequestSchema,
  SubmitActionRequestSchema,
} from "@/lib/actions/schema";
import { approveAction, proposeAction, rejectAction, submitAction } from "@/lib/actions/service";
import { viewById } from "@/lib/actions/view";
import { isDemoModeEnabled } from "@/lib/env";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { NotFoundError, createRepositories, type Repositories } from "@/lib/repositories";
import { IdSchema } from "@/lib/schema";
import { WriteForbiddenError } from "@/lib/security/write-gate";
import { getNow } from "@/lib/time";
import { ApiFailure, buildMeta, handle, jsonData } from "./http";

type Env = Readonly<Record<string, string | undefined>>;
export type ActionsContext = { db: PrismaClient; env: Env };

const DEMO_ONLY = "Response actions are available only in demo mode (DEMO_MODE=true)";

async function readBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiFailure("BAD_REQUEST", "Request body must be JSON");
  }
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new ApiFailure(
      "BAD_REQUEST",
      "Invalid request",
      r.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    );
  }
  return r.data;
}

function parseId(id: string): string {
  const r = IdSchema.safeParse(id);
  if (!r.success) throw new ApiFailure("BAD_REQUEST", "Invalid action id");
  return r.data;
}

async function write<T>(ctx: ActionsContext, status: number, fn: (repos: Repositories, now: Date) => Promise<T>): Promise<Response> {
  if (!isDemoModeEnabled(ctx.env)) throw new WriteForbiddenError(DEMO_ONLY);
  const now = getNow({ env: ctx.env });
  const gate = () => {
    if (!isDemoModeEnabled(ctx.env)) throw new WriteForbiddenError(DEMO_ONLY);
  };
  const data = await ctx.db.$transaction((tx) => fn(createRepositories(tx, { writeGate: gate, demoResetGate: gate }), now));
  const meta = await buildMeta({ repos: createReadOnlyRepositories(ctx.db), env: ctx.env });
  return jsonData(data, meta, status);
}

export function proposeActionHandler(request: Request, ctx: ActionsContext): Promise<Response> {
  return handle(async () => {
    const body = await readBody(request, ProposeActionRequestSchema);
    return write(ctx, 201, (repos, now) => proposeAction(repos, body, now));
  });
}

export function submitActionHandler(request: Request, id: string, ctx: ActionsContext): Promise<Response> {
  return handle(async () => {
    const actionId = parseId(id);
    const body = await readBody(request, SubmitActionRequestSchema);
    return write(ctx, 200, (repos, now) => submitAction(repos, actionId, body, now));
  });
}

export function approveActionHandler(request: Request, id: string, ctx: ActionsContext): Promise<Response> {
  return handle(async () => {
    const actionId = parseId(id);
    const body = await readBody(request, ApproveActionRequestSchema);
    return write(ctx, 200, (repos, now) => approveAction(repos, actionId, body, now));
  });
}

export function rejectActionHandler(request: Request, id: string, ctx: ActionsContext): Promise<Response> {
  return handle(async () => {
    const actionId = parseId(id);
    const body = await readBody(request, RejectActionRequestSchema);
    return write(ctx, 200, (repos, now) => rejectAction(repos, actionId, body, now));
  });
}

export function listActionsHandler(request: Request, ctx: ActionsContext): Promise<Response> {
  return handle(async () => {
    const url = new URL(request.url);
    const unknown = [...new Set(url.searchParams.keys())].filter((k) => k !== "incidentId");
    if (unknown.length > 0) throw new ApiFailure("BAD_REQUEST", `Unknown query parameter(s): ${unknown.join(", ")}`);
    const values = url.searchParams.getAll("incidentId");
    if (values.length > 1) throw new ApiFailure("BAD_REQUEST", '"incidentId" may only be given once');
    const repos = createReadOnlyRepositories(ctx.db);
    let incidentId: string | undefined;
    if (values.length === 1) {
      incidentId = parseId(values[0]!);
      await repos.incidents.getById(incidentId); // 404
    }
    const [data, meta] = await Promise.all([buildActionList(repos, incidentId), buildMeta({ repos, env: ctx.env })]);
    return jsonData(data, meta);
  });
}

export function getActionHandler(id: string, ctx: ActionsContext): Promise<Response> {
  return handle(async () => {
    const repos = createReadOnlyRepositories(ctx.db);
    const view = await viewById(repos, parseId(id));
    if (!view) throw new NotFoundError("Action proposal", id);
    return jsonData(view, await buildMeta({ repos, env: ctx.env }));
  });
}
