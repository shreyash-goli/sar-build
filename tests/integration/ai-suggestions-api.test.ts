/** FS-19: AI-assisted manifest suggestions via POST /api/imports/manifest (mocked model; no network). */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SAMPLE_REPO_FILES, SAMPLE_REPO_SERVICE_NODE_ID } from "@/fixtures/sample-repo";
import { createDbClient, type PrismaClient } from "@/lib/db";
import { resetNorthstarDemo } from "@/lib/demo/northstar";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { ManifestImportDataSchema } from "@/lib/providers/import-schema";
import type { ModelCaller, ModelRequest } from "@/lib/providers/llm-suggestions";
import { AiStatusSchema } from "@/lib/providers/llm/status-schema";
import { ProvenanceViolationError, createRepositories, type Repositories } from "@/lib/repositories";
import { ApiErrorSchema, apiSuccessSchema } from "@/lib/schema";
import { importManifestHandler } from "@/app/api/_lib/imports";
import { reviewEdgeHandler } from "@/app/api/_lib/graph-review";

const ROOT = resolve(__dirname, "../..");
const KEY = "test-llm-key-DO-NOT-SEND";
const DEMO = { DEMO_MODE: "true" } as const;
const AI_ENV = { ...DEMO, LLM_API_KEY: KEY, LLM_MODEL: "test-model", LLM_BASE_URL: "https://llm.example/v1" };
const Envelope = apiSuccessSchema(ManifestImportDataSchema);
const CC_EDGE = "edge-vendor-cloudcomms--service-incident-monitoring";

let dir: string;
let url: string;
let db: PrismaClient;
let repos: Repositories;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-ai-test-"));
  url = `file:${join(dir, "ai.db")}`;
  execFileSync(join(ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  db = createDbClient(url);
  repos = createReadOnlyRepositories(db);
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetNorthstarDemo(db, { env: DEMO });
});

// "@cloudcomms/sdk" is in the taxonomy (the model may only explain known mappings); "express" is not.
// "private-lib" carries credentials in its version spec: it must never reach the model.
const pkg = {
  filename: "package.json",
  content: JSON.stringify({ name: "incident-monitoring", scripts: { start: "node server.js --token=$SECRET" }, dependencies: { "@cloudcomms/sdk": "1.0.0", express: "4.0.0", "private-lib": "git+https://deploy:hunter2pass@git.example.com/x.git" } }),
};
const body = (extra: Record<string, unknown> = {}) => ({ serviceNodeId: SAMPLE_REPO_SERVICE_NODE_ID, importedBy: "platform-eng", files: [pkg], suggester: "ai", ...extra });
const good = {
  source: { filename: "package.json", token: "@cloudcomms/sdk" },
  providerId: "cloudcomms",
  vendorNodeId: "node-vendor-cloudcomms",
  explanation: "An SDK package published by the CloudComms SMS vendor.",
  uncertainty: "MEDIUM",
};
function mockCaller(output: string | Error) {
  const calls: ModelRequest[] = [];
  const caller: ModelCaller = async (req) => {
    calls.push(req);
    if (output instanceof Error) throw output;
    return output;
  };
  return { caller, calls };
}
const post = (b: unknown, env: Record<string, string | undefined>, caller?: ModelCaller) =>
  importManifestHandler(new Request("http://localhost/api/imports/manifest", { method: "POST", body: JSON.stringify(b) }), { db, env, modelCaller: caller });

describe("AI OFF (no key)", () => {
  it("suggester ai without a key is 503 AI OFF: no silent fallback, no model call, nothing written", async () => {
    const m = mockCaller(JSON.stringify({ suggestions: [good] }));
    const edgesBefore = (await repos.edges.list()).length;
    const res = await post(body(), DEMO, m.caller);
    expect(res.status).toBe(503);
    expect(ApiErrorSchema.parse(await res.json()).error).toMatchObject({
      code: "NOT_CONFIGURED",
      details: { reason: "AI_OFF", missing: ["LLM_API_KEY", "LLM_MODEL"] },
    });
    expect(m.calls).toEqual([]);
    expect((await repos.edges.list()).length).toBe(edgesBefore);
  });

  it("rules remain the default and are labelled as rules", async () => {
    const d = Envelope.parse(await (await post(body({ suggester: undefined, files: SAMPLE_REPO_FILES }), DEMO)).json()).data;
    expect(d.suggester).toEqual({ requested: "rules", used: "RULES", status: "OK", message: null, rejected: [], omittedFindings: null });
    expect(d.suggested.map((s) => s.edgeId)).toContain(CC_EDGE);
  });
});

describe("AI configured (mocked model)", () => {
  it("a grounded AI suggestion becomes a SUGGESTED edge with MODEL evidence; hallucinations are rejected", async () => {
    const m = mockCaller(
      JSON.stringify({
        suggestions: [
          good,
          { ...good, source: { filename: "package.json", token: "lodash" } },
          { ...good, vendorNodeId: "node-vendor-ghost" },
        ],
      }),
    );
    const res = await post(body(), AI_ENV, m.caller);
    expect(res.status).toBe(201);
    const d = Envelope.parse(await res.json()).data;
    expect(d.suggester).toMatchObject({ requested: "ai", used: "AI", status: "OK", message: null });
    expect(d.suggester.rejected.map((r) => r.reason)).toEqual(["HALLUCINATED_SOURCE", "UNKNOWN_NODE"]);
    expect(d.suggested.map((s) => [s.edgeId, s.source.token, s.provider.id])).toEqual([[CC_EDGE, "@cloudcomms/sdk", "cloudcomms"]]);
    expect(d.unrecognizedCount).toBe(2); // express, private-lib: not mapped

    const edge = await repos.edges.getById(CC_EDGE);
    expect(edge).toMatchObject({ reviewStatus: "SUGGESTED", confidenceTier: "LOW", dependencyStrength: "OPTIONAL" });
    const ev = await repos.evidence.getById(edge.evidenceId);
    expect(ev).toMatchObject({ kind: "MODEL", classification: "MODEL_SUGGESTED", verificationStatus: "UNVERIFIED", sourceSystem: "llm-suggestion", path: "package.json" });
    expect(ev.excerpt).toMatch(/^AI suggestion: not a fact until reviewed\. package\.json references "@cloudcomms\/sdk"\. Model: An SDK package/);
    // Severity is untouched by a suggestion.
    expect((await repos.incidents.getById("inc-tx-webhookworks-20261116")).severity).toBe("HIGH");
  });

  it("the prompt carries curated findings only: no key, no raw file content", async () => {
    const m = mockCaller(JSON.stringify({ suggestions: [] }));
    const d = Envelope.parse(await (await post(body(), AI_ENV, m.caller)).json()).data;
    expect(d.suggester.omittedFindings).toBe(2); // express, private-lib
    expect(m.calls).toHaveLength(1);
    const sent = `${m.calls[0]!.system}\n${m.calls[0]!.user}`;
    expect(sent).toContain("@cloudcomms/sdk");
    expect(sent).not.toContain(KEY);
    expect(sent).not.toContain("--token=$SECRET");
    expect(sent).not.toContain("scripts");
    expect(sent).not.toContain("hunter2pass");
    expect(sent).not.toContain("deploy:");
    // private-lib (not in the taxonomy) is not sent at all; neither is express.
    expect(sent).not.toContain("private-lib");
    expect(sent).not.toContain('"token":"express"');
  });

  it("secret-shaped dependency names and prerelease/build tags never reach the model", async () => {
    const m = mockCaller(JSON.stringify({ suggestions: [] }));
    const deps = {
      "sk-live-abcdefghijklmnop": "1.0.0",
      "API_KEY=supersecret": "1.0.0",
      twilio: "1.0.0-AKIAIOSFODNN7EXAMPLEKEY",
      "@cloudcomms/sdk": "1.0.0+ghp_abcdefghijklmnopqrst",
    };
    const files = [{ filename: "package.json", content: JSON.stringify({ name: "x", dependencies: deps }) }];
    const res = await post(body({ files }), AI_ENV, m.caller);
    expect(res.status).toBe(201);
    expect(Envelope.parse(await res.json()).data.suggester.omittedFindings).toBe(2);
    const sent = `${m.calls[0]!.system}\n${m.calls[0]!.user}`;
    for (const secret of ["sk-live-abcdefghijklmnop", "supersecret", "AKIAIOSFODNN7EXAMPLEKEY", "ghp_abcdefghijklmnopqrst"]) expect(sent).not.toContain(secret);
  });

  it("no taxonomy match: the model is not called and the response says RULES, not AI", async () => {
    const m = mockCaller(JSON.stringify({ suggestions: [good] }));
    const files = [{ filename: "package.json", content: JSON.stringify({ name: "x", dependencies: { express: "4.0.0", lodash: "4.17.21" } }) }];
    const d = Envelope.parse(await (await post(body({ files }), AI_ENV, m.caller)).json()).data;
    expect(m.calls).toEqual([]);
    expect(d.suggester).toEqual({
      requested: "ai",
      used: "RULES",
      status: "OK",
      message: "No references matched the built-in provider list, so the model was not called. Rules-based suggestions were used.",
      rejected: [],
      omittedFindings: 2,
    });
    expect(d.suggested).toEqual([]);
  });

  it("an AI suggestion cannot silently become confirmed; only a human review confirms it", async () => {
    await post(body(), AI_ENV, mockCaller(JSON.stringify({ suggestions: [good] })).caller);
    const writer = createRepositories(db, { writeGate: () => undefined, demoResetGate: () => undefined });
    await expect(writer.edges.update(CC_EDGE, { reviewStatus: "CONFIRMED" })).rejects.toBeInstanceOf(ProvenanceViolationError);
    const review = await reviewEdgeHandler(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ decision: "CONFIRM", reviewer: "sre-lead", justification: "Checked: incident-monitoring sends SMS pages via CloudComms." }) }),
      CC_EDGE,
      { db, env: DEMO },
    );
    expect(review.status).toBe(200);
    const edge = await repos.edges.getById(CC_EDGE);
    expect(edge.reviewStatus).toBe("CONFIRMED");
    expect(await repos.evidence.getById(edge.evidenceId)).toMatchObject({ kind: "MANUAL", verificationStatus: "USER_VERIFIED" });
  });

  it("a model failure is explicit AI_ERROR with a labelled rules fallback", async () => {
    const m = mockCaller(new Error("connection reset"));
    const d = Envelope.parse(await (await post(body({ files: SAMPLE_REPO_FILES }), AI_ENV, m.caller)).json()).data;
    expect(d.suggester).toMatchObject({ requested: "ai", used: "RULES", status: "AI_ERROR" });
    expect(d.suggester.message).toMatch(/^AI request failed: .*Rules-based suggestions were used instead\.$/);
    const ev = await repos.evidence.getById((await repos.edges.getById(CC_EDGE)).evidenceId);
    expect(ev.kind).toBe("MANIFEST"); // rules evidence, never labelled as AI
  });

  it("schema-invalid model output is AI_ERROR, never stored", async () => {
    const d = Envelope.parse(await (await post(body(), AI_ENV, mockCaller("not json at all").caller)).json()).data;
    expect(d.suggester).toMatchObject({ used: "RULES", status: "AI_ERROR", rejected: [{ reason: "SCHEMA" }] });
    // Labelled rules fallback: the edge exists, but with MANIFEST (rules) evidence only.
    expect(d.suggested.map((x) => x.edgeId)).toEqual([CC_EDGE]);
    expect((await repos.evidence.getById((await repos.edges.getById(CC_EDGE)).evidenceId)).kind).toBe("MANIFEST");
    expect((await repos.evidence.list()).some((e) => e.kind === "MODEL")).toBe(false);
  });

  it("ungrounded provider claims are rejected and never stored (express -> CloudComms)", async () => {
    const m = mockCaller(JSON.stringify({ suggestions: [{ ...good, source: { filename: "package.json", token: "express" } }] }));
    const d = Envelope.parse(await (await post(body(), AI_ENV, m.caller)).json()).data;
    expect(d.suggester).toMatchObject({ used: "AI", status: "OK" });
    expect(d.suggester.rejected.map((r) => r.reason)).toEqual(["TOKEN_NOT_IN_TAXONOMY"]);
    expect(d.suggested).toEqual([]);
    expect(await repos.edges.findById(CC_EDGE)).toBeNull();
    expect((await repos.evidence.list()).some((e) => e.kind === "MODEL")).toBe(false);
  });
});

describe("GET /api/integrations/ai/status", () => {
  it("reports AI_OFF without a key (never the key itself)", async () => {
    const prev = { key: process.env.LLM_API_KEY, model: process.env.LLM_MODEL, url: process.env.DATABASE_URL };
    const g = globalThis as unknown as { __failsafeDb?: PrismaClient };
    const prevDb = g.__failsafeDb;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    process.env.DATABASE_URL = url;
    g.__failsafeDb = undefined;
    try {
      const route = await import("@/app/api/integrations/ai/status/route");
      const off = apiSuccessSchema(AiStatusSchema).parse(await (await route.GET()).json()).data;
      expect(off).toMatchObject({ status: "AI_OFF", model: null, host: null, missing: ["LLM_API_KEY", "LLM_MODEL"] });
      process.env.LLM_API_KEY = KEY;
      process.env.LLM_MODEL = "test-model";
      const res = await route.GET();
      const text = await res.text();
      expect(apiSuccessSchema(AiStatusSchema).parse(JSON.parse(text)).data).toMatchObject({ status: "CONFIGURED", model: "test-model", host: "api.openai.com" });
      expect(text).not.toContain(KEY);
    } finally {
      const created = (globalThis as unknown as { __failsafeDb?: PrismaClient }).__failsafeDb;
      await created?.$disconnect();
      g.__failsafeDb = prevDb;
      for (const [k, v] of [["LLM_API_KEY", prev.key], ["LLM_MODEL", prev.model], ["DATABASE_URL", prev.url]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
