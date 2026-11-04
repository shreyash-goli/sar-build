import { describe, expect, it } from "vitest";
import { checkEdgeEvidence, evidenceRequiresReview } from "@/lib/repositories/edge-policy";
import { ReviewStatus } from "@/lib/schema";

describe("edge evidence policy", () => {
  it("rejects CONFIRMED edges backed by unreviewed model suggestions", () => {
    expect(
      checkEdgeEvidence("CONFIRMED", { kind: "MODEL", classification: "MODEL_SUGGESTED", verificationStatus: "UNVERIFIED" }).ok,
    ).toBe(false);
  });

  it("allows CONFIRMED once a human verified the suggestion", () => {
    expect(
      checkEdgeEvidence("CONFIRMED", { kind: "MODEL", classification: "MODEL_SUGGESTED", verificationStatus: "USER_VERIFIED" }).ok,
    ).toBe(true);
  });

  it("treats manifest and UNKNOWN evidence as requiring review", () => {
    expect(evidenceRequiresReview({ kind: "MANIFEST", classification: "EXTERNAL_OBSERVED" })).toBe(true);
    expect(evidenceRequiresReview({ kind: "MANUAL", classification: "UNKNOWN" })).toBe(true);
    expect(
      checkEdgeEvidence("CONFIRMED", { kind: "MANIFEST", classification: "EXTERNAL_OBSERVED", verificationStatus: "UNVERIFIED" }).ok,
    ).toBe(false);
  });

  it("allows CONFIRMED demo fixtures and API observations", () => {
    expect(checkEdgeEvidence("CONFIRMED", { kind: "FIXTURE", classification: "DEMO_FIXTURE", verificationStatus: "UNVERIFIED" }).ok).toBe(true);
    expect(checkEdgeEvidence("CONFIRMED", { kind: "API", classification: "RAMP_SANDBOX", verificationStatus: "UNVERIFIED" }).ok).toBe(true);
  });

  it("never confirms on REJECTED evidence", () => {
    expect(checkEdgeEvidence("CONFIRMED", { kind: "FIXTURE", classification: "DEMO_FIXTURE", verificationStatus: "REJECTED" }).ok).toBe(false);
  });

  it("RULE/DERIVED evidence cannot confirm an edge without human verification", () => {
    const derived = { kind: "RULE", classification: "DERIVED" } as const;
    expect(evidenceRequiresReview(derived)).toBe(true);
    expect(checkEdgeEvidence("CONFIRMED", { ...derived, verificationStatus: "UNVERIFIED" }).ok).toBe(false);
    expect(checkEdgeEvidence("CONFIRMED", { ...derived, verificationStatus: "USER_VERIFIED" }).ok).toBe(true);
  });

  it.each(["SUGGESTED", "REJECTED"] as const)("promotion from %s to CONFIRMED requires USER_VERIFIED evidence of any kind", (prev) => {
    for (const ev of [
      { kind: "MANUAL", classification: "EXTERNAL_OBSERVED" },
      { kind: "FIXTURE", classification: "DEMO_FIXTURE" },
      { kind: "API", classification: "RAMP_SANDBOX" },
    ] as const) {
      expect(checkEdgeEvidence("CONFIRMED", { ...ev, verificationStatus: "UNVERIFIED" }, prev).ok, ev.kind).toBe(false);
      expect(checkEdgeEvidence("CONFIRMED", { ...ev, verificationStatus: "USER_VERIFIED" }, prev).ok, ev.kind).toBe(true);
    }
  });

  it("creating CONFIRMED with fixture evidence, or editing an already-CONFIRMED edge, is not a promotion", () => {
    const fixture = { kind: "FIXTURE", classification: "DEMO_FIXTURE", verificationStatus: "UNVERIFIED" } as const;
    expect(checkEdgeEvidence("CONFIRMED", fixture, null).ok).toBe(true);
    expect(checkEdgeEvidence("CONFIRMED", fixture, "CONFIRMED").ok).toBe(true);
    expect(
      checkEdgeEvidence("CONFIRMED", { kind: "MODEL", classification: "MODEL_SUGGESTED", verificationStatus: "UNVERIFIED" }, "CONFIRMED").ok,
    ).toBe(false);
  });

  it("SUGGESTED and REJECTED edges may cite any evidence", () => {
    for (const status of ReviewStatus.options.filter((s) => s !== "CONFIRMED")) {
      expect(checkEdgeEvidence(status, { kind: "MODEL", classification: "MODEL_SUGGESTED", verificationStatus: "UNVERIFIED" }).ok).toBe(true);
    }
  });
});
