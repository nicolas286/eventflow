export class RequestAuthenticationError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "RequestAuthenticationError";
    this.cause = cause;
  }
}

export function isRequestAuthenticationError(
  error: unknown,
): error is RequestAuthenticationError {
  return error instanceof RequestAuthenticationError;
}

export function isSupabaseAuthenticationError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return false;
  }

  return error.status === 400 || error.status === 401 || error.status === 403;
}
