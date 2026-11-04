import type { PotentialImpact } from "@/lib/graph";
import type { Criticality, DependencyStrength } from "@/lib/schema";

export const IMPACT_LABEL: Readonly<Record<PotentialImpact, string>> = {
  POTENTIAL_INTERRUPTION: "Potential interruption",
  POTENTIAL_DEGRADATION: "Potential degradation",
  MINOR_DEPENDENCY: "Minor dependency",
};

export const STRENGTH_LABEL: Readonly<Record<DependencyStrength, string>> = {
  HARD: "Hard",
  DEGRADED: "Degraded",
  OPTIONAL: "Optional",
};

export const CRITICALITY_LABEL: Readonly<Record<Criticality, string>> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  UNKNOWN: "Unknown",
};
