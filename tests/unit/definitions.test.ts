import { describe, expect, it } from "vitest";
import { EVIDENCE_CATEGORY_DEFINITIONS, getEvidenceCategory } from "@/lib/provenance";
import { SourceClass } from "@/lib/schema";

describe("evidence category definitions", () => {
  it("assign every source class to exactly one category, consistently", () => {
    const seen = new Map<string, string>();
    for (const def of Object.values(EVIDENCE_CATEGORY_DEFINITIONS)) {
      for (const sc of def.sourceClasses) {
        expect(seen.has(sc), sc).toBe(false);
        seen.set(sc, def.category);
        expect(getEvidenceCategory(sc)).toBe(def.category);
      }
    }
    expect([...seen.keys()].sort()).toEqual([...SourceClass.options].sort());
  });

  it("define synthetic, observed and derived in readable text", () => {
    for (const key of ["synthetic", "observed", "derived"] as const) {
      const d = EVIDENCE_CATEGORY_DEFINITIONS[key];
      expect(d.definition.length).toBeGreaterThan(40);
      expect(d.howToRead.length).toBeGreaterThan(20);
    }
    expect(EVIDENCE_CATEGORY_DEFINITIONS.synthetic.sourceClasses).toEqual(["DEMO_FIXTURE", "RAMP_SANDBOX"]);
  });

  it("never claim Ramp documentation", () => {
    expect(JSON.stringify(EVIDENCE_CATEGORY_DEFINITIONS)).not.toMatch(/RAMP_DOCUMENTED|documented/i);
  });
});

import { parseSourcesQuery } from "@/lib/provenance";

describe("parseSourcesQuery", () => {
  it("accepts valid filters and treats empty values as absent", () => {
    expect(parseSourcesQuery({})).toEqual({ ok: true, query: {} });
    expect(parseSourcesQuery({ classification: "DEMO_FIXTURE", verificationStatus: undefined })).toEqual({
      ok: true,
      query: { classification: "DEMO_FIXTURE" },
    });
    expect(parseSourcesQuery({ classification: "", verificationStatus: ["UNVERIFIED"] })).toEqual({
      ok: true,
      query: { verificationStatus: "UNVERIFIED" },
    });
  });

  it("rejects unknown values, unknown params and repeats", () => {
    expect(parseSourcesQuery({ classification: "RAMP_DOCUMENTED" }).ok).toBe(false);
    const unknown = parseSourcesQuery({ foo: "bar" });
    expect(unknown.ok === false && unknown.issues[0]?.param).toBe("foo");
    const repeated = parseSourcesQuery({ classification: ["DEMO_FIXTURE", "DERIVED"] });
    expect(repeated.ok === false && repeated.issues[0]?.param).toBe("classification");
  });
});
