import { readLimitedJson } from "../_shared/app/request-body.ts";

export function corsHeaders(origin: string | null) {
  const allowed = (Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const allowOrigin =
    origin && (allowed.length === 0 || allowed.includes(origin))
      ? origin
      : allowed[0] ?? "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(req: Request, data: unknown, status = 200) {
  const origin = req.headers.get("origin");

  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function getBearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

export async function readJson(req: Request) {
  try {
    return await readLimitedJson(req);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
