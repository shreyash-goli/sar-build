import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

// Disposable e2e database, one per port so concurrent runs (different
// E2E_PORT values) never share a SQLite file. It is never deleted: Playwright starts the
// webServer before any globalSetup, so DB preparation lives in the webServer
// command itself and always completes before `next start` opens the file.
// `db:deploy` applies migrations (creating the file if missing) and
// `demo:reset` transactionally restores the fictional Northstar fixture, so
// every run starts from the same state. `check:provenance` (FS-21) then fails
// the run before the build if any record, edge or incident is untraceable.
const E2E_DATABASE_URL = `file:./e2e-${PORT}.db`;

// Specs that change shared graph / incident state (edge reviews, manifest
// imports, demo reset) run strictly after every read-only spec, so they can
// never shift counts that other specs assert. Add future state-mutating
// specs here. Simulation / action specs only append rows no other spec reads.
const MUTATING = /(alerts|graph-review|hero)\.spec\.ts/;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  // One worker: mutating specs must never overlap each other (e.g. a demo
  // reset in hero.spec would wipe state graph-review.spec is asserting).
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: MUTATING },
    {
      name: "state-mutations",
      use: { ...devices["Desktop Chrome"] },
      testMatch: MUTATING,
      dependencies: ["chromium"],
    },
  ],
  webServer: {
    command: `pnpm db:deploy && pnpm demo:reset && pnpm check:provenance && pnpm build && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    // Never reuse a stray server: it could be pointed at dev.db or stale data.
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      DEMO_MODE: "true",
      DEMO_NOW: "2026-11-17T16:00:00Z",
      DATABASE_URL: E2E_DATABASE_URL,
    },
  },
});
