/**
 * FS-21 client/server secret separation (static; no `server-only` dependency needed).
 * Walks the runtime import graph of every "use client" module and asserts that no
 * server-only module (DB, repositories, write gate, LLM/Ramp credentials and clients,
 * route handlers, generated Prisma client) can be bundled into the browser, and that no
 * client-reachable module reads process.env (other than NODE_ENV / NEXT_PUBLIC_*) or
 * names a secret variable.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

const SERVER_ONLY = [
  /^src\/generated\//,
  /^src\/app\/api\//,
  /^src\/lib\/db\.ts$/,
  /^src\/lib\/repositories(\/|\.ts$)/,
  /^src\/lib\/security\/write-gate\.ts$/,
  /^src\/lib\/provenance\/(ledger|check)\.ts$/,
  /^src\/lib\/providers\/llm\/config\.ts$/,
  /^src\/lib\/providers\/llm-suggestions\.ts$/,
  /^src\/lib\/providers\/ramp\/(config|client|sync|normalize)\.ts$/,
  /^src\/lib\/providers\/import-service\.ts$/,
  /^src\/lib\/demo\/(northstar|cli-env)\.ts$/,
];
/**
 * Known, reviewed process.env reads in client-reachable modules. They read NON-secret demo
 * settings (DEMO_MODE, DEMO_NOW) as default parameters; Next.js inlines only NEXT_PUBLIC_*
 * into browser bundles, so in the browser they evaluate to undefined. Any new read fails.
 */
const REVIEWED_ENV_READS = new Set(["src/lib/env.ts", "src/lib/time.ts", "src/components/layout/shell-status.ts"]);
const SECRET_NAMES = /\b(LLM_API_KEY|RAMP_CLIENT_SECRET|RAMP_CLIENT_ID|ADMIN_TOKEN|DATABASE_URL)\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "generated") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Runtime (non type-only) import specifiers. */
function runtimeImports(code: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of code.matchAll(re)) {
    if (m[2]) continue; // import type / export type
    const clause = m[3];
    const named = clause?.trim().match(/^\{([^}]*)\}$/);
    if (named) {
      const parts = named[1]!.split(",").map((x) => x.trim()).filter(Boolean);
      if (parts.length > 0 && parts.every((x) => x.startsWith("type "))) continue; // all type-only: erased
    }
    const spec = m[4] ?? m[5] ?? m[6];
    if (spec) out.push(spec);
  }
  return out;
}

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null; // package
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const files = walk(SRC);
const rel = (p: string) => relative(ROOT, p).split("\\").join("/");
const isClient = (p: string) => /^\s*(["'])use client\1/.test(stripComments(readFileSync(p, "utf8")));
const clientEntries = files.filter(isClient);

function closure(entry: string): Map<string, string[]> {
  const chain = new Map<string, string[]>([[entry, [rel(entry)]]]);
  const queue = [entry];
  while (queue.length) {
    const f = queue.shift()!;
    for (const spec of runtimeImports(stripComments(readFileSync(f, "utf8")))) {
      const r = resolveSpec(f, spec);
      if (r && !chain.has(r)) {
        chain.set(r, [...chain.get(f)!, rel(r)]);
        queue.push(r);
      }
    }
  }
  return chain;
}

describe("client/server separation", () => {
  it("finds the client components", () => {
    expect(clientEntries.length).toBeGreaterThan(5);
  });

  it("no client component can reach a server-only module", () => {
    const violations: string[] = [];
    for (const entry of clientEntries) {
      for (const [file, path] of closure(entry)) {
        if (SERVER_ONLY.some((re) => re.test(rel(file)))) violations.push(path.join(" -> "));
      }
    }
    expect(violations).toEqual([]);
  });

  it("no client-reachable module reads process.env (except NODE_ENV / NEXT_PUBLIC_*) or names a secret", () => {
    const violations: string[] = [];
    const seen = new Set<string>();
    for (const entry of clientEntries) {
      for (const [file, path] of closure(entry)) {
        if (seen.has(file)) continue;
        seen.add(file);
        const code = stripComments(readFileSync(file, "utf8"));
        for (const m of code.matchAll(/process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[)?/g)) {
          const name = m[1];
          if (REVIEWED_ENV_READS.has(rel(file))) continue;
          if (!name || !(name === "NODE_ENV" || name.startsWith("NEXT_PUBLIC_"))) violations.push(`${path.join(" -> ")}: ${m[0]}`);
        }
        if (SECRET_NAMES.test(code)) violations.push(`${path.join(" -> ")}: names ${code.match(SECRET_NAMES)![0]}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("the import scanner itself works (sanity)", () => {
    expect(runtimeImports(`import type { A } from "@/x";\nimport { type B } from "@/y";\nimport { c, type C } from "@/z";\nimport "./side";\nexport { d } from "../w";`)).toEqual(["@/z", "./side", "../w"]);
  });
});
