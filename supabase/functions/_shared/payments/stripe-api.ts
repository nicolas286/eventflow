import { badGateway, internal, ResponseError } from "../errors.ts";

export type StripeRecord = Record<string, unknown> & { id?: string };

export class StripeApiError extends ResponseError {
  constructor(
    public readonly providerStatus: number,
    public readonly stripeCode: string | null,
    public readonly requestId: string | null,
  ) {
    super(502, "STRIPE_API_ERROR", {
      providerStatus,
      stripeCode,
      requestId,
    });
  }
}

type StripeRequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  params?: Record<string, string | number | boolean | null | undefined>;
  connectedAccountId?: string | null;
  idempotencyKey?: string | null;
  timeoutMs?: number;
};

function encodeParams(params: StripeRequestOptions["params"]): URLSearchParams {
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === null || value === undefined) continue;
    body.set(key, String(value));
  }

  return body;
}

export async function stripeRequest<T extends StripeRecord>(
  secretKey: string,
  path: string,
  options: StripeRequestOptions = {},
): Promise<T> {
  if (!secretKey) throw internal("STRIPE_SECRET_KEY_MISSING");

  const method = options.method ?? "GET";
  const params = encodeParams(options.params);
  const url = new URL(`https://api.stripe.com${path}`);

  if (method === "GET") {
    for (const [key, value] of params) url.searchParams.set(key, value);
  }

  const headers = new Headers({
    Authorization: `Bearer ${secretKey}`,
  });

  if (options.connectedAccountId) {
    headers.set("Stripe-Account", options.connectedAccountId);
  }

  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }

  if (method !== "GET") {
    headers.set("Content-Type", "application/x-www-form-urlencoded");
  }

  const response = await fetch(url, {
    method,
    headers,
    body: method === "GET" ? undefined : params.toString(),
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });

  const requestId = response.headers.get("request-id");
  const raw = await response.text();
  let payload: StripeRecord = {};

  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    if (!response.ok) {
      throw new StripeApiError(response.status, null, requestId);
    }
    throw badGateway("STRIPE_INVALID_RESPONSE");
  }

  if (!response.ok) {
    const error = payload.error;
    const stripeCode =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code ?? "") || null
        : null;

    throw new StripeApiError(response.status, stripeCode, requestId);
  }

  return payload as T;
}

export function requireStripeId(value: unknown, errorCode: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw badGateway(errorCode);
  }

  return value.trim();
}
