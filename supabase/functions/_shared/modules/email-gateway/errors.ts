import type { EmailProvider } from "./types.ts";

export type EmailGatewayErrorOptions = {
  provider: EmailProvider;
  code?: string | null;
  statusCode?: number | null;
  retryable?: boolean;
  providerResponse?: unknown;
  cause?: unknown;
};

export class EmailGatewayError extends Error {
  readonly provider: EmailProvider;
  readonly code: string | null;
  readonly statusCode: number | null;
  readonly retryable: boolean;
  readonly providerResponse: unknown;
  override readonly cause: unknown;

  constructor(message: string, options: EmailGatewayErrorOptions) {
    super(message);
    this.name = "EmailGatewayError";
    this.provider = options.provider;
    this.code = options.code ?? null;
    this.statusCode = options.statusCode ?? null;
    this.retryable = options.retryable ?? false;
    this.providerResponse = options.providerResponse ?? null;
    this.cause = options.cause;
  }
}
