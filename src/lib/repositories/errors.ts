/** Typed repository errors, mapped to the API error codes in src/lib/schema/api.ts. */
import type { ApiErrorCode } from "@/lib/schema";
import * as z from "zod";

export class RepositoryError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: z.core.util.JSONType,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

export class ValidationError extends RepositoryError {
  constructor(message: string, readonly issues: z.core.$ZodIssue[]) {
    super("BAD_REQUEST", message, issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })));
    this.name = "ValidationError";
  }
}

export class NotFoundError extends RepositoryError {
  constructor(entity: string, id: string) {
    super("NOT_FOUND", `${entity} ${id} not found`);
    this.name = "NotFoundError";
  }
}

/** Unique-constraint or other state conflict. */
export class ConflictError extends RepositoryError {
  constructor(message: string, details?: z.core.util.JSONType) {
    super("INVALID_TRANSITION", message, details);
    this.name = "ConflictError";
  }
}

/** A write would violate provenance rules (e.g. confirming an unreviewed model suggestion). */
export class ProvenanceViolationError extends RepositoryError {
  constructor(message: string, details?: z.core.util.JSONType) {
    super("BAD_REQUEST", message, details);
    this.name = "ProvenanceViolationError";
  }
}

export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown, label: string): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new ValidationError(`Invalid ${label}`, r.error.issues);
  return r.data;
}

type PrismaKnownError = { code: string; meta?: Record<string, unknown> };

function isPrismaKnownError(e: unknown): e is PrismaKnownError {
  return typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string" &&
    /^P\d{4}$/.test((e as { code: string }).code);
}

/** Translate Prisma errors into repository errors; rethrow anything else. */
export function mapPrismaError(e: unknown, entity: string): never {
  if (e instanceof RepositoryError) throw e;
  if (isPrismaKnownError(e)) {
    if (e.code === "P2002") throw new ConflictError(`${entity} violates a uniqueness constraint`);
    if (e.code === "P2003") throw new ConflictError(`${entity} references a missing or protected record`);
    if (e.code === "P2025") throw new RepositoryError("NOT_FOUND", `${entity} not found`);
  }
  throw e;
}
