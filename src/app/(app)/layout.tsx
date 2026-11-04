import { connection } from "next/server";

import { AppShell } from "@/components/layout/app-shell";
import { formatUtc, readShellStatus } from "@/components/layout/shell-status";
import { ToastProvider } from "@/components/ui/toast";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read DEMO_MODE / DEMO_NOW at request time, not frozen at build time.
  await connection();
  const status = readShellStatus();

  return (
    <ToastProvider>
      <AppShell
        mode={status.mode}
        demoClock={status.demoClock}
        freshnessLabel={
          status.lastLoadedAt ? formatUtc(status.lastLoadedAt) : null
        }
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
