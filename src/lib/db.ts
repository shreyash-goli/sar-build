/**
 * Server-only PrismaClient singleton (Prisma 7 + libSQL driver adapter).
 * Reused across Next.js dev hot reloads via globalThis.
 */
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";

if (typeof window !== "undefined") {
  throw new Error("src/lib/db.ts is server-only and must never be bundled for the browser");
}

export const DEFAULT_DATABASE_URL = "file:./dev.db";

export function createDbClient(url: string = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): PrismaClient {
  return new PrismaClient({ adapter: new PrismaLibSql({ url }) });
}

const globalForDb = globalThis as unknown as { __failsafeDb?: PrismaClient };

export function getDb(): PrismaClient {
  if (!globalForDb.__failsafeDb) globalForDb.__failsafeDb = createDbClient();
  return globalForDb.__failsafeDb;
}

export type { PrismaClient };
