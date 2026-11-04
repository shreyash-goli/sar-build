/**
 * Pure, dependency-free UTC formatter. Safe for client bundles: it must not
 * import env, time or any server module (see the boundaries review).
 */
/** Formats an ISO timestamp as "17 Nov 2026, 16:00 UTC" deterministically. */
export function formatUtc(iso: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(d);
  return `${date}, ${time} UTC`;
}
