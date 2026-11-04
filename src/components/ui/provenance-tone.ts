import type { ProvenanceTone } from "@/lib/provenance";

import type { BadgeProps } from "./badge";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/** Single mapping from shared provenance tones to Badge variants. */
export const PROVENANCE_TONE_VARIANT: Readonly<
  Record<ProvenanceTone, BadgeVariant>
> = {
  demo: "warning",
  sandbox: "info",
  observed: "success",
  suggested: "accent",
  derived: "neutral",
  unknown: "neutral",
};
