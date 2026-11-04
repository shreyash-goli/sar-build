import { connection } from "next/server";

import { AppShell } from "@/components/layout/app-shell";
import { readShellContext } from "@/components/layout/shell-context";
import { ToastProvider } from "@/components/ui/toast";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read env and DB at request time, not frozen at build time.
  await connection();
  // Never throws: DB failures render "Source status unavailable" and the env-based chip.
  const shell = await readShellContext();

  return (
    <ToastProvider>
      <AppShell
        mode={shell.chip.mode}
        modeHint={shell.chip.hint}
        demoClock={shell.demoClock}
        freshness={shell.freshness}
        canResetDemo={shell.demoModeEnabled}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
