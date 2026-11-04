/**
 * Server-side write gate. Writes are permitted only when:
 *   - DEMO_MODE is enabled (see isDemoModeEnabled) in the server environment, or
 *   - ADMIN_TOKEN is configured (>= 16 chars) and the caller presents the same
 *     token (constant-time compare).
 * This is the protection for write routes; it is never a hidden frontend control.
 */
import { timingSafeEqual } from "node:crypto";
import { isDemoModeEnabled } from "@/lib/env";

export const ADMIN_TOKEN_HEADER = "x-failsafe-admin-token";
export const MIN_ADMIN_TOKEN_LENGTH = 16;

export class WriteForbiddenError extends Error {
  readonly code = "FORBIDDEN" as const;
  constructor(message = "Writes are disabled: DEMO_MODE is off and no valid admin token was provided") {
    super(message);
    this.name = "WriteForbiddenError";
  }
}

type GateEnv = Readonly<Record<string, string | undefined>>;

export type WriteGateInput = {
  /** Token presented by the caller (e.g. from the admin header). */
  adminToken?: string | null;
  /** Injected for tests; defaults to process.env. */
  env?: GateEnv;
};

function tokensMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isWriteAllowed({ adminToken, env = process.env }: WriteGateInput = {}): boolean {
  if (typeof window !== "undefined") return false;
  if (isDemoModeEnabled(env)) return true;
  const expected = env.ADMIN_TOKEN?.trim();
  if (!expected || expected.length < MIN_ADMIN_TOKEN_LENGTH) return false;
  if (!adminToken) return false;
  return tokensMatch(expected, adminToken);
}

export function assertWritesAllowed(input: WriteGateInput = {}): void {
  if (!isWriteAllowed(input)) throw new WriteForbiddenError();
}

/** Route-handler helper: reads the admin token from the request header. */
export function assertRequestWritesAllowed(request: Request, env: GateEnv = process.env): void {
  assertWritesAllowed({ adminToken: request.headers.get(ADMIN_TOKEN_HEADER), env });
}
