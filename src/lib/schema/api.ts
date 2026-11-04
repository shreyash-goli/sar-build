/** Internal API envelopes: `{ data, meta }` or `{ error: { code, message, details? } }`. */
import * as z from "zod";
import { WorkspaceMode } from "./enums";
import { IsoDateTimeSchema, JsonValueSchema } from "./primitives";

export const ApiErrorCode = z.enum([
  "BAD_REQUEST",
  "NOT_FOUND",
  "INVALID_TRANSITION",
  "NOT_CONFIGURED",
  "FORBIDDEN",
  "INTERNAL_ERROR",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const API_ERROR_HTTP_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  NOT_CONFIGURED: 503,
  INTERNAL_ERROR: 500,
};

/** Error body. `details` must be safe for the browser: no tokens, no stack traces. */
export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: ApiErrorCode,
    message: z.string().trim().min(1),
    details: JsonValueSchema.optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Default meta: freshness and mode so the UI can never silently mix sources. */
export const ApiMetaSchema = z.strictObject({
  workspaceMode: WorkspaceMode,
  generatedAt: IsoDateTimeSchema,
  /** Last risk evaluation time, or null if never evaluated. */
  evaluatedAt: IsoDateTimeSchema.nullable(),
});
export type ApiMeta = z.infer<typeof ApiMetaSchema>;

export function apiSuccessSchema<D extends z.ZodType, M extends z.ZodType = typeof ApiMetaSchema>(
  data: D,
  meta?: M,
) {
  return z.strictObject({ data, meta: (meta ?? ApiMetaSchema) as M });
}

export function apiResponseSchema<D extends z.ZodType, M extends z.ZodType = typeof ApiMetaSchema>(
  data: D,
  meta?: M,
) {
  return z.union([apiSuccessSchema(data, meta), ApiErrorSchema]);
}
