import { ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

/** FailSafe wordmark. Original mark; not derived from any Ramp branding. */
export function Brand({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent-soft text-accent">
        <ShieldCheck aria-hidden="true" className="size-[1.125rem]" />
      </span>
      <span
        className={cn(
          "text-[0.9375rem] font-semibold tracking-tight text-foreground",
          compact && "sr-only",
        )}
      >
        FailSafe
      </span>
    </span>
  );
}
