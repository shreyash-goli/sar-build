/**
 * Pure, framework-free mode chip copy. Labels and tones come from the shared
 * provenance contract; only the "no source" shell state is defined here.
 */
import { getSimulationBadge, WORKSPACE_MODE_DISPLAY } from "@/lib/provenance";
import type { BadgeProps } from "@/components/ui/badge";
import { PROVENANCE_TONE_VARIANT } from "@/components/ui/provenance-tone";
import { RAMP_LABEL } from "@/lib/providers/ramp/schema";
import type { ShellMode } from "./shell-status";

export type ModeChipCopy = {
  label: string;
  description: string;
  variant: NonNullable<BadgeProps["variant"]>;
};

/** No connected source is a shell state, not a WorkspaceMode, so it lives here. */
const NO_SOURCE: ModeChipCopy = {
  label: "NO SOURCE CONNECTED",
  description: "No data source is connected.",
  variant: "neutral",
};

export function getModeChipCopy(mode: ShellMode): ModeChipCopy {
  if (mode === null) return NO_SOURCE;
  const display = WORKSPACE_MODE_DISPLAY[mode];
  // A Ramp sandbox workspace is labelled with the provider's own read-only label
  // ("READ-ONLY RAMP SANDBOX"), not the generic "SANDBOX DATA" badge.
  if (mode === "RAMP_SANDBOX") {
    return {
      label: RAMP_LABEL,
      description: display.shortDescription,
      variant: PROVENANCE_TONE_VARIANT[display.tone],
    };
  }
  const badge = getSimulationBadge({ workspaceMode: mode });
  return {
    label: badge?.label ?? display.label.toUpperCase(),
    description: display.shortDescription,
    variant: PROVENANCE_TONE_VARIANT[badge?.tone ?? display.tone],
  };
}
