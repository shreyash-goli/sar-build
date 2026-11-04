import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-semibold uppercase leading-5 tracking-[0.08em] [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral: "border-border-strong bg-surface-raised text-muted",
        accent: "border-accent/35 bg-accent-soft text-accent",
        info: "border-info/35 bg-info-soft text-info",
        warning: "border-warning/35 bg-warning-soft text-warning",
        danger: "border-danger/35 bg-danger-soft text-danger",
        success: "border-success/35 bg-success-soft text-success",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}
