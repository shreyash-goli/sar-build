/**
 * Read-only Ramp adapter configuration (FS-18). Server-only; secrets never leave the server.
 *
 * Sources (official docs, read via their plain-text mirrors):
 * - Hosts and token: https://docs.ramp.com/llms-guides/getting-started.txt
 *   sandbox API https://demo-api.ramp.com, production https://api.ramp.com
 * - Scopes: https://docs.ramp.com/llms-guides/authorization.txt
 *
 * Only read scopes are requested. `cards:read_vault` (PAN/CVV) is never requested.
 * Only the sandbox is supported in this MVP: any other base URL (including production) is
 * NOT_CONFIGURED, so production data can never be labelled as sandbox data.
 */
export const RAMP_SANDBOX_BASE_URL = "https://demo-api.ramp.com";
export const RAMP_READ_SCOPES = ["transactions:read", "cards:read", "funds:read"] as const;
export const RAMP_READONLY_LABEL = "READ-ONLY RAMP SANDBOX" as const;

type Env = Readonly<Record<string, string | undefined>>;

export type RampConfig =
  | { status: "NOT_CONFIGURED"; reason: string; missing: string[] }
  | { status: "CONFIGURED"; clientId: string; clientSecret: string; baseUrl: typeof RAMP_SANDBOX_BASE_URL; sandbox: true };

function origin(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

export function readRampConfig(env: Env = process.env): RampConfig {
  const clientId = env.RAMP_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.RAMP_CLIENT_SECRET?.trim() ?? "";
  const missing = [...(clientId ? [] : ["RAMP_CLIENT_ID"]), ...(clientSecret ? [] : ["RAMP_CLIENT_SECRET"])];
  if (missing.length > 0) return { status: "NOT_CONFIGURED", reason: `Ramp sandbox not connected: ${missing.join(" and ")} not set`, missing };
  const baseUrl = origin(env.RAMP_API_BASE_URL?.trim() || RAMP_SANDBOX_BASE_URL);
  if (baseUrl !== RAMP_SANDBOX_BASE_URL) {
    return {
      status: "NOT_CONFIGURED",
      reason: `Only the Ramp sandbox is supported in this MVP: RAMP_API_BASE_URL must be ${RAMP_SANDBOX_BASE_URL} (or blank)`,
      missing: ["RAMP_API_BASE_URL"],
    };
  }
  return { status: "CONFIGURED", clientId, clientSecret, baseUrl, sandbox: true };
}

/** Client-safe status (never the id/secret). */
export function publicRampStatus(cfg: RampConfig) {
  return cfg.status === "CONFIGURED"
    ? { status: "CONFIGURED" as const, host: new URL(cfg.baseUrl).host, sandbox: cfg.sandbox, reason: null, missing: [] as string[] }
    : { status: "NOT_CONFIGURED" as const, host: null, sandbox: null, reason: cfg.reason, missing: cfg.missing };
}
