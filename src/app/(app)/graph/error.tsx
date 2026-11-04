"use client";

import Link from "next/link";
import { useEffect } from "react";
import { DatabaseZap, RotateCw } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";

export default function GraphError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest =
    error instanceof Error && "digest" in error
      ? String((error as Error & { digest?: string }).digest ?? "")
      : "";

  return (
    <section
      role="alert"
      data-testid="graph-error"
      className="flex flex-col items-center gap-4 rounded-xl border border-danger/30 bg-danger-soft/40 px-6 py-14 text-center"
    >
      <span className="flex size-11 items-center justify-center rounded-full border border-danger/40 bg-danger-soft text-danger">
        <DatabaseZap aria-hidden="true" className="size-5" />
      </span>
      <div className="flex max-w-md flex-col gap-1.5">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          The dependency graph could not be loaded
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          FailSafe could not read nodes and edges from the database, so nothing is
          shown rather than guessing. If this is a fresh checkout, run{" "}
          <code className="font-mono text-foreground">pnpm db:migrate</code> and{" "}
          <code className="font-mono text-foreground">pnpm db:seed</code>.
        </p>
        {digest ? <p className="font-mono text-xs text-subtle">Reference: {digest}</p> : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" onClick={() => retry()}>
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
        <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
          Go to Overview
        </Link>
      </div>
    </section>
  );
}
