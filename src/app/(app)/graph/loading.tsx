import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Loading Dependency Graph…</span>
      <div className="flex flex-col gap-3 border-b border-border pb-6">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-[min(62vh,560px)] min-h-[380px] rounded-xl" />
        <Skeleton className="hidden h-[min(62vh,560px)] rounded-xl xl:block" />
      </div>
    </div>
  );
}
