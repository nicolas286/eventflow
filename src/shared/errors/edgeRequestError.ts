/** Only safe HTTP metadata is retained; the response URL/body may contain credentials. */
export class EdgeRequestError extends Error {
  readonly retryAfterSeconds: number;
  readonly status: 429 | 503;

  constructor(status: 429 | 503, retryAfterSeconds: number) {
    super(status === 429 ? "TOO_MANY_REQUESTS" : "RATE_LIMIT_UNAVAILABLE");
    this.name = "EdgeRequestError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function edgeRequestError(
  response: Response,
  body: unknown,
): EdgeRequestError | null {
  const unavailable = response.status === 503 && typeof body === "object" &&
    body !== null && "error" in body && body.error === "RATE_LIMIT_UNAVAILABLE";
  if (response.status !== 429 && !unavailable) return null;

  const raw = response.headers.get("Retry-After");
  const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  const fallback = response.status === 429 ? 60 : 30;
  const delay = Number.isSafeInteger(seconds) && seconds >= 1 ? seconds : fallback;
  return new EdgeRequestError(response.status === 429 ? 429 : 503, delay);
}

export async function readEdgeRequestError(response: Response) {
  let body: unknown = null;
  if (response.status === 503) {
    try {
      body = await response.clone().json();
    } catch {
      // An unreadable service error remains the caller's generic error.
    }
  }
  return edgeRequestError(response, body);
}

export function humanEdgeRequestMessage(error: EdgeRequestError): string {
  return error.status === 429
    ? `Trop de demandes. Réessayez dans ${error.retryAfterSeconds} secondes.`
    : `Le service est temporairement indisponible. Réessayez dans ${error.retryAfterSeconds} secondes.`;
}
