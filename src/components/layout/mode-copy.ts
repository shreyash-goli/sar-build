/**
 * Pure, framework-free mode chip copy. Labels and tones come from the shared
 * provenance contract; only the "no source" shell state is defined here.
 */
import { getSimulationBadge, WORKSPACE_MODE_DISPLAY } from "@/lib/provenance";
import type { BadgeProps } from "@/components/ui/badge";
import { PROVENANCE_TONE_VARIANT } from "@/components/ui/provenance-tone";
import type { ShellMode } from "./shell-status";

export type ModeChipCopy = {
  label: string;
  description: string;
  variant: NonNullable<BadgeProps["variant"]>;
};

/** No connected source is a shell state, not a WorkspaceMode, so it lives here. */
const NO_SOURCE: ModeChipCopy = {
  label: "NO SOURCE CONNECTED",
  description: "No data source is connected. Nothing shown is live or demo data.",
  variant: "neutral",
};

export function getModeChipCopy(mode: ShellMode): ModeChipCopy {
  if (mode === null) return NO_SOURCE;
  const display = WORKSPACE_MODE_DISPLAY[mode];
  const badge = getSimulationBadge({ workspaceMode: mode });
  return {
    label: badge?.label ?? display.label.toUpperCase(),
    description: display.shortDescription,
    variant: PROVENANCE_TONE_VARIANT[badge?.tone ?? display.tone],
  };
}
