import { describe, expect, it } from "vitest";
import {
  ADMIN_TOKEN_HEADER,
  WriteForbiddenError,
  assertRequestWritesAllowed,
  assertWritesAllowed,
  isWriteAllowed,
} from "@/lib/security/write-gate";

const TOKEN = "a-very-long-admin-token-1234";

describe("write gate", () => {
  it("allows writes when DEMO_MODE=true", () => {
    expect(isWriteAllowed({ env: { DEMO_MODE: "true" } })).toBe(true);
    expect(() => assertWritesAllowed({ env: { DEMO_MODE: "true" } })).not.toThrow();
  });

  it.each(["TRUE", " true ", "True"])("accepts DEMO_MODE=%j via the shared parser", (DEMO_MODE) => {
    expect(isWriteAllowed({ env: { DEMO_MODE } })).toBe(true);
  });

  it.each([undefined, "false", "1", "yes", "", "truthy"])("denies writes when DEMO_MODE=%j and no token", (DEMO_MODE) => {
    expect(isWriteAllowed({ env: { DEMO_MODE } })).toBe(false);
    expect(() => assertWritesAllowed({ env: { DEMO_MODE } })).toThrow(WriteForbiddenError);
  });

  it("allows writes with a matching admin token outside demo mode", () => {
    expect(isWriteAllowed({ adminToken: TOKEN, env: { DEMO_MODE: "false", ADMIN_TOKEN: TOKEN } })).toBe(true);
  });

  it("denies a wrong, missing, or prefix token", () => {
    const env = { DEMO_MODE: "false", ADMIN_TOKEN: TOKEN };
    expect(isWriteAllowed({ adminToken: "wrong-token-wrong-token", env })).toBe(false);
    expect(isWriteAllowed({ adminToken: null, env })).toBe(false);
    expect(isWriteAllowed({ adminToken: TOKEN.slice(0, -1), env })).toBe(false);
    expect(isWriteAllowed({ adminToken: "", env })).toBe(false);
  });

  it("ignores an unset or too-short ADMIN_TOKEN (cannot be bypassed with an empty token)", () => {
    expect(isWriteAllowed({ adminToken: "", env: { ADMIN_TOKEN: "" } })).toBe(false);
    expect(isWriteAllowed({ adminToken: "short", env: { ADMIN_TOKEN: "short" } })).toBe(false);
    expect(isWriteAllowed({ adminToken: undefined, env: {} })).toBe(false);
  });

  it("reads the admin token from the request header", () => {
    const env = { DEMO_MODE: "false", ADMIN_TOKEN: TOKEN };
    const ok = new Request("http://localhost/api/x", { method: "POST", headers: { [ADMIN_TOKEN_HEADER]: TOKEN } });
    const bad = new Request("http://localhost/api/x", { method: "POST" });
    expect(() => assertRequestWritesAllowed(ok, env)).not.toThrow();
    expect(() => assertRequestWritesAllowed(bad, env)).toThrow(WriteForbiddenError);
  });

  it("error carries the FORBIDDEN API code", () => {
    try {
      assertWritesAllowed({ env: {} });
      expect.unreachable();
    } catch (e) {
      expect((e as WriteForbiddenError).code).toBe("FORBIDDEN");
    }
  });
});
