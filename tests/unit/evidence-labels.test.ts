import { describe, expect, it } from "vitest";

import { trustSummary } from "@/components/evidence/labels";
import { EvidenceLedgerEntrySchema, type EvidenceLedgerEntry } from "@/lib/provenance";
import type { SourceClass, VerificationStatus } from "@/lib/schema/enums";

function entry(
  classification: SourceClass,
  opts: { isSimulated?: boolean; derivedFromSimulatedInputs?: boolean; verificationStatus?: VerificationStatus } = {},
): EvidenceLedgerEntry {
  const derived = classification === "DERIVED";
  return EvidenceLedgerEntrySchema.parse({
    id: `ev-${classification.toLowerCase()}`,
    kind: derived ? "RULE" : "FIXTURE",
    classification,
    display: {
      label: classification,
      shortDescription: "x",
      tone: "derived",
      category: "derived",
      isSimulated: opts.isSimulated ?? false,
      needsReview: false,
      badge: null,
    },
    sourceSystem: "test",
    sourceId: "s",
    excerpt: null,
    path: null,
    contentHash: null,
    capturedAt: "2026-11-17T16:00:00Z",
    observedAt: null,
    verificationStatus: opts.verificationStatus ?? "UNVERIFIED",
    verification: { label: "Unverified", needsReview: true },
    supports: [],
    ruleLineage: [],
    lineageStatus: derived ? "CURRENT" : "NOT_APPLICABLE",
    lineageNote: null,
    recordedRule: null,
    derivedFromSimulatedInputs: opts.derivedFromSimulatedInputs ?? false,
  });
}

describe("trustSummary (inspector demo/verified answer)", () => {
  it("DERIVED from demo inputs says the inputs are demo data, never 'Not simulated'", () => {
    const t = trustSummary(entry("DERIVED", { derivedFromSimulatedInputs: true }));
    expect(t.simulation).toContain("Derived by a deterministic rule");
    expect(t.simulation).toContain("Inputs are demo data");
    expect(t.simulation).not.toContain("Not simulated");
  });

  it("DERIVED from non-simulated inputs points at the rule lineage", () => {
    const t = trustSummary(entry("DERIVED"));
    expect(t.simulation).toContain("Only as real as its inputs");
    expect(t.simulation).not.toContain("demo");
  });

  it("demo fixtures and sandbox records are labelled as mock data", () => {
    expect(trustSummary(entry("DEMO_FIXTURE", { isSimulated: true })).simulation).toMatch(/^Demo \/ mock data/);
    expect(trustSummary(entry("RAMP_SANDBOX", { isSimulated: true })).simulation).toMatch(/^Sandbox \/ mock data/);
  });

  it("model suggestions and unknown origins are never called real", () => {
    expect(trustSummary(entry("MODEL_SUGGESTED")).simulation).toContain("not a fact");
    expect(trustSummary(entry("UNKNOWN")).simulation).toContain("Origin unknown");
    expect(trustSummary(entry("EXTERNAL_OBSERVED")).simulation).toContain("Not simulated");
  });

  it("verification is answered separately from simulation", () => {
    expect(trustSummary(entry("DEMO_FIXTURE", { isSimulated: true })).verification).toMatch(/^Unverified/);
    expect(trustSummary(entry("DEMO_FIXTURE", { verificationStatus: "USER_VERIFIED" })).verification).toMatch(
      /^Verified by a human/,
    );
    expect(trustSummary(entry("DEMO_FIXTURE", { verificationStatus: "REJECTED" })).verification).toMatch(/^Rejected/);
  });
});
