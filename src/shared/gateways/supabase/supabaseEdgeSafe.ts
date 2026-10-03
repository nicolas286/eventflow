import { edgeRequestError } from "@errors/edgeRequestError";

type SupabaseEdgeResponse<T> = {
  data: T | null;
  error: unknown;
};

async function extractEdgeErrorMessage(error: unknown): Promise<string | null> {
  const ctx = typeof error === "object" && error !== null && "context" in error
    ? error.context
    : null;
  let body: unknown = null;

  try {
    if (typeof ctx === "object" && ctx !== null && "json" in ctx && typeof ctx.json === "function") {
      body = await ctx.json();
    }
  } catch {
    // ignore
  }

  if (ctx instanceof Response) {
    const controlledError = edgeRequestError(ctx, body);
    if (controlledError) throw controlledError;
  }

  if (body && typeof body === "object") {
    if ("error" in body && typeof body.error === "string") return body.error;
    if ("message" in body && typeof body.message === "string") return body.message;
  }

  if (error instanceof Error) return error.message;

  return null;
}

export async function edgeSafe<T>(
  fn: () => PromiseLike<SupabaseEdgeResponse<T>>,
  emptyResponseCode = "EDGE_EMPTY_RESPONSE"
): Promise<T> {
  const { data, error } = await fn();

  if (error) {
    const message = await extractEdgeErrorMessage(error);
    throw new Error(message ?? "EDGE_FUNCTION_FAILED", { cause: error });
  }

  if (data == null) {
    throw new Error(emptyResponseCode);
  }

  return data;
}
