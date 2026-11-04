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
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
});
