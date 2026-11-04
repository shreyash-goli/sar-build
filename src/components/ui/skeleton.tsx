import * as React from "react";

import { cn } from "@/lib/utils";

/** Decorative shimmer block. Wrap groups in an element with role="status". */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-md bg-surface-hover motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}
