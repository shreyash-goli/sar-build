import { CircleDashed, FlaskConical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { SourceModeKind } from "./shell-status";

const MODE_COPY: Record<
  SourceModeKind,
  { label: string; description: string }
> = {
  demo: {
    label: "DEMO DATA",
    description:
      "Demo data mode: all records are fictional fixtures, not live financial data.",
  },
  none: {
    label: "NO SOURCE CONNECTED",
    description: "No data source is connected.",
  },
};

export function ModeChip({ mode }: { mode: SourceModeKind }) {
  const copy = MODE_COPY[mode];
  const Icon = mode === "demo" ? FlaskConical : CircleDashed;
  return (
    <Badge
      data-testid="mode-chip"
      data-mode={mode}
      variant={mode === "demo" ? "warning" : "neutral"}
      title={copy.description}
    >
      <Icon aria-hidden="true" />
      <span className="sr-only">Data source mode: </span>
      {copy.label}
    </Badge>
  );
}

export function modeDescription(mode: SourceModeKind): string {
  return MODE_COPY[mode].description;
}
