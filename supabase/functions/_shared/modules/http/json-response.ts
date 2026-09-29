export interface JsonResponseOptions {
  status?: number;
  headers?: HeadersInit;
}

export function createJsonResponse(
  getCorsHeaders: (req: Request) => Record<string, string>,
) {
  return function json(
    req: Request,
    data: unknown,
    options: number | JsonResponseOptions = 200,
  ): Response {
    const normalized = typeof options === "number"
      ? { status: options }
      : options;

    return new Response(JSON.stringify(data), {
      status: normalized.status ?? 200,
      headers: {
        ...getCorsHeaders(req),
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        ...normalized.headers,
      },
    });
  };
}

export type JsonResponder = ReturnType<typeof createJsonResponse>;
