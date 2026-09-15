export const httpMethods = [
  "GET",
  "POST",
  "PATCH",
  "PUT",
  "DELETE",
  "OPTIONS",
] as const;

export type HttpMethod = (typeof httpMethods)[number];
export type AllowedMethods = HttpMethod | readonly HttpMethod[];

export interface LoggerLike {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
}
