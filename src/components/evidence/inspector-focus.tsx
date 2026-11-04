"use client";

import * as React from "react";

/**
 * Moves keyboard focus to the inspector when the selected source changes.
 * On narrow viewports (inspector stacked below the list) also scrolls it in.
 */
export function InspectorFocus({
  selectionKey,
  children,
  className,
}: {
  selectionKey: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLElement>(null);
  const first = React.useRef(true);

  React.useEffect(() => {
    // Don't steal focus on initial page load (e.g. a shared deep link).
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el) return;
    const stacked = !window.matchMedia("(min-width: 1024px)").matches;
    el.focus({ preventScroll: !stacked });
    if (stacked) el.scrollIntoView({ block: "start" });
  }, [selectionKey]);

  return (
    <section
      ref={ref}
      tabIndex={-1}
      id="source-inspector"
      aria-labelledby="inspector-title"
      data-testid="source-inspector"
      className={className}
    >
      {children}
    </section>
  );
}
