import * as React from "react";
import { Inbox, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  title: string;
  description: React.ReactNode;
  icon?: LucideIcon;
  children?: React.ReactNode;
  className?: string;
};

/**
 * Honest "no data" panel. Use whenever a view has nothing real to show;
 * never substitute placeholder numbers or charts.
 */
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  children,
  className,
}: EmptyStateProps) {
  return (
    <section
      data-slot="empty-state"
      aria-label={title}
      className={cn(
        "bg-grid flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border-strong bg-surface/60 px-6 py-14 text-center sm:py-20",
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full border border-border-strong bg-surface-raised text-subtle">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div className="flex max-w-md flex-col gap-1.5">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        <div className="text-sm leading-relaxed text-muted">{description}</div>
      </div>
      {children}
    </section>
  );
}
