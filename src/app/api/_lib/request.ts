/**
 * Request-body and origin guards for write routes (FS-21; private folder, not routable).
 *
 * - Bodies are read with a hard byte limit: a declared Content-Length over the limit is
 *   refused before reading, and the stream is cancelled as soon as the limit is passed
 *   (a missing or lying Content-Length cannot make the server buffer more).
 * - Cross-site browser writes are refused (CSRF): `Sec-Fetch-Site: cross-site`, an opaque
 *   `Origin: null`, or an Origin whose host differs from the request host. Requests without
 *   an Origin header (curl, server-to-server, tests) are not browser-initiated cross-site
 *   writes and are judged by the write gate alone.
 */
import type * as z from "zod";
import { WriteForbiddenError } from "@/lib/security/write-gate";
import { ApiFailure } from "./http";

/** Default limit for JSON write bodies (all current request schemas are far smaller). */
export const MAX_JSON_BODY_BYTES = 16 * 1024;

type LimitOptions = { maxBytes?: number; reason?: string };

function tooLarge(maxBytes: number, reason: string): ApiFailure {
  return new ApiFailure("BAD_REQUEST", "Request is too large", { reason, limitBytes: maxBytes });
}

export async function readLimitedText(request: Request, { maxBytes = MAX_JSON_BODY_BYTES, reason = "BODY_TOO_LARGE" }: LimitOptions = {}): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) throw tooLarge(maxBytes, reason);
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(maxBytes, reason);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

const issuesOf = (issues: readonly { path: PropertyKey[]; message: string }[]) =>
  issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));

/** Read (size-limited), parse and validate a JSON body. */
export async function readJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  options: LimitOptions & { invalidMessage?: string } = {},
): Promise<z.output<S>> {
  const text = await readLimitedText(request, options);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiFailure("BAD_REQUEST", "Request body must be JSON");
  }
  const r = schema.safeParse(body);
  if (!r.success) throw new ApiFailure("BAD_REQUEST", options.invalidMessage ?? "Invalid request", issuesOf(r.error.issues));
  return r.data;
}

const firstHost = (h: string | null) => h?.split(",")[0]?.trim().toLowerCase() || null;

/** Refuse browser-initiated cross-site writes (see module comment). */
export function assertSameOriginWrite(request: Request): void {
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new WriteForbiddenError("Write refused: cross-site request");
  const origin = request.headers.get("origin");
  if (origin === null) return;
  if (origin === "null") throw new WriteForbiddenError("Write refused: opaque origin");
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    throw new WriteForbiddenError("Write refused: invalid Origin header");
  }
  const hosts = [firstHost(request.headers.get("x-forwarded-host")), firstHost(request.headers.get("host")), new URL(request.url).host.toLowerCase()];
  if (!hosts.includes(originHost)) throw new WriteForbiddenError("Write refused: cross-origin request");
}

/**
 * Standard order for a JSON write route: authorization gate, then origin check, then the
 * size-limited body. Nothing is read from an unauthorized or cross-site request.
 */
export async function readAuthorizedJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  gate: () => void,
  options: LimitOptions & { invalidMessage?: string } = {},
): Promise<z.output<S>> {
  gate();
  assertSameOriginWrite(request);
  return readJsonBody(request, schema, options);
}
