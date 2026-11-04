/**
 * POST /api/demo/reset handler body (FS-17; testable without Next).
 *
 * Authorization (server-side only; no client-provided flag is trusted):
 * 1. DEMO_MODE must be enabled in the server environment.
 * 2. The request must be LOCAL:
 *    - the Host header's hostname must be loopback (localhost, 127.0.0.1, ::1) or
 *      listed in DEMO_RESET_ALLOWED_HOSTS (comma-separated, e.g. for a LAN demo box);
 *    - and it must not be a cross-site browser request: if an Origin header is
 *      present its hostname must be allowed too, and Sec-Fetch-Site "cross-site"
 *      is refused. Browsers set these headers and page scripts cannot forge them,
 *      so a malicious page cannot trigger a reset on a developer's localhost.
 * Reset clears audit events, so it cannot audit itself: it is logged server-side.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { resetNorthstarDemo } from "@/lib/demo/northstar";
import { DEMO_RESET_NOTICE, type DemoResetData } from "@/lib/demo/reset-schema";
import { isDemoModeEnabled } from "@/lib/env";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { WriteForbiddenError } from "@/lib/security/write-gate";
import { ApiFailure, buildMeta, handle, jsonData } from "./http";

type Env = Readonly<Record<string, string | undefined>>;
const LOOPBACK = ["localhost", "127.0.0.1", "::1"];

function hostnameOf(value: string): string | null {
  try {
    // Host header has no scheme; Origin does.
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Wildcards are not supported: "*", "*.lan", "demo?.lan" etc. are ignored (fail closed), never treated as patterns. */
const WILDCARD = /[*?]/;

/**
 * Loopback plus DEMO_RESET_ALLOWED_HOSTS, each entry normalized like the request Host
 * (scheme/port stripped, lowercased). Entries with wildcard characters are rejected.
 */
export function allowedResetHosts(env: Env): Set<string> {
  const entries = (env.DEMO_RESET_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const wildcards = entries.filter((h) => WILDCARD.test(h));
  if (wildcards.length > 0) {
    console.warn("[demo-reset] ignoring DEMO_RESET_ALLOWED_HOSTS wildcard entries (exact hostnames only):", wildcards.join(", "));
  }
  const extra = entries
    .filter((h) => !WILDCARD.test(h))
    .map(hostnameOf)
    .filter((h): h is string => h !== null && h !== "");
  return new Set([...LOOPBACK, ...extra]);
}

/** Throws WriteForbiddenError unless the request is local and same-origin. */
export function assertLocalRequest(request: Request, env: Env): void {
  const allowed = allowedResetHosts(env);
  const host = hostnameOf(request.headers.get("host") ?? new URL(request.url).host);
  if (!host || !allowed.has(host)) {
    throw new WriteForbiddenError("Demo reset is allowed only from the local machine (Host must be localhost)");
  }
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== "null") {
    const o = hostnameOf(origin);
    if (!o || !allowed.has(o)) throw new WriteForbiddenError("Demo reset refused: cross-origin request");
  } else if (origin === "null") {
    throw new WriteForbiddenError("Demo reset refused: opaque origin");
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new WriteForbiddenError("Demo reset refused: cross-site request");
  }
}

export function demoResetHandler(request: Request, ctx: { db: PrismaClient; env: Env }): Promise<Response> {
  return handle(async () => {
    if (!isDemoModeEnabled(ctx.env)) throw new WriteForbiddenError("Demo reset requires DEMO_MODE=true on the server");
    assertLocalRequest(request, ctx.env);
    const text = await request.text();
    if (text.trim() !== "" && text.trim() !== "{}") throw new ApiFailure("BAD_REQUEST", "Demo reset takes no request body");

    const r = await resetNorthstarDemo(ctx.db, { env: ctx.env });
    const data: DemoResetData = {
      fixture: { id: r.seed.fixtureId, version: r.seed.fixtureVersion },
      cleared: r.cleared,
      recreated: r.seed.created,
      incidents: {
        regenerated: r.regenerated.incidents,
        incidentIds: [...r.seed.incidents.created].sort(),
        evaluatedAt: r.seed.incidents.evaluatedAt,
      },
      notice: DEMO_RESET_NOTICE,
    };
    console.info("[demo-reset]", JSON.stringify({ at: data.incidents.evaluatedAt, cleared: data.cleared, recreated: data.recreated, incidents: data.incidents.regenerated }));
    return jsonData(data, await buildMeta({ repos: createReadOnlyRepositories(ctx.db), env: ctx.env }));
  });
}
