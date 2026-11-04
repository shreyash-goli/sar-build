/**
 * Read-only Ramp integration handlers (FS-18; testable without Next).
 * - Not configured: 503 NOT_CONFIGURED, and no request is made to Ramp.
 * - Sync requires the write gate (DEMO_MODE or the ADMIN_TOKEN header) AND a RAMP_SANDBOX
 *   workspace (409 otherwise: demo data and Ramp data are never mixed; see `pnpm ramp:init`).
 * - Network reads happen outside the DB transaction; writes happen inside one.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { RampReadOnlyClient } from "@/lib/providers/ramp/client";
import { publicRampStatus, readRampConfig } from "@/lib/providers/ramp/config";
import { RAMP_LABEL, RAMP_NOTICE, type RampStatus } from "@/lib/providers/ramp/schema";
import { RAMP_SYNC_AUDIT_ACTION, applyRampSnapshot, fetchRampSnapshot } from "@/lib/providers/ramp/sync";
import { createRepositories, type Repositories } from "@/lib/repositories";
import { assertRequestWritesAllowed } from "@/lib/security/write-gate";
import { getNow } from "@/lib/time";
import { ApiFailure, buildMeta, handle, jsonData } from "./http";
import { assertSameOriginWrite } from "./request";

type Env = Readonly<Record<string, string | undefined>>;
export type RampContext = { db: PrismaClient; env: Env; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> };

async function statusOf(repos: Repositories, env: Env): Promise<RampStatus> {
  const cfg = readRampConfig(env);
  const [workspace] = await repos.workspaces.list();
  const mode = workspace?.mode ?? null;
  const last = workspace
    ? (await repos.auditEvents.listBySubject(workspace.id)).filter((a) => a.action === RAMP_SYNC_AUDIT_ACTION).at(-1)
    : undefined;
  const lastStatus = (last?.detailsJson as { status?: unknown } | undefined)?.status;
  const syncBlockedReason =
    cfg.status !== "CONFIGURED"
      ? cfg.reason
      : mode !== "RAMP_SANDBOX"
        ? `Workspace is ${mode ?? "missing"}; run \`pnpm ramp:init\` to create an empty RAMP_SANDBOX workspace (demo and Ramp data are never mixed).`
        : null;
  return {
    ...publicRampStatus(cfg),
    label: RAMP_LABEL,
    workspaceMode: mode,
    syncAllowed: syncBlockedReason === null,
    syncBlockedReason,
    lastSync: last && (lastStatus === "OK" || lastStatus === "PARTIAL" || lastStatus === "FAILED") ? { at: last.at, status: lastStatus } : null,
    notice: RAMP_NOTICE,
  };
}

export function rampStatusHandler(ctx: RampContext): Promise<Response> {
  return handle(async () => {
    const repos = createReadOnlyRepositories(ctx.db);
    return jsonData(await statusOf(repos, ctx.env), await buildMeta({ repos, env: ctx.env }));
  });
}

export function rampSyncHandler(request: Request, ctx: RampContext): Promise<Response> {
  return handle(async () => {
    const cfg = readRampConfig(ctx.env);
    if (cfg.status !== "CONFIGURED") {
      throw new ApiFailure("NOT_CONFIGURED", cfg.reason, { reason: "RAMP_NOT_CONFIGURED", missing: cfg.missing });
    }
    assertRequestWritesAllowed(request, ctx.env);
    assertSameOriginWrite(request, ctx.env);
    const read = createReadOnlyRepositories(ctx.db);
    const [workspace] = await read.workspaces.list();
    if (workspace?.mode !== "RAMP_SANDBOX") {
      throw new ApiFailure("INVALID_TRANSITION", "Ramp sync is only allowed in a RAMP_SANDBOX workspace; run `pnpm ramp:init` first", {
        workspaceMode: workspace?.mode ?? null,
      });
    }
    const now = getNow({ env: ctx.env });
    const client = new RampReadOnlyClient(cfg, { fetch: ctx.fetch ?? fetch, sleep: ctx.sleep });
    const snapshot = await fetchRampSnapshot(client); // network: outside the transaction
    const allowAll = () => undefined; // the request was authorized above
    const result = await ctx.db.$transaction(
      (tx) =>
        applyRampSnapshot(createRepositories(tx, { writeGate: allowAll, demoResetGate: allowAll }), snapshot, {
          now,
          classification: "RAMP_SANDBOX", // only the sandbox host is ever configured
          actor: "ramp-sync",
        }),
      { timeout: 60_000, maxWait: 60_000 },
    );
    // FAILED (nothing could be read) is 502 with the per-resource errors in the body; OK/PARTIAL are 200.
    return jsonData(result, await buildMeta({ repos: read, env: ctx.env }), result.status === "FAILED" ? 502 : 200);
  });
}
