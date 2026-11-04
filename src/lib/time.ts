/**
 * Injectable clock. When DEMO_MODE is enabled, "now" is the fixed demo clock
 * (DEMO_NOW, default DEFAULT_DEMO_NOW) on server and UI alike; otherwise real time.
 * An invalid DEMO_NOW fails loudly instead of silently using real time.
 *
 * Framework-free and client-safe (no Node or Next imports), so UI code can call
 * resolveDemoClock() with the same semantics as getNow().
 */
import { isDemoModeEnabled } from "@/lib/env";
import { IsoDateTimeSchema } from "@/lib/schema/primitives";

/** Blueprint demo clock, used when DEMO_MODE is enabled and DEMO_NOW is unset or blank. */
export const DEFAULT_DEMO_NOW = "2026-11-17T16:00:00Z";

type ClockEnv = Readonly<Record<string, string | undefined>>;

export type DemoClockResolution =
  /** Demo mode on; `iso` is the canonical demo "now" ("...Z"). `source` says where it came from. */
  | { status: "valid"; iso: string; source: "DEMO_NOW" | "DEFAULT" }
  /** Demo mode on but DEMO_NOW is not a timezone-aware ISO-8601 timestamp. getNow() throws in this case. */
  | { status: "invalid"; value: string };

export type ClockOptions = {
  /** Defaults to process.env. */
  env?: ClockEnv;
  /** Real-time source; defaults to `() => new Date()`. */
  realNow?: () => Date;
};

export class InvalidDemoClockError extends Error {
  constructor(value: string) {
    super(`DEMO_NOW must be a timezone-aware ISO-8601 timestamp, received "${value}"`);
    this.name = "InvalidDemoClockError";
  }
}

export function isDemoClock(env: ClockEnv = process.env): boolean {
  return isDemoModeEnabled(env);
}

const canonical = (d: Date) => d.toISOString().replace(".000Z", "Z");

/**
 * Pure resolver shared by server and UI.
 * - `null` when demo mode is off (real time applies).
 * - `{ status: "valid", iso, source }` when demo mode is on and the clock is usable.
 * - `{ status: "invalid", value }` when demo mode is on and DEMO_NOW is malformed.
 */
export function resolveDemoClock(env: ClockEnv = process.env): DemoClockResolution | null {
  if (!isDemoModeEnabled(env)) return null;
  const raw = env.DEMO_NOW?.trim();
  if (!raw) return { status: "valid", iso: DEFAULT_DEMO_NOW, source: "DEFAULT" };
  if (!IsoDateTimeSchema.safeParse(raw).success) return { status: "invalid", value: raw };
  return { status: "valid", iso: canonical(new Date(raw)), source: "DEMO_NOW" };
}

export function getNow({ env = process.env, realNow = () => new Date() }: ClockOptions = {}): Date {
  const clock = resolveDemoClock(env);
  if (clock === null) return realNow();
  if (clock.status === "invalid") throw new InvalidDemoClockError(clock.value);
  return new Date(clock.iso);
}

/** `getNow()` as a canonical UTC ISO string ("...Z", whole seconds without ".000"). */
export function getNowIso(options?: ClockOptions): string {
  return canonical(getNow(options));
}
