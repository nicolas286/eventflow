import { z } from "zod";
import {
  badRequest,
  conflict,
  internal,
  notFound,
  ResponseError,
} from "./errors.ts";

function databaseKey(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function organizerInput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw badRequest("VALIDATION_ERROR");
  return parsed.data;
}

// Only declared DTO properties cross the boundary. Values (especially arbitrary
// business JSON) are never recursively renamed.
export function dtoColumns<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
): string {
  return Object.keys(schema.shape).map(databaseKey).join(",");
}
export function dtoRow<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  raw: unknown,
) {
  const row = z.record(z.string(), z.unknown()).parse(raw);
  return schema.parse(
    Object.fromEntries(
      Object.keys(schema.shape).map((key) => [key, row[databaseKey(key)]]),
    ),
  );
}
export function databasePatch(input: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined).map((
      [key, value],
    ) => [databaseKey(key), value]),
  );
}
export function throwOrganizerDatabaseError(
  error: { message: string; code?: string },
): never {
  const code = error.message.split(":", 1)[0];
  const validationCodes = new Set([
    "VALIDATION_ERROR",
    "SELLER_IDENTITY_INVALID",
    "PLATFORM_AGREEMENTS_CHANGED",
    "INVALID_FIELD_TYPE",
    "INVALID_OPTIONS",
    "INVALID_STOCK_QTY",
    "INVALID_PRICE_CENTS",
  ]);
  if (validationCodes.has(code)) throw badRequest(code);
  if (code === "NOT_FOUND") throw notFound(code);
  if (code === "STOCK_BELOW_ALLOCATED") throw conflict(code);
  if (code === "RESOURCE_BUSY") throw conflict(code);
  if (code === "RELATIONSHIP_CONFLICT") throw conflict(code);
  if (code === "DUPLICATE_FIELD_KEY") throw conflict(code);
  if (code === "DUPLICATE_PROMO_CODE") throw conflict(code);
  if (error.code === "23503") throw conflict("RESOURCE_IN_USE");
  if (error.code === "23514") throw badRequest("VALIDATION_ERROR");
  if (code === "PLAN_LIMIT") throw conflict("PLAN_LIMIT");
  if (code === "RATE_LIMITED") {
    throw new ResponseError(429, "TOO_MANY_REQUESTS");
  }
  if (code === "CONFLICT" || error.code === "23505") throw conflict("CONFLICT");
  if (
    /^(PLAN_LIMIT_|LIMIT_|MAX_|PAID_|FREE_)/.test(code) &&
    /^[A-Z0-9_]+$/.test(code)
  ) throw conflict(code);
  throw internal("ORGANIZER_OPERATION_FAILED");
}
