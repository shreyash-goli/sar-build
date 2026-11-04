/**
 * Shared route-handler plumbing (private folder: not routable).
 * Responses are `{ data, meta }` or `{ error: { code, message, details? } }`.
 * Unexpected errors are logged server-side and returned as a generic 500
 * without stack traces or internal messages.
 */
import { isDemoModeEnabled } from "@/lib/env";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { RepositoryError, type Repositories } from "@/lib/repositories";
import { API_ERROR_HTTP_STATUS, type ApiErrorCode, type ApiMeta } from "@/lib/schema";
import { WriteForbiddenError } from "@/lib/security/write-gate";
import { InvalidDemoClockError, getNowIso } from "@/lib/time";

type Env = Readonly<Record<string, string | undefined>>;

export type ApiContext = {
  repos: Repositories;
  env: Env;
};

/** Read-only repositories for GET handlers: any write attempt is refused. */
export function readOnlyContext(env: Env = process.env): ApiContext {
  return {
    env,
    repos: createReadOnlyRepositories(),
  };
}

export class ApiFailure extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

export function jsonData<T>(data: T, meta: ApiMeta, status = 200): Response {
  return Response.json({ data, meta }, { status, headers: { "cache-control": "no-store" } });
}

export function jsonError(code: ApiErrorCode, message: string, details?: unknown): Response {
  const error = details === undefined ? { code, message } : { code, message, details };
  return Response.json({ error }, { status: API_ERROR_HTTP_STATUS[code], headers: { "cache-control": "no-store" } });
}

export async function buildMeta({ repos, env }: ApiContext): Promise<ApiMeta> {
  const [workspace] = await repos.workspaces.list();
  let workspaceMode: ApiMeta["workspaceMode"];
  if (workspace) workspaceMode = workspace.mode;
  else if (isDemoModeEnabled(env)) workspaceMode = "DEMO";
  else throw new ApiFailure("NOT_CONFIGURED", "No workspace is configured. Run `pnpm db:seed` in demo mode.");
  return { workspaceMode, generatedAt: getNowIso({ env }), evaluatedAt: null };
}

/** Run a handler body and translate known errors into the error envelope. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiFailure) return jsonError(e.code, e.message, e.details);
    if (e instanceof RepositoryError) return jsonError(e.code, e.message, e.details);
    if (e instanceof WriteForbiddenError) return jsonError("FORBIDDEN", e.message);
    if (e instanceof InvalidDemoClockError) {
      // Misconfiguration, not a server bug: say what to fix, never fall back to real time.
      return jsonError("NOT_CONFIGURED", "DEMO_NOW is not a valid ISO timestamp with timezone (e.g. 2026-11-17T16:00:00Z).");
    }
    console.error("[api] unhandled error", e);
    return jsonError("INTERNAL_ERROR", "Internal error");
  }
}
