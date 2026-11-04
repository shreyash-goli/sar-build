import { defineConfig } from "prisma/config";

/**
 * Prisma 7 config. Prisma 7 does not auto-load .env; DATABASE_URL is read from
 * the process environment and falls back to the zero-config local SQLite file
 * so a clean clone works without any setup.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // `pnpm db:seed` (prisma db seed). Loads .env if present; an unset
    // DEMO_MODE defaults to true via --default-demo-mode (see src/lib/demo/cli-env.ts).
    seed: "tsx --env-file-if-exists=.env prisma/seed.ts --default-demo-mode",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
});
