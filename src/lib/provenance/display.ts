/**
 * Centralized, framework-free display metadata for provenance.
 * The UI must render source labels/badges from here, never ad hoc strings.
 */
import type { ReviewStatus, SourceClass, VerificationStatus, WorkspaceMode } from "../schema/enums";

export type ProvenanceTone = "demo" | "sandbox" | "observed" | "suggested" | "derived" | "unknown";

export type SourceClassDisplay = {
  readonly sourceClass: SourceClass;
  readonly label: string;
  readonly shortDescription: string;
  readonly tone: ProvenanceTone;
  /** Not live business data (synthetic fixture or provider sandbox). */
  readonly isSimulated: boolean;
  /** Must not be treated as fact until a human reviews it. */
  readonly needsReview: boolean;
};

export const SOURCE_CLASS_DISPLAY: Readonly<Record<SourceClass, SourceClassDisplay>> = {
  DEMO_FIXTURE: {
    sourceClass: "DEMO_FIXTURE",
    label: "Demo fixture",
    shortDescription:
      "Fictional data created solely for this demonstration. Not live business evidence, even when marked confirmed.",
    tone: "demo",
    isSimulated: true,
    needsReview: false,
  },
  RAMP_SANDBOX: {
    sourceClass: "RAMP_SANDBOX",
    label: "Ramp sandbox",
    shortDescription:
      "Read from a Ramp developer sandbox via read-only API. Test data, not live company funds.",
    tone: "sandbox",
    isSimulated: true,
    needsReview: false,
  },
  EXTERNAL_OBSERVED: {
    sourceClass: "EXTERNAL_OBSERVED",
    label: "Observed",
    shortDescription:
      "Third-party data with an identifiable origin and capture timestamp.",
    tone: "observed",
    isSimulated: false,
    needsReview: false,
  },
  MODEL_SUGGESTED: {
    sourceClass: "MODEL_SUGGESTED",
    label: "AI suggestion",
    shortDescription:
      "Model-generated hypothesis. Not a fact until a human verifies it.",
    tone: "suggested",
    isSimulated: false,
    needsReview: true,
  },
  DERIVED: {
    sourceClass: "DERIVED",
    label: "Derived",
    shortDescription:
      "Calculated from cited inputs by a versioned deterministic rule. Inherits the limits of its inputs.",
    tone: "derived",
    isSimulated: false,
    needsReview: false,
  },
  UNKNOWN: {
    sourceClass: "UNKNOWN",
    label: "Unknown source",
    shortDescription:
      "Origin or value is missing. Shown as unknown rather than assumed.",
    tone: "unknown",
    isSimulated: false,
    needsReview: true,
  },
};

export function getSourceClassDisplay(sourceClass: SourceClass | null | undefined): SourceClassDisplay {
  return SOURCE_CLASS_DISPLAY[sourceClass ?? "UNKNOWN"] ?? SOURCE_CLASS_DISPLAY.UNKNOWN;
}

export type SimulationBadgeLabel = "SIMULATION ONLY" | "DEMO DATA" | "SANDBOX DATA";

export type SimulationBadge = {
  readonly label: SimulationBadgeLabel;
  readonly tone: ProvenanceTone;
  readonly description: string;
};

const SIMULATION_ONLY: SimulationBadge = {
  label: "SIMULATION ONLY",
  tone: "demo",
  description: "Counterfactual preview. No money moved and no card limit changed in Ramp.",
};
const DEMO_DATA: SimulationBadge = {
  label: "DEMO DATA",
  tone: "demo",
  description: SOURCE_CLASS_DISPLAY.DEMO_FIXTURE.shortDescription,
};
const SANDBOX_DATA: SimulationBadge = {
  label: "SANDBOX DATA",
  tone: "sandbox",
  description: SOURCE_CLASS_DISPLAY.RAMP_SANDBOX.shortDescription,
};

export type SimulationBadgeSubject = {
  /** true for Simulation records, simulated ActionProposals, and what-if previews. */
  simulated?: boolean | null;
  sourceClass?: SourceClass | null;
  workspaceMode?: WorkspaceMode | null;
};

/**
 * Explicit badge for anything that is not live business data.
 * Precedence: simulation > demo fixture/workspace > sandbox. Returns null only
 * for non-simulated, non-demo, non-sandbox data.
 */
export function getSimulationBadge(subject: SimulationBadgeSubject): SimulationBadge | null {
  if (subject.simulated) return SIMULATION_ONLY;
  if (subject.sourceClass === "DEMO_FIXTURE" || subject.workspaceMode === "DEMO") return DEMO_DATA;
  if (subject.sourceClass === "RAMP_SANDBOX" || subject.workspaceMode === "RAMP_SANDBOX") return SANDBOX_DATA;
  return null;
}

export type WorkspaceModeDisplay = {
  readonly mode: WorkspaceMode;
  readonly label: string;
  readonly shortDescription: string;
  readonly tone: ProvenanceTone;
  readonly isLive: boolean;
};

export const WORKSPACE_MODE_DISPLAY: Readonly<Record<WorkspaceMode, WorkspaceModeDisplay>> = {
  DEMO: {
    mode: "DEMO",
    label: "Demo",
    shortDescription: "Fictional Northstar Labs workspace. No live data or credentials.",
    tone: "demo",
    isLive: false,
  },
  RAMP_SANDBOX: {
    mode: "RAMP_SANDBOX",
    label: "Ramp sandbox",
    shortDescription: "Read-only sync from a Ramp developer sandbox.",
    tone: "sandbox",
    isLive: false,
  },
  RAMP_LIVE_READONLY: {
    mode: "RAMP_LIVE_READONLY",
    label: "Ramp live (read-only)",
    shortDescription: "Read-only view of live Ramp data. FailSafe never writes to Ramp.",
    tone: "observed",
    isLive: true,
  },
};

export type ReviewStatusDisplay = {
  readonly status: ReviewStatus;
  readonly label: string;
  readonly lineStyle: "solid" | "dashed" | "hidden";
  /** Only CONFIRMED edges count toward confirmed blast radius. */
  readonly countsAsConfirmed: boolean;
  /** REJECTED edges are never traversed. */
  readonly traversable: boolean;
};

export const REVIEW_STATUS_DISPLAY: Readonly<Record<ReviewStatus, ReviewStatusDisplay>> = {
  CONFIRMED: { status: "CONFIRMED", label: "Confirmed", lineStyle: "solid", countsAsConfirmed: true, traversable: true },
  // traversable only feeds the separate "Possible impacts" view; confirmed blast radius MUST gate on countsAsConfirmed.
  SUGGESTED: { status: "SUGGESTED", label: "Suggested (unreviewed)", lineStyle: "dashed", countsAsConfirmed: false, traversable: true },
  REJECTED: { status: "REJECTED", label: "Rejected", lineStyle: "hidden", countsAsConfirmed: false, traversable: false },
};

export const VERIFICATION_STATUS_DISPLAY: Readonly<
  Record<VerificationStatus, { readonly label: string; readonly needsReview: boolean }>
> = {
  UNVERIFIED: { label: "Unverified", needsReview: true },
  USER_VERIFIED: { label: "User verified", needsReview: false },
  REJECTED: { label: "Rejected", needsReview: false },
};
