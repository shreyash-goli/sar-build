import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

// Disposable e2e database, one per port so concurrent runs (different
// E2E_PORT values) never share a SQLite file. It is never deleted: Playwright starts the
// webServer before any globalSetup, so DB preparation lives in the webServer
// command itself and always completes before `next start` opens the file.
// `db:deploy` applies migrations (creating the file if missing) and
// `demo:reset` transactionally restores the fictional Northstar fixture, so
// every run starts from the same state.
const E2E_DATABASE_URL = `file:./e2e-${PORT}.db`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm db:deploy && pnpm demo:reset && pnpm build && pnpm start --port ${PORT}`,
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
