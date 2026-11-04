import { describe, expect, it } from "vitest";
import { publicLlmStatus, readLlmConfig } from "@/lib/providers/llm/config";
import {
  MAX_PROMPT_CHARS,
  MAX_PROMPT_FINDINGS,
  ModelCallError,
  NON_SEMVER_PLACEHOLDER,
  buildPrompt,
  promptVersion,
  openAiCompatibleCaller,
  planAiSuggestions,
  validateModelOutput,
  type SuggestionContext,
} from "@/lib/providers/llm-suggestions";

const ctx: SuggestionContext = {
  service: { id: "node-service-incident-monitoring", label: "Incident monitoring" },
  findings: [
    { filename: "package.json", line: null, token: "@cloudcomms/sdk", version: "1.0.0" },
    { filename: "package.json", line: null, token: "express", version: "4" },
    { filename: "package.json", line: null, token: "twilio", version: "^5.0.0" },
  ],
  vendors: [
    { nodeId: "node-vendor-cloudcomms", label: "CloudComms", normalizedKey: "cloudcomms" },
    { nodeId: "node-vendor-webhookworks", label: "WebhookWorks", normalizedKey: "webhookworks" },
  ],
};
const good = {
  source: { filename: "package.json", token: "@cloudcomms/sdk" },
  providerId: "cloudcomms",
  vendorNodeId: "node-vendor-cloudcomms",
  explanation: "An SDK package from the CloudComms SMS vendor.",
  uncertainty: "LOW",
};
const out = (...suggestions: unknown[]) => JSON.stringify({ suggestions });

describe("readLlmConfig", () => {
  it("AI OFF without key or model; configured otherwise; key never exposed", () => {
    expect(readLlmConfig({})).toMatchObject({ status: "AI_OFF", missing: ["LLM_API_KEY", "LLM_MODEL"] });
    expect(readLlmConfig({ LLM_API_KEY: "k" })).toMatchObject({ status: "AI_OFF", missing: ["LLM_MODEL"] });
    expect(readLlmConfig({ LLM_API_KEY: "k", LLM_MODEL: "m", LLM_BASE_URL: "http://evil.example/v1" })).toMatchObject({ status: "AI_OFF" });
    expect(readLlmConfig({ LLM_API_KEY: "k", LLM_MODEL: "m", LLM_BASE_URL: "not a url" })).toMatchObject({ status: "AI_OFF" });
    const cfg = readLlmConfig({ LLM_API_KEY: "secret-key", LLM_MODEL: "m" });
    expect(cfg).toMatchObject({ status: "CONFIGURED", baseUrl: "https://api.openai.com/v1", model: "m" });
    expect(readLlmConfig({ LLM_API_KEY: "k", LLM_MODEL: "m", LLM_BASE_URL: "http://localhost:11434/v1/" })).toMatchObject({ baseUrl: "http://localhost:11434/v1" });
    expect(JSON.stringify(publicLlmStatus(cfg))).not.toContain("secret-key");
    expect(publicLlmStatus(readLlmConfig({}))).toMatchObject({ status: "AI_OFF", model: null, host: null });
  });
});

describe("prompt", () => {
  it("contains only curated context; only taxonomy-recognised tokens; bounded", () => {
    const p = buildPrompt({ ...ctx, findings: [...ctx.findings, { filename: "main.tf", line: 3, token: "sk-ABCDEFGHIJ1234567890", version: null }] });
    expect(p.user).toContain("@cloudcomms/sdk");
    expect(p.user).toContain('"id":"cloudcomms"');
    expect(p.user).toContain("node-vendor-cloudcomms");
    expect(p.user).not.toContain("sk-ABCDEFGHIJ");
    expect(p.user).not.toContain('"token":"express"'); // not in the taxonomy: never sent
    expect(p).toMatchObject({ sentFindings: 2, omittedFindings: 2 });
    expect(p.user).not.toContain("normalizedKey");
    expect(p.system).toMatch(/Never invent files, tokens, providers or nodes/);

    const many = Array.from({ length: 500 }, (_, i) => ({ filename: `package-${i}-${"x".repeat(60)}.json`, line: null, token: "twilio", version: "1" }));
    const big = buildPrompt({ ...ctx, findings: many });
    expect(big.truncated).toBe(true);
    expect(big.user.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    expect((JSON.parse(big.user) as { findings: unknown[] }).findings.length).toBeLessThanOrEqual(MAX_PROMPT_FINDINGS);
  });
});

describe("prompt versions: semver-like only, credentials never sent", () => {
  const secretSpecs = [
    ["git+https with credentials", "git+https://deploy:hunter2pass@git.example.com/x.git", "hunter2pass"],
    ["file:", "file:../secret-vendor-lib-hunter3", "hunter3"],
    ["https tarball", "https://tok3n:x-oauth-basic@registry.example.com/pkg/-/pkg-1.0.0.tgz", "tok3n"],
    ["https tarball (no credentials)", "https://registry.example.com/pkg-hunter4.tgz", "hunter4"],
    ["link:/workspace:", "workspace:../hunter5", "hunter5"],
  ] as const;
  for (const [label, spec, secret] of secretSpecs) {
    it(`${label}: the secret is absent from the prompt`, () => {
      const p = buildPrompt({ ...ctx, findings: [{ filename: "package.json", line: null, token: "twilio", version: spec }] });
      expect(p.user).not.toContain(secret);
      expect(p.system).not.toContain(secret);
      expect(p.user).toContain(NON_SEMVER_PLACEHOLDER);
    });
  }

  it("keeps semver-like specs and image tags; omits everything else", () => {
    for (const v of ["1.2.3", "^4.17.21", "~1.0", ">=1.2.0 <2.0.0", "1.x || 2.x", "4", "2.1", "v1.2.3", "1.2 - 1.4", "^1.2.x"]) expect(promptVersion(v)).toBe(v);
    for (const v of ["latest", "github:user/repo", "npm:other@1.0.0", "link:../x", "1.0.0@evil", "../x", "x".repeat(70), "1.0.0-beta.1", "1.0.0+build.5", "1.2.3.4", "*"]) {
      expect(promptVersion(v)).toBe(NON_SEMVER_PLACEHOLDER);
    }
    expect(promptVersion(null)).toBeNull();
  });

  it("secret-shaped names and prerelease/build tags never reach the prompt", () => {
    const p = buildPrompt({
      ...ctx,
      findings: [
        { filename: "package.json", line: null, token: "sk-live-abcdefghijklmnop", version: "1.0.0" },
        { filename: "package.json", line: null, token: "API_KEY=supersecret", version: "1.0.0" },
        { filename: "package.json", line: null, token: "twilio", version: "1.0.0-AKIAIOSFODNN7EXAMPLEKEY" },
        { filename: "package.json", line: null, token: "stripe", version: "1.0.0+ghp_abcdefghijklmnopqrst" },
      ],
    });
    const sent = `${p.system}\n${p.user}`;
    for (const secret of ["sk-live-abcdefghijklmnop", "supersecret", "AKIAIOSFODNN7EXAMPLEKEY", "ghp_abcdefghijklmnopqrst"]) expect(sent).not.toContain(secret);
    expect(p).toMatchObject({ sentFindings: 2, omittedFindings: 2 });
    expect(p.user.match(/\[non-semver spec omitted\]/g)).toHaveLength(2);
  });

  it("nothing recognisable: the model is not called", async () => {
    let called = false;
    const plan = await planAiSuggestions({ ...ctx, findings: [{ filename: "package.json", line: null, token: "express", version: "4" }] }, async () => {
      called = true;
      return out();
    });
    expect(called).toBe(false);
    expect(plan).toEqual({ status: "OK", accepted: [], rejected: [], message: null, omittedFindings: 1 });
  });

  it("strips scheme://user:pass@ anywhere in the prompt text (defence in depth)", () => {
    const p = buildPrompt({ ...ctx, service: { id: "s", label: "svc https://u:p4ssw0rd@host.example/x" } });
    expect(p.user).not.toContain("p4ssw0rd");
    expect(p.user).toContain("https://[credentials removed]@host.example/x");
  });
});

describe("validateModelOutput", () => {
  it("accepts a grounded suggestion", () => {
    expect(validateModelOutput(out(good), ctx)).toEqual({ accepted: [good], rejected: [] });
  });

  it("rejects malformed JSON and schema violations", () => {
    expect(validateModelOutput("not json", ctx).rejected[0]!.reason).toBe("SCHEMA");
    expect(validateModelOutput(out({ ...good, confidence: 0.99 }), ctx).rejected[0]!.reason).toBe("SCHEMA");
    expect(validateModelOutput(JSON.stringify({ suggestions: [good], note: "x" }), ctx).rejected[0]!.reason).toBe("SCHEMA");
    expect(validateModelOutput(out({ ...good, uncertainty: "NONE" }), ctx).rejected[0]!.reason).toBe("SCHEMA");
  });

  it("rejects hallucinated sources, unknown providers/nodes, mismatches and duplicates", () => {
    const r = validateModelOutput(
      out(
        good,
        { ...good, source: { filename: "package.json", token: "lodash" } },
        { ...good, source: { filename: "secrets.env", token: "@cloudcomms/sdk" } },
        { ...good, providerId: "acme-sms" },
        { ...good, vendorNodeId: "node-vendor-ghost" },
        { ...good, providerId: "twilio" },
        { ...good, providerId: "webhookworks" },
        good,
      ),
      ctx,
    );
    expect(r.accepted).toEqual([good]);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      "HALLUCINATED_SOURCE",
      "HALLUCINATED_SOURCE",
      "UNKNOWN_PROVIDER",
      "UNKNOWN_NODE",
      "PROVIDER_TOKEN_MISMATCH",
      "PROVIDER_TOKEN_MISMATCH",
      "DUPLICATE",
    ]);
  });

  it("provider claims must match the deterministic taxonomy for the token", () => {
    const r = validateModelOutput(
      out(
        { ...good, source: { filename: "package.json", token: "twilio" } }, // twilio -> cloudcomms
        { ...good, source: { filename: "package.json", token: "express" } }, // express -> cloudcomms
        { ...good, source: { filename: "package.json", token: "twilio" }, providerId: "twilio" }, // grounded, but no vendor record
      ),
      ctx,
    );
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual(["PROVIDER_TOKEN_MISMATCH", "TOKEN_NOT_IN_TAXONOMY", "PROVIDER_VENDOR_MISMATCH"]);
  });

  it("uses the finding's format to pick the matcher", () => {
    const tf = { ...ctx, findings: [{ filename: "main.tf", line: 2, token: "cloudcomms/cloudcomms", version: null, format: "TERRAFORM" as const }] };
    expect(validateModelOutput(out({ ...good, source: { filename: "main.tf", token: "cloudcomms/cloudcomms" } }), tf).accepted).toHaveLength(1);
    const asNpm = { ...tf, findings: [{ ...tf.findings[0]!, format: "PACKAGE_JSON" as const }] };
    expect(validateModelOutput(out({ ...good, source: { filename: "main.tf", token: "cloudcomms/cloudcomms" } }), asNpm).rejected[0]!.reason).toBe("TOKEN_NOT_IN_TAXONOMY");
  });
});

describe("planAiSuggestions", () => {
  it("OK with validated output; AI_ERROR (explicit) on failures", async () => {
    expect(await planAiSuggestions(ctx, async () => out(good))).toMatchObject({ status: "OK", accepted: [good] });
    expect(await planAiSuggestions(ctx, async () => out())).toMatchObject({ status: "OK", accepted: [] });
    expect(await planAiSuggestions(ctx, () => Promise.reject(new ModelCallError("model API returned HTTP 500")))).toMatchObject({
      status: "AI_ERROR",
      message: "AI request failed: model API returned HTTP 500",
    });
    const leaky = await planAiSuggestions(ctx, () => Promise.reject(new Error("fetch https://bob:s3cr3tpw@llm.example/v1 failed sk-ABCDEFGHIJKLMNOP")));
    expect(leaky.status).toBe("AI_ERROR");
    expect(leaky.message).not.toMatch(/s3cr3tpw|sk-ABCDEFGHIJ/);
    expect(await planAiSuggestions(ctx, async () => "{{")).toMatchObject({ status: "AI_ERROR", rejected: [{ reason: "SCHEMA" }] });
  });
});

describe("openAiCompatibleCaller (fake fetch, no network)", () => {
  const cfg = { apiKey: "test-key", model: "test-model", baseUrl: "https://llm.example/v1" };

  it("POSTs an OpenAI-compatible chat completion and returns the message content", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ choices: [{ message: { content: out(good) } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const text = await openAiCompatibleCaller(cfg, fakeFetch)({ system: "s", user: "u", maxTokens: 100, timeoutMs: 1000 });
    expect(text).toBe(out(good));
    expect(seen!.url).toBe("https://llm.example/v1/chat/completions");
    expect(seen!.init.method).toBe("POST");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    expect(JSON.parse(seen!.init.body as string)).toMatchObject({
      model: "test-model",
      temperature: 0,
      max_tokens: 100,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }],
    });
  });

  it("HTTP errors, missing content and timeouts become ModelCallError", async () => {
    const status = (code: number) => (async () => new Response("{}", { status: code })) as unknown as typeof fetch;
    const req = { system: "s", user: "u", maxTokens: 10, timeoutMs: 50 };
    await expect(openAiCompatibleCaller(cfg, status(500))(req)).rejects.toThrow("model API returned HTTP 500");
    await expect(openAiCompatibleCaller(cfg, status(200))(req)).rejects.toThrow("no message content");
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_r, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    await expect(openAiCompatibleCaller(cfg, hang)(req)).rejects.toThrow("timed out after 50 ms");
  });
});
