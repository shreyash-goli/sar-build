import { CircleDashed, FlaskConical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { getModeChipCopy } from "./mode-copy";
import type { ShellMode } from "./shell-status";

export { getModeChipCopy, type ModeChipCopy } from "./mode-copy";

export function ModeChip({ mode }: { mode: ShellMode }) {
  const copy = getModeChipCopy(mode);
  const Icon = mode === null ? CircleDashed : FlaskConical;
  return (
    <Badge
      data-testid="mode-chip"
      data-mode={mode ?? "NONE"}
      variant={copy.variant}
      title={copy.description}
    >
      <Icon aria-hidden="true" />
      <span className="sr-only">Data source mode: </span>
      {copy.label}
    </Badge>
  );
}
