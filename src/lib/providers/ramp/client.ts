/**
 * RampReadOnlyClient (FS-18). Server-only. Fetch is injected (tests use a fake; no network).
 *
 * Documented behaviour this client relies on (official docs, plain-text mirrors):
 * - Token: POST {base}/developer/v1/token, Authorization: Basic base64(client_id:client_secret),
 *   Content-Type application/x-www-form-urlencoded, body grant_type=client_credentials&scope=...;
 *   response { access_token, token_type: "Bearer", expires_in: 864000, scope }; no refresh token.
 *   https://docs.ramp.com/llms-guides/getting-started.txt , https://docs.ramp.com/llms-guides/authorization.txt
 * - Rate limits: 200 req / 10 s per IP (token endpoint 100 / 10 s); 429 Too Many Requests may block
 *   for 60 s and "Honor Retry-After when present"; retry reads with exponential backoff after a 504;
 *   max page size 100. https://docs.ramp.com/llms-guides/rate-limiting.txt
 * - List responses: { data: [...], page: { next: string | null } }. https://docs.ramp.com/llms-api.txt
 *
 * Safety: the ONLY non-GET request is the token POST. Data requests must be GET to an allow-listed
 * read path under {base}/developer/v1/; anything else (incl. any "vault" path) throws before fetching.
 * Every list item is scanned for card-secret keys and refused if any are present.
 */
import { findCardSecretKeys } from "@/lib/schema";
import { RAMP_READ_SCOPES, type RampConfig } from "./config";

export const RAMP_READ_PATHS = [
  "/developer/v1/transactions",
  "/developer/v1/funds",
  "/developer/v1/cards/physical",
  "/developer/v1/cards/virtual",
] as const;
export type RampReadPath = (typeof RAMP_READ_PATHS)[number];

export const RAMP_MAX_PAGES = 50;
export const RAMP_MAX_RETRIES = 3;
export const RAMP_TIMEOUT_MS = 15_000;
const TOKEN_EXPIRY_SKEW_S = 60;

export class RampApiError extends Error {
  constructor(
    readonly code: "AUTH_FAILED" | "FORBIDDEN_SCOPE" | "RATE_LIMITED" | "HTTP_ERROR" | "TIMEOUT" | "BLOCKED_REQUEST" | "SECRET_FIELDS" | "BAD_RESPONSE",
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "RampApiError";
  }
}

export type ClientDeps = {
  fetch: typeof fetch;
  /** Injected for tests; real time otherwise. */
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type Configured = Extract<RampConfig, { status: "CONFIGURED" }>;

export class RampReadOnlyClient {
  private token: { value: string; expiresAtMs: number } | null = null;
  private readonly nowMs: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Count of HTTP requests by method (tests assert only GET + the token POST). */
  readonly requestLog: { method: string; path: string }[] = [];

  constructor(
    private readonly cfg: Configured,
    private readonly deps: ClientDeps,
  ) {
    this.nowMs = deps.nowMs ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RAMP_TIMEOUT_MS);
    this.requestLog.push({ method: init.method ?? "GET", path: new URL(url).pathname });
    try {
      return await this.deps.fetch(url, { ...init, signal: controller.signal });
    } catch {
      throw new RampApiError(controller.signal.aborted ? "TIMEOUT" : "HTTP_ERROR", controller.signal.aborted ? "Ramp API timed out" : "Ramp API request failed");
    } finally {
      clearTimeout(timer);
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAtMs > this.nowMs()) return this.token.value;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
    const res = await this.send(`${this.cfg.baseUrl}/developer/v1/token`, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: RAMP_READ_SCOPES.join(" ") }).toString(),
    });
    if (res.status === 400 || res.status === 401) throw new RampApiError("AUTH_FAILED", `Ramp token request rejected (HTTP ${res.status})`, res.status);
    if (!res.ok) throw new RampApiError("HTTP_ERROR", `Ramp token request failed (HTTP ${res.status})`, res.status);
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string") throw new RampApiError("BAD_RESPONSE", "Ramp token response had no access_token");
    const ttl = typeof body.expires_in === "number" ? body.expires_in : 0;
    this.token = { value: body.access_token, expiresAtMs: this.nowMs() + Math.max(0, ttl - TOKEN_EXPIRY_SKEW_S) * 1000 };
    return this.token.value;
  }

  /** Validate a data URL: GET-only, same origin, allow-listed read path, never "vault". */
  private checkReadUrl(url: string): URL {
    const u = new URL(url);
    const allowed = u.origin === this.cfg.baseUrl && RAMP_READ_PATHS.some((p) => u.pathname === p) && !/vault/i.test(u.pathname);
    if (!allowed) throw new RampApiError("BLOCKED_REQUEST", `Blocked non-allow-listed Ramp request: ${u.pathname}`);
    return u;
  }

  private async getJson(url: string): Promise<unknown> {
    this.checkReadUrl(url);
    let authRetried = false;
    for (let attempt = 0; ; attempt++) {
      const res = await this.send(url, { method: "GET", headers: { authorization: `Bearer ${await this.accessToken()}`, accept: "application/json" } });
      if (res.ok) return res.json();
      if (res.status === 401 && !authRetried) {
        authRetried = true;
        this.token = null; // refresh once
        continue;
      }
      if (res.status === 401) throw new RampApiError("AUTH_FAILED", "Ramp rejected the access token", 401);
      if (res.status === 403) throw new RampApiError("FORBIDDEN_SCOPE", "Ramp token lacks a required read scope", 403);
      if ((res.status === 429 || res.status >= 500) && attempt < RAMP_MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = res.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 500 * 2 ** attempt;
        await this.sleep(waitMs);
        continue;
      }
      throw new RampApiError(res.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR", `Ramp API returned HTTP ${res.status}`, res.status);
    }
  }

  /** GET every page of a list endpoint by following page.next (validated), up to RAMP_MAX_PAGES. */
  async listAll(path: RampReadPath, query: Record<string, string> = {}): Promise<{ items: Record<string, unknown>[]; pages: number; truncated: boolean }> {
    let url: string | null = `${this.cfg.baseUrl}${path}?${new URLSearchParams({ page_size: "100", ...query }).toString()}`;
    const items: Record<string, unknown>[] = [];
    let pages = 0;
    while (url && pages < RAMP_MAX_PAGES) {
      const body = (await this.getJson(url)) as { data?: unknown; page?: { next?: unknown } } | null;
      if (!body || !Array.isArray(body.data)) throw new RampApiError("BAD_RESPONSE", `Ramp ${path} response had no data array`);
      const secrets = findCardSecretKeys(body.data);
      if (secrets.length > 0) throw new RampApiError("SECRET_FIELDS", `Ramp ${path} response contained card-secret fields; refused`);
      items.push(...(body.data as Record<string, unknown>[]));
      pages += 1;
      const next = body.page?.next;
      url = typeof next === "string" && next !== "" ? new URL(next, this.cfg.baseUrl).toString() : null;
      if (url) this.checkReadUrl(url);
    }
    return { items, pages, truncated: url !== null };
  }
}
