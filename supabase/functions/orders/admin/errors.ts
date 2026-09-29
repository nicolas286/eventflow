export class ResponseError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}

export function badRequest(code: string, details?: unknown) {
  return new ResponseError(400, code, details);
}

export function unauthorized(code = "NOT_AUTHENTICATED", details?: unknown) {
  return new ResponseError(401, code, details);
}

export function forbidden(code = "FORBIDDEN", details?: unknown) {
  return new ResponseError(403, code, details);
}

export function notFound(code: string, details?: unknown) {
  return new ResponseError(404, code, details);
}

export function serverError(code: string, details?: unknown) {
  return new ResponseError(500, code, details);
}