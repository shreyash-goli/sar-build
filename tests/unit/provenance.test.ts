import { describe, expect, it } from "vitest";
import {
  ALLOWED_CLASSIFICATIONS_BY_METHOD,
  EvidenceMethod,
  ImportEdgeSchema,
  EdgeSchema,
  EvidenceRecordSchema,
  FundingSourceSchema,
  RiskAssertionSchema,
  SourceClass,
  VendorChargeSchema,
} from "@/lib/schema";
import {
  REVIEW_STATUS_DISPLAY,
  SOURCE_CLASS_DISPLAY,
  WORKSPACE_MODE_DISPLAY,
  getSimulationBadge,
  getSourceClassDisplay,
} from "@/lib/provenance";

const importEdge = {
  fromNodeId: "node-card-auth",
  toNodeId: "node-vendor-cloudcomms",
  relation: "PAYS",
  dependencyStrength: "HARD",
  confidenceTier: "MEDIUM",
  reviewStatus: "SUGGESTED",
  evidenceId: "ev-manifest-1",
} as const;

const edge = { ...importEdge, id: "edge-1", reviewStatus: "CONFIRMED" } as const;

describe("graph edge provenance", () => {
  it("accepts an imported edge with an evidence reference", () => {
    expect(ImportEdgeSchema.safeParse(importEdge).success).toBe(true);
  });

  it("rejects an imported edge without an evidence reference", () => {
    const { evidenceId: _omit, ...noEvidence } = importEdge;
    void _omit;
    const r = ImportEdgeSchema.safeParse(noEvidence);
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path[0] === "evidenceId")).toBe(true);
  });

  it.each(["", "   ", null])("rejects an imported edge with evidenceId %j", (evidenceId) => {
    expect(ImportEdgeSchema.safeParse({ ...importEdge, evidenceId }).success).toBe(false);
  });

  it("rejects an imported edge claiming CONFIRMED", () => {
    expect(ImportEdgeSchema.safeParse({ ...importEdge, reviewStatus: "CONFIRMED" }).success).toBe(false);
  });

  it("requires evidenceId on stored edges too", () => {
    expect(EdgeSchema.safeParse(edge).success).toBe(true);
    const { evidenceId: _omit, ...noEvidence } = edge;
    void _omit;
    expect(EdgeSchema.safeParse(noEvidence).success).toBe(false);
  });

  it("rejects self-loops and unknown relations", () => {
    expect(EdgeSchema.safeParse({ ...edge, toNodeId: edge.fromNodeId }).success).toBe(false);
    expect(EdgeSchema.safeParse({ ...edge, relation: "CAUSES" }).success).toBe(false);
  });
});

describe("unknown money stays unknown", () => {
  const fund = {
    id: "fund-auth",
    provider: "DEMO",
    externalFundId: null,
    name: "Auth Infrastructure",
    interval: "MONTHLY",
    limitCents: 500000,
    availableCents: null,
    observedAt: "2026-11-17T16:00:00Z",
    evidenceId: "ev-fund-auth",
  } as const;

  it("preserves null availability (never 0)", () => {
    const parsed = FundingSourceSchema.parse(fund);
    expect(parsed.availableCents).toBeNull();
    expect(parsed.availableCents).not.toBe(0);
  });

  it("does not default a missing money key to 0", () => {
    const { availableCents: _omit, ...missing } = fund;
    void _omit;
    expect(FundingSourceSchema.safeParse(missing).success).toBe(false);
  });

  it("does not coerce money strings", () => {
    expect(FundingSourceSchema.safeParse({ ...fund, availableCents: "0" }).success).toBe(false);
    expect(FundingSourceSchema.safeParse({ ...fund, availableCents: "" }).success).toBe(false);
  });

  it("keeps unknown expected charge amount null", () => {
    const charge = VendorChargeSchema.parse({
      id: "charge-1",
      vendorId: "vendor-cloudcomms",
      fundingSourceId: null,
      expectedAt: "2026-11-19T00:00:00Z",
      expectedCents: null,
      status: "FORECAST",
      sourceClass: "UNKNOWN",
      evidenceId: "ev-charge-1",
    });
    expect(charge.expectedCents).toBeNull();
  });
});

describe("evidence records", () => {
  const ev = {
    id: "ev-1",
    kind: "FIXTURE",
    sourceSystem: "northstar-demo-seed",
    sourceId: "fund-auth",
    capturedAt: "2026-11-17T16:00:00Z",
    observedAt: null,
    excerpt: null,
    path: null,
    contentHash: null,
    classification: "DEMO_FIXTURE",
    verificationStatus: "USER_VERIFIED",
  } as const;

  it("accepts a demo fixture evidence record", () => {
    expect(EvidenceRecordSchema.safeParse(ev).success).toBe(true);
  });

  it("rejects timezone-less timestamps", () => {
    expect(EvidenceRecordSchema.safeParse({ ...ev, capturedAt: "2026-11-17T16:00:00" }).success).toBe(false);
  });

  it("ties evidence kind to classification", () => {
    const parse = (kind: string, classification: string, verificationStatus = "UNVERIFIED") =>
      EvidenceRecordSchema.safeParse({ ...ev, kind, classification, verificationStatus }).success;
    expect(parse("FIXTURE", "EXTERNAL_OBSERVED")).toBe(false);
    expect(parse("FIXTURE", "DEMO_FIXTURE")).toBe(true);
    expect(parse("MODEL", "DERIVED", "USER_VERIFIED")).toBe(false);
    expect(parse("MODEL", "EXTERNAL_OBSERVED")).toBe(false);
    expect(parse("MODEL", "MODEL_SUGGESTED")).toBe(true);
    expect(parse("RULE", "DERIVED")).toBe(true);
    expect(parse("RULE", "DEMO_FIXTURE")).toBe(false);
    expect(parse("API", "RAMP_SANDBOX")).toBe(true);
    expect(parse("API", "EXTERNAL_OBSERVED")).toBe(true);
    expect(parse("API", "DERIVED")).toBe(false);
    expect(parse("MANIFEST", "EXTERNAL_OBSERVED")).toBe(true);
    expect(parse("MANIFEST", "MODEL_SUGGESTED")).toBe(true);
    expect(parse("MANIFEST", "DERIVED")).toBe(false);
    expect(parse("MANIFEST", "DEMO_FIXTURE")).toBe(true); // manifest imported into the fictional demo workspace
    expect(parse("MANIFEST", "UNKNOWN")).toBe(false);
  });

  it("model evidence is never observed or derived, for any method mapping", () => {
    expect(ALLOWED_CLASSIFICATIONS_BY_METHOD.MODEL).toEqual(["MODEL_SUGGESTED"]);
    for (const kind of EvidenceMethod.options) {
      expect(ALLOWED_CLASSIFICATIONS_BY_METHOD[kind].length).toBeGreaterThan(0);
    }
  });

  it("never allows RAMP_DOCUMENTED as a runtime source class", () => {
    expect(SourceClass.safeParse("RAMP_DOCUMENTED").success).toBe(false);
    expect(EvidenceRecordSchema.safeParse({ ...ev, classification: "RAMP_DOCUMENTED" }).success).toBe(false);
  });
});

describe("runtime provenance contract", () => {
  const blueprintExample = {
    assertionId: "risk-auth-20261117",
    claim: "Projected $450 funding shortfall for CloudComms",
    status: "DERIVED",
    ruleId: "projected-shortfall-v1",
    inputs: ["evidence:fund-auth-availability", "evidence:charge-cloudcomms-20261119"],
    evaluatedAt: "2026-11-17T16:00:00Z",
    amountCents: 45000,
    limitations: ["Synthetic payment assumptions", "Actual vendor suspension is unknown"],
  };

  it("accepts the blueprint example verbatim", () => {
    expect(RiskAssertionSchema.parse(blueprintExample)).toEqual(blueprintExample);
  });

  it("allows unknown amount as null", () => {
    expect(RiskAssertionSchema.parse({ ...blueprintExample, amountCents: null }).amountCents).toBeNull();
  });

  it("every assertion must cite inputs, regardless of status", () => {
    for (const status of SourceClass.options.filter((s) => s !== "UNKNOWN")) {
      expect(RiskAssertionSchema.safeParse({ ...blueprintExample, status, inputs: [] }).success, status).toBe(false);
    }
  });

  it("UNKNOWN assertions may omit inputs only when limitations explain what is missing", () => {
    const unknown = { ...blueprintExample, status: "UNKNOWN", inputs: [], amountCents: null };
    expect(RiskAssertionSchema.safeParse(unknown).success).toBe(true);
    expect(RiskAssertionSchema.safeParse({ ...unknown, limitations: [] }).success).toBe(false);
  });

  it("rejects unversioned rules, uncited DERIVED claims, and float cents", () => {
    expect(RiskAssertionSchema.safeParse({ ...blueprintExample, ruleId: "projected-shortfall" }).success).toBe(false);
    expect(RiskAssertionSchema.safeParse({ ...blueprintExample, inputs: [] }).success).toBe(false);
    expect(RiskAssertionSchema.safeParse({ ...blueprintExample, amountCents: 450.5 }).success).toBe(false);
  });
});

describe("source class display metadata", () => {
  it.each(SourceClass.options)("has complete display metadata for %s", (sc) => {
    const d = SOURCE_CLASS_DISPLAY[sc];
    expect(d.sourceClass).toBe(sc);
    expect(d.label.length).toBeGreaterThan(0);
    expect(d.shortDescription.length).toBeGreaterThan(0);
    expect(["demo", "sandbox", "observed", "suggested", "derived", "unknown"]).toContain(d.tone);
    expect(typeof d.isSimulated).toBe("boolean");
    expect(typeof d.needsReview).toBe("boolean");
  });

  it("covers exactly the six runtime source classes", () => {
    expect(Object.keys(SOURCE_CLASS_DISPLAY).sort()).toEqual([...SourceClass.options].sort());
    expect(SourceClass.options).toHaveLength(6);
  });

  it("flags model suggestions and unknowns for review", () => {
    expect(SOURCE_CLASS_DISPLAY.MODEL_SUGGESTED.needsReview).toBe(true);
    expect(SOURCE_CLASS_DISPLAY.UNKNOWN.needsReview).toBe(true);
  });

  it("falls back to UNKNOWN for missing source class", () => {
    expect(getSourceClassDisplay(null).sourceClass).toBe("UNKNOWN");
    expect(getSourceClassDisplay(undefined).sourceClass).toBe("UNKNOWN");
  });

  it("no display copy claims Ramp documentation", () => {
    const text = JSON.stringify(SOURCE_CLASS_DISPLAY);
    expect(text).not.toMatch(/RAMP_DOCUMENTED|documented/i);
  });

  it("covers every workspace mode and review status", () => {
    expect(Object.keys(WORKSPACE_MODE_DISPLAY)).toHaveLength(3);
    expect(REVIEW_STATUS_DISPLAY.SUGGESTED).toMatchObject({ lineStyle: "dashed", countsAsConfirmed: false });
    expect(REVIEW_STATUS_DISPLAY.REJECTED.traversable).toBe(false);
    expect(REVIEW_STATUS_DISPLAY.CONFIRMED.countsAsConfirmed).toBe(true);
  });
});

describe("simulation badges", () => {
  it("simulated data always gets SIMULATION ONLY, regardless of source", () => {
    for (const sourceClass of SourceClass.options) {
      expect(getSimulationBadge({ simulated: true, sourceClass })?.label).toBe("SIMULATION ONLY");
    }
  });

  it("demo fixtures and demo workspace get DEMO DATA", () => {
    expect(getSimulationBadge({ sourceClass: "DEMO_FIXTURE" })?.label).toBe("DEMO DATA");
    expect(getSimulationBadge({ workspaceMode: "DEMO", sourceClass: "DERIVED" })?.label).toBe("DEMO DATA");
  });

  it("sandbox data gets SANDBOX DATA", () => {
    expect(getSimulationBadge({ sourceClass: "RAMP_SANDBOX" })?.label).toBe("SANDBOX DATA");
  });

  it("every isSimulated source class yields a badge", () => {
    for (const sc of SourceClass.options) {
      if (SOURCE_CLASS_DISPLAY[sc].isSimulated) expect(getSimulationBadge({ sourceClass: sc })).not.toBeNull();
    }
  });

  it("non-simulated live data gets no badge", () => {
    expect(getSimulationBadge({ sourceClass: "EXTERNAL_OBSERVED", workspaceMode: "RAMP_LIVE_READONLY" })).toBeNull();
  });

  it("simulation badge copy says no money moved", () => {
    expect(getSimulationBadge({ simulated: true })?.description).toMatch(/no money moved/i);
  });
});
