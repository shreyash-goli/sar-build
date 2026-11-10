"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActivePath } from "./nav-items";

export function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <ul className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActivePath(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              title={collapsed ? label : undefined}
              data-active={active || undefined}
              className={cn(
                "group relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted hover:bg-surface-hover hover:text-foreground",
                collapsed && "justify-center px-0",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent transition-opacity",
                  active ? "opacity-100" : "opacity-0",
                )}
              />
              <Icon
                aria-hidden="true"
                className={cn(
                  "size-[1.125rem] shrink-0",
                  active ? "text-accent-foreground" : "text-subtle group-hover:text-muted",
                )}
              />
              <span className={cn("truncate", collapsed && "sr-only")}>
                {label}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
