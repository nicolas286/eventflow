export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

type EdgeLoggerLike = {
  info: (step: string, data?: Record<string, unknown>) => void;
  warn: (step: string, data?: Record<string, unknown>) => void;
};

export function handleCorsAndMethod(
  req: Request,
  logger: EdgeLoggerLike,
  allowedMethod = "POST",
): Response | null {
  if (req.method === "OPTIONS") {
    logger.info("options_preflight");

    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== allowedMethod) {
    logger.warn("method_not_allowed", {
      method: req.method,
      allowedMethod,
    });

    return json(
      {
        error: "METHOD_NOT_ALLOWED",
      },
      405,
    );
  }

  return null;
}
