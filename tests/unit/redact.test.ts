import { describe, expect, it } from "vitest";
import { REDACTED, redactSecrets, safeErrorSummary } from "@/lib/security/redact";
import { assertSameOriginWrite } from "@/app/api/_lib/request";
import { WriteForbiddenError } from "@/lib/security/write-gate";

describe("redactSecrets (FS-21 logging)", () => {
  it.each([
    ["URL credentials", "git+https://deploy:hunter2pass@git.example.com/x.git", "hunter2pass"],
    ["bearer", "Authorization: Bearer abcDEF123456789xyz", "abcDEF123456789xyz"],
    ["basic", "authorization=Basic Y2lkOmNzZWNyZXQ=", "Y2lkOmNzZWNyZXQ="],
    ["openai-style key", "key sk-proj-ABCDEFGHIJKLMNOP", "ABCDEFGHIJKLMNOP"],
    ["github token", "ghp_abcdefghijklmnopqrst", "abcdefghijklmnopqrst"],
    ["aws key", "AKIAIOSFODNN7EXAMPLE", "AKIAIOSFODNN7EXAMPLE"],
    ["slack token", "xoxb-1234-5678-abcdef", "1234-5678-abcdef"],
    ["ramp token", "got ramp_business_tok_9f8e7d", "ramp_business_tok_9f8e7d"],
    ["query secret", "https://x.example/db?authToken=s3cr3t-value&mode=rw", "s3cr3t-value"],
    ["json secret", '{"client_secret": "csecret-123", "ok": 1}', "csecret-123"],
    ["kv password", "password=letmein!", "letmein!"],
    ["private key", "-----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY-----", "MIIEv"],
  ])("%s", (_label, input, secret) => {
    const out = redactSecrets(input, {});
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
  });

  it("redacts the exact values of secret env vars, and keeps ordinary text", () => {
    const env = { LLM_API_KEY: "plain-looking-value-42", RAMP_CLIENT_SECRET: "rampsecret99" };
    expect(redactSecrets("model said plain-looking-value-42 and rampsecret99", env)).toBe(`model said ${REDACTED} and ${REDACTED}`);
    expect(redactSecrets("Projected $450.00 shortfall for CloudComms (inc-charge-cloudcomms-20261119)", {})).toBe(
      "Projected $450.00 shortfall for CloudComms (inc-charge-cloudcomms-20261119)",
    );
  });

  it("safeErrorSummary: name, code, message and a few redacted frames; never the raw object", () => {
    const e = Object.assign(new Error("connect failed: postgres://app:pw123456@db/x"), { code: "P1001" });
    const s = safeErrorSummary(e, {});
    expect(s).toMatch(/^Error \[P1001\]: connect failed: postgres:\/\/\[redacted\]@db\/x/);
    expect(s).not.toContain("pw123456");
    expect(s.split("\n").length).toBeLessThanOrEqual(7);
    expect(safeErrorSummary({ token: "abcdef123" }, {})).not.toContain("abcdef123");
  });
});

describe("assertSameOriginWrite (CSRF)", () => {
  const req = (headers: Record<string, string>, url = "http://localhost:3000/api/x") => new Request(url, { method: "POST", headers });
  it("allows no-Origin (non-browser) and same-origin; honours a proxy's X-Forwarded-Host", () => {
    expect(() => assertSameOriginWrite(req({}))).not.toThrow();
    expect(() => assertSameOriginWrite(req({ origin: "http://localhost:3000", host: "localhost:3000" }))).not.toThrow();
    expect(() => assertSameOriginWrite(req({ origin: "https://demo.example.app", host: "10.0.0.5:3000", "x-forwarded-host": "demo.example.app" }))).not.toThrow();
  });
  it("refuses other origins, other ports, opaque origins and cross-site fetches", () => {
    for (const h of [{ origin: "https://evil.example" }, { origin: "http://localhost:9999", host: "localhost:3000" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }, { origin: "not a url" }] as Record<string, string>[]) {
      expect(() => assertSameOriginWrite(req(h))).toThrow(WriteForbiddenError);
    }
  });
});
