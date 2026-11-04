import { Skeleton } from "@/components/ui/skeleton";

/** Generic route-level loading skeleton matching PageHeader + content. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Loading {label}…</span>
      <div className="flex flex-col gap-3 border-b border-border pb-6">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}
