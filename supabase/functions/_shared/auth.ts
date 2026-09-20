import { json } from "./app/http.ts";

type EdgeLoggerLike = {
  warn: (step: string, data?: Record<string, unknown>) => void;
};

export function getBearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

export function requireBearer(
  req: Request,
  logger: EdgeLoggerLike,
): { token: string; response: null } | { token: null; response: Response } {
  const token = getBearer(req);

  if (!token) {
    logger.warn("not_authenticated");

    return {
      token: null,
      response: json(req, { error: "NOT_AUTHENTICATED" }, 401),
    };
  }

  return {
    token,
    response: null,
  };
}
