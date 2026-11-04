"use client";

import * as React from "react";
import { Clock, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";
import { ModeChip } from "./mode-chip";
import { ResetDemoButton } from "./reset-demo";
import type { ShellFreshness } from "./shell-freshness";
import type { DemoClock, ShellMode } from "./shell-status";
import { SidebarNav } from "./sidebar-nav";

export type AppShellProps = {
  mode: ShellMode;
  /** Secondary note next to the chip, e.g. "Demo mode off · read-only". */
  modeHint: string | null;
  /** Show the "Reset demo" control (DEMO_MODE on). The server still enforces it. */
  canResetDemo?: boolean;
  /** Injected demo clock (valid or explicitly invalid), or null when unset. */
  demoClock: DemoClock | null;
  /** Source freshness derived server-side from the database. */
  freshness: ShellFreshness;
  children: React.ReactNode;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function AppShell({
  mode,
  modeHint,
  canResetDemo = false,
  demoClock,
  freshness,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const menuButtonRef = React.useRef<HTMLButtonElement>(null);
  const drawerRef = React.useRef<HTMLDivElement>(null);

  const closeMobile = React.useCallback(() => {
    setMobileOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  // Drawer: move focus in, lock background scroll, trap Tab, close on Escape.
  React.useEffect(() => {
    if (!mobileOpen) return;
    const drawer = drawerRef.current;
    drawer?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobile();
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      const items = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Close if the viewport grows past the mobile breakpoint.
    const mq = window.matchMedia("(min-width: 768px)");
    const onBreakpoint = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    mq.addEventListener("change", onBreakpoint);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      mq.removeEventListener("change", onBreakpoint);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen, closeMobile]);

  return (
    <div className="flex min-h-dvh w-full">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[70] -translate-y-20 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground shadow-lg transition-transform focus-visible:translate-y-0"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <div
        id="app-sidebar"
        data-collapsed={collapsed || undefined}
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface/80 transition-[width] duration-200 md:flex",
          collapsed
            ? "w-[var(--sidebar-width-collapsed)]"
            : "w-[var(--sidebar-width)]",
        )}
      >
        <div
          className={cn(
            "flex h-[var(--topbar-height)] items-center border-b border-border",
            collapsed ? "justify-center px-2" : "px-4",
          )}
        >
          <Brand compact={collapsed} />
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto p-3">
          <SidebarNav collapsed={collapsed} />
        </nav>
        <div
          className={cn(
            "flex flex-col gap-3 border-t border-border p-3",
            collapsed && "items-center",
          )}
        >
          {!collapsed ? (
            <p className="px-1 text-xs leading-relaxed text-subtle">
              Prototype. Not an official Ramp product.
            </p>
          ) : null}
          <Button
            variant="ghost"
            size={collapsed ? "icon-sm" : "sm"}
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(!collapsed && "justify-start")}
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" />
            ) : (
              <>
                <PanelLeftClose aria-hidden="true" />
                <span>Collapse</span>
              </>
            )}
          </Button>
          {canResetDemo ? <ResetDemoButton compact={collapsed} /> : null}
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            aria-hidden="true"
            onClick={closeMobile}
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
          />
          <div
            ref={drawerRef}
            id="mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] flex-col border-r border-border-strong bg-surface shadow-2xl"
          >
            <div className="flex h-[var(--topbar-height)] items-center justify-between border-b border-border px-4">
              <Brand />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={closeMobile}
                aria-label="Close navigation"
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            <nav aria-label="Main" className="flex-1 overflow-y-auto p-3">
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </nav>
            <div className="flex flex-col gap-2 border-t border-border p-4 text-xs text-subtle">
              <StatusLines
                demoClock={demoClock}
                freshness={freshness}
                placement="drawer"
              />
              <p className="leading-relaxed">
                Prototype. Not an official Ramp product.
              </p>
              {canResetDemo ? (
                <div className="-ml-3">
                  <ResetDemoButton onDone={() => setMobileOpen(false)} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
          <div className="flex h-[var(--topbar-height)] items-center gap-3 px-4 sm:px-6">
            <Button
              ref={menuButtonRef}
              variant="ghost"
              size="icon-sm"
              className="-ml-1.5 md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
            >
              <Menu aria-hidden="true" />
            </Button>
            <Brand
              className="md:hidden"
              wordmarkClassName="max-[400px]:sr-only"
            />
            <div className="ml-auto flex min-w-0 items-center gap-4">
              <div className="hidden items-center gap-4 text-xs text-subtle lg:flex">
                <StatusLines
                  demoClock={demoClock}
                  freshness={freshness}
                  placement="topbar"
                />
              </div>
              {modeHint ? (
                <span data-testid="mode-hint" data-placement="topbar" className="hidden text-xs text-subtle lg:inline">
                  {modeHint}
                </span>
              ) : null}
              <ModeChip mode={mode} />
            </div>
          </div>
          {/* Compact status strip: keeps freshness visible below 1024px. */}
          <div
            data-testid="mobile-status"
            className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border/60 px-4 py-1.5 text-[0.6875rem] leading-4 text-subtle sm:px-6 lg:hidden"
          >
            <StatusLines
              demoClock={demoClock}
              freshness={freshness}
              placement="mobile"
            />
            {modeHint ? (
              <span data-testid="mode-hint" data-placement="mobile">
                {modeHint}
              </span>
            ) : null}
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 outline-none focus-visible:outline-none"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

type StatusPlacement = "topbar" | "mobile" | "drawer";

function StatusLines({
  demoClock,
  freshness,
  placement,
}: {
  demoClock: DemoClock | null;
  freshness: ShellFreshness;
  placement: StatusPlacement;
}) {
  return (
    <>
      <span
        data-testid="source-freshness"
        data-placement={placement}
        data-status={freshness.status}
        className={cn(freshness.status === "unavailable" && "text-warning")}
      >
        {freshness.status === "loaded" ? (
          <>
            {freshness.subject} captured{" "}
            <time dateTime={freshness.capturedAt} className="font-mono text-muted">
              {freshness.capturedLabel}
            </time>
          </>
        ) : freshness.status === "unavailable" ? (
          "Source status unavailable"
        ) : (
          "No data loaded"
        )}
      </span>
      {placement !== "drawer" && demoClock ? (
        <span aria-hidden="true" className="h-3 w-px bg-border-strong" />
      ) : null}
      {demoClock ? (
        <span
          className={cn(
            "flex items-center gap-1.5",
            demoClock.status === "invalid" && "text-warning",
          )}
          data-testid="demo-clock"
          data-placement={placement}
          data-status={demoClock.status}
        >
          <Clock aria-hidden="true" className="size-3.5 shrink-0" />
          {demoClock.status === "valid" ? (
            <span>
              Demo clock:{" "}
              <time dateTime={demoClock.iso} className="font-mono text-muted">
                {demoClock.label}
              </time>
            </span>
          ) : (
            <span title="DEMO_NOW is set but is not a valid ISO 8601 timestamp.">
              Demo clock invalid
            </span>
          )}
        </span>
      ) : null}
    </>
  );
}
