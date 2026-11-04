/**
 * Safe repository-manifest parsing (FS-09). Pure; NO execution, NO file-system
 * access, NO network. Content is passed in as text and only read:
 *   - package.json            JSON.parse (data only), dependencies/optionalDependencies/peerDependencies
 *                             (devDependencies are ignored: not runtime integrations)
 *   - docker-compose / compose .yml/.yaml   bounded line scan for `image:` values (no YAML engine)
 *   - *.tf                    bounded line scan for `provider "x"` blocks and required_providers `source = "ns/x"`
 * Filenames must be bare names (no paths); size, line count and binary content are capped/rejected.
 */
import * as z from "zod";
import { matchImage, matchNpm, matchTerraform, type ProviderEntry } from "./taxonomy";

export const MAX_MANIFEST_BYTES = 256 * 1024;
export const MAX_MANIFEST_LINES = 10_000;
export const MAX_MANIFEST_FILES = 5;

export const ManifestFormat = z.enum(["PACKAGE_JSON", "DOCKER_COMPOSE", "TERRAFORM"]);
export type ManifestFormat = z.infer<typeof ManifestFormat>;

export type ManifestErrorCode = "INVALID_FILENAME" | "UNSUPPORTED_FORMAT" | "TOO_LARGE" | "BINARY_CONTENT" | "MALFORMED";

export class ManifestError extends Error {
  constructor(
    readonly code: ManifestErrorCode,
    readonly filename: string,
    message: string,
  ) {
    super(message);
    this.name = "ManifestError";
  }
}

export type ManifestFinding = {
  filename: string;
  format: ManifestFormat;
  /** The literal reference found: npm package name, image reference or Terraform provider. */
  token: string;
  /** Declared version/range or image tag, when present. */
  version: string | null;
  /** 1-based line number for line-scanned formats; null for package.json. */
  line: number | null;
  provider: ProviderEntry | null;
};

export type ParsedManifest = {
  filename: string;
  format: ManifestFormat;
  bytes: number;
  findings: ManifestFinding[];
  /**
   * References the bounded scanner saw but could not resolve (e.g. compose
   * `image: *anchor` aliases or templated values). Counted, never guessed.
   */
  unparsedReferences: number;
};

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function detectFormat(filename: string): ManifestFormat {
  if (!SAFE_NAME.test(filename) || filename.includes("..")) {
    throw new ManifestError("INVALID_FILENAME", filename, `"${filename}" must be a bare file name (no paths)`);
  }
  const lower = filename.toLowerCase();
  if (lower === "package.json") return "PACKAGE_JSON";
  if (/^(docker-)?compose(\.[a-z0-9_-]+)?\.ya?ml$/.test(lower)) return "DOCKER_COMPOSE";
  if (lower.endsWith(".tf")) return "TERRAFORM";
  throw new ManifestError("UNSUPPORTED_FORMAT", filename, `Unsupported manifest "${filename}": use package.json, docker-compose.yml or *.tf`);
}

function checkContent(filename: string, content: string): number {
  const bytes = new TextEncoder().encode(content).length;
  if (bytes > MAX_MANIFEST_BYTES) {
    throw new ManifestError("TOO_LARGE", filename, `"${filename}" is ${bytes} bytes; the limit is ${MAX_MANIFEST_BYTES}`);
  }
  if (content.includes("\u0000")) throw new ManifestError("BINARY_CONTENT", filename, `"${filename}" looks binary`);
  return bytes;
}

function lines(filename: string, content: string): string[] {
  const out = content.split(/\r?\n/);
  if (out.length > MAX_MANIFEST_LINES) {
    throw new ManifestError("TOO_LARGE", filename, `"${filename}" has more than ${MAX_MANIFEST_LINES} lines`);
  }
  return out;
}

function parsePackageJson(filename: string, content: string): ManifestFinding[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new ManifestError("MALFORMED", filename, `"${filename}" is not valid JSON`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new ManifestError("MALFORMED", filename, `"${filename}" must be a JSON object`);
  }
  const findings: ManifestFinding[] = [];
  for (const section of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
    const deps = (data as Record<string, unknown>)[section];
    if (deps === undefined) continue;
    if (deps === null || typeof deps !== "object" || Array.isArray(deps)) {
      throw new ManifestError("MALFORMED", filename, `"${section}" in "${filename}" must be an object`);
    }
    for (const [name, version] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof version !== "string") throw new ManifestError("MALFORMED", filename, `version of "${name}" must be a string`);
      findings.push({ filename, format: "PACKAGE_JSON", token: name, version, line: null, provider: matchNpm(name) });
    }
  }
  return findings;
}

const IMAGE_LINE = /^\s*image:\s*["']?([A-Za-z0-9][A-Za-z0-9._\-/:@]*)["']?\s*(#.*)?$/;

const ANY_IMAGE_LINE = /^\s*image:\s*\S/;

function parseCompose(filename: string, content: string): { findings: ManifestFinding[]; unparsed: number } {
  const findings: ManifestFinding[] = [];
  let unparsed = 0;
  lines(filename, content).forEach((text, i) => {
    const m = IMAGE_LINE.exec(text);
    if (!m) {
      if (ANY_IMAGE_LINE.test(text)) unparsed += 1; // alias (*x), anchor (&x), ${VAR}, etc.
      return;
    }
    const image = m[1]!;
    const tag = /:([^/:@]+)$/.exec(image.split("@")[0]!)?.[1] ?? null;
    findings.push({ filename, format: "DOCKER_COMPOSE", token: image, version: tag, line: i + 1, provider: matchImage(image) });
  });
  return { findings, unparsed };
}

const TF_PROVIDER_BLOCK = /^\s*provider\s+"([a-z0-9_-]+)"\s*\{?/;
const TF_SOURCE = /^\s*source\s*=\s*"([a-z0-9._-]+\/[a-z0-9_-]+)"/;
const TF_VERSION = /^\s*version\s*=\s*"([^"]{1,64})"/;

function parseTerraform(filename: string, content: string): ManifestFinding[] {
  const findings: ManifestFinding[] = [];
  const all = lines(filename, content);
  all.forEach((text, i) => {
    const block = TF_PROVIDER_BLOCK.exec(text);
    const source = TF_SOURCE.exec(text);
    const token = block?.[1] ?? source?.[1];
    if (!token) return;
    // A version on the next line of a required_providers entry is reported as the version.
    const version = source ? (TF_VERSION.exec(all[i + 1] ?? "")?.[1] ?? null) : null;
    findings.push({ filename, format: "TERRAFORM", token, version, line: i + 1, provider: matchTerraform(token) });
  });
  return findings;
}

/** Parse one manifest. Throws ManifestError for invalid names, unsupported formats, oversize or malformed input. */
export function parseManifest(file: { filename: string; content: string }): ParsedManifest {
  const format = detectFormat(file.filename);
  const bytes = checkContent(file.filename, file.content);
  if (format === "DOCKER_COMPOSE") {
    const { findings, unparsed } = parseCompose(file.filename, file.content);
    return { filename: file.filename, format, bytes, findings, unparsedReferences: unparsed };
  }
  const findings = format === "PACKAGE_JSON" ? parsePackageJson(file.filename, file.content) : parseTerraform(file.filename, file.content);
  return { filename: file.filename, format, bytes, findings, unparsedReferences: 0 };
}
