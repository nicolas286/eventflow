import type { EnvironmentReader } from "../../modules/supabase-runtime/mod.ts";

const localOrigins = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
] as const;

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function splitOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function getAllowedOrigins(
  environment: EnvironmentReader = Deno.env,
): ReadonlySet<string> {
  const configured = [
    ...splitOrigins(environment.get("CORS_ALLOWED_ORIGINS")),
    ...splitOrigins(environment.get("APP_ALLOWED_ORIGINS")),
    environment.get("APP_BASE_URL") ?? "",
  ];

  const normalized = configured
    .map(normalizeOrigin)
    .filter((origin): origin is string => Boolean(origin));

  return new Set(normalized.length ? normalized : localOrigins);
}
