/**
 * LLM configuration for AI-assisted dependency suggestions (FS-19).
 * AI is OFF unless LLM_API_KEY and LLM_MODEL are both set; it is never faked.
 * LLM_BASE_URL is an OpenAI-compatible API root (default https://api.openai.com/v1).
 * The key is read server-side only and never returned to clients.
 */
export type LlmConfig =
  | { status: "AI_OFF"; reason: string; missing: string[] }
  | { status: "CONFIGURED"; apiKey: string; model: string; baseUrl: string };

type Env = Readonly<Record<string, string | undefined>>;

export const DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1";

export function readLlmConfig(env: Env = process.env): LlmConfig {
  const apiKey = env.LLM_API_KEY?.trim() ?? "";
  const model = env.LLM_MODEL?.trim() ?? "";
  const missing = [...(apiKey ? [] : ["LLM_API_KEY"]), ...(model ? [] : ["LLM_MODEL"])];
  if (missing.length > 0) {
    return { status: "AI_OFF", reason: `AI OFF: ${missing.join(" and ")} not set`, missing };
  }
  const raw = env.LLM_BASE_URL?.trim() || DEFAULT_LLM_BASE_URL;
  let baseUrl: string;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) {
      return { status: "AI_OFF", reason: "AI OFF: LLM_BASE_URL must be https (or http on localhost)", missing: ["LLM_BASE_URL"] };
    }
    baseUrl = u.toString().replace(/\/+$/, "");
  } catch {
    return { status: "AI_OFF", reason: "AI OFF: LLM_BASE_URL is not a valid URL", missing: ["LLM_BASE_URL"] };
  }
  return { status: "CONFIGURED", apiKey, model, baseUrl };
}

/** Client-safe status (no key, no full URL path). */
export function publicLlmStatus(cfg: LlmConfig) {
  return cfg.status === "CONFIGURED"
    ? { status: "CONFIGURED" as const, model: cfg.model, host: new URL(cfg.baseUrl).host, reason: null, missing: [] as string[] }
    : { status: "AI_OFF" as const, model: null, host: null, reason: cfg.reason, missing: cfg.missing };
}
