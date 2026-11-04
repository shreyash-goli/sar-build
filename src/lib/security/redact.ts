/**
 * Log redaction (FS-21). Server-side logs never print secrets: URL credentials, bearer
 * tokens, common API-key shapes, `key=value` secrets, private-key blocks, and the exact
 * values of secret environment variables are replaced before anything reaches the console.
 * Error objects are reduced to name, code, message and a few stack frames, all redacted.
 */
type Env = Readonly<Record<string, string | undefined>>;

/** Environment variables whose values must never appear in logs. */
export const SECRET_ENV_KEYS = ["LLM_API_KEY", "RAMP_CLIENT_ID", "RAMP_CLIENT_SECRET", "ADMIN_TOKEN", "DATABASE_AUTH_TOKEN", "LIBSQL_AUTH_TOKEN"] as const;

export const REDACTED = "[redacted]";

const PATTERNS: readonly [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, REDACTED],
  [/([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/@"'?#]+@/g, `$1${REDACTED}@`],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${REDACTED}`],
  [/\b(?:sk|pk|rk)[-_](?:live|test|proj)?[-_]?[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{8,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{12,}/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{6,}/g, REDACTED],
  [/\bramp_[a-z]+_tok_[A-Za-z0-9]+/g, REDACTED],
  // key=value / "key": "value" / key: value for secret-like keys (incl. query strings).
  [/((?:api[_-]?key|secret|token|password|passwd|pwd|authorization|auth[_-]?token|access[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi, `$1${REDACTED}`],
];

export function redactSecrets(text: string, env: Env = process.env): string {
  let out = text;
  for (const key of SECRET_ENV_KEYS) {
    const v = env[key]?.trim();
    if (v && v.length >= 6) out = out.split(v).join(REDACTED);
  }
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

const MAX_STACK_FRAMES = 6;
const MAX_MESSAGE = 1000;

/** One-line-ish, redacted description of an unknown thrown value (no raw object dump). */
export function safeErrorSummary(e: unknown, env: Env = process.env): string {
  if (e instanceof Error) {
    const code = (e as { code?: unknown }).code;
    const head = `${e.name}${typeof code === "string" || typeof code === "number" ? ` [${code}]` : ""}: ${e.message.slice(0, MAX_MESSAGE)}`;
    const frames = (e.stack ?? "")
      .split("\n")
      .filter((l) => /^\s+at /.test(l))
      .slice(0, MAX_STACK_FRAMES);
    return redactSecrets([head, ...frames].join("\n"), env);
  }
  let s: string;
  try {
    s = typeof e === "string" ? e : JSON.stringify(e);
  } catch {
    s = String(e);
  }
  return redactSecrets(`Non-error thrown: ${String(s).slice(0, MAX_MESSAGE)}`, env);
}

/** console.error with a scope tag and a redacted error summary. */
export function logServerError(scope: string, e: unknown, env: Env = process.env): void {
  console.error(`[${scope}]`, safeErrorSummary(e, env));
}
