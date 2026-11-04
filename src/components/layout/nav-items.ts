import {
  Database,
  FlaskConical,
  LayoutDashboard,
  Network,
  Siren,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: "/dashboard" | "/graph" | "/incidents" | "/scenarios" | "/sources";
  label: string;
  icon: LucideIcon;
};

/** Primary navigation. Order and labels follow BUILD_BLUEPRINT §3. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/graph", label: "Dependency Graph", icon: Network },
  { href: "/incidents", label: "Incidents", icon: Siren },
  { href: "/scenarios", label: "Response Studio", icon: FlaskConical },
  { href: "/sources", label: "Sources", icon: Database },
];

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
