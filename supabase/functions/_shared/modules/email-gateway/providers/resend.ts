import { EmailGatewayError } from "../errors.ts";
import { formatEmailAddress, normalizeSendEmailInput } from "../normalize.ts";
import type {
  EmailGateway,
  SendEmailInput,
  SendEmailResult,
} from "../types.ts";

export type ResendGatewayOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

type ResendErrorResponse = {
  name?: string;
  message?: string;
  statusCode?: number;
};

export class ResendEmailGateway implements EmailGateway {
  readonly provider = "resend" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: ResendGatewayOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? "https://api.resend.com").replace(
      /\/+$/,
      "",
    );
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;

    if (!this.apiKey) throw new Error("RESEND_API_KEY is required");
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("Email gateway timeout must be positive");
    }
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    let normalizedInput: SendEmailInput;

    try {
      normalizedInput = normalizeSendEmailInput(input);
    } catch (error) {
      throw new EmailGatewayError("Invalid email input", {
        provider: this.provider,
        code: "INVALID_EMAIL_INPUT",
        cause: error,
      });
    }

    let response: Response;

    try {
      response = await this.fetch(`${this.baseUrl}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(normalizedInput.idempotencyKey
            ? { "Idempotency-Key": normalizedInput.idempotencyKey }
            : {}),
        },
        body: JSON.stringify({
          from: formatEmailAddress(normalizedInput.from),
          to: normalizedInput.to.map(formatEmailAddress),
          reply_to: normalizedInput.replyTo?.map(formatEmailAddress),
          subject: normalizedInput.subject,
          html: normalizedInput.html ?? undefined,
          text: normalizedInput.text ?? undefined,
          attachments: normalizedInput.attachments?.map((attachment) => ({
            filename: attachment.filename,
            content: attachment.content,
            contentType: attachment.contentType ?? undefined,
          })),
          tags: normalizedInput.tags ?? undefined,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new EmailGatewayError("Resend request failed", {
        provider: this.provider,
        code: "NETWORK_ERROR",
        retryable: true,
        cause: error,
      });
    }

    const responseBody = await readJsonResponse(response);

    if (!response.ok) {
      const resendError = isRecord(responseBody)
        ? responseBody as ResendErrorResponse
        : {};

      throw new EmailGatewayError(
        resendError.message ?? "Resend email sending failed",
        {
          provider: this.provider,
          code: resendError.name ?? "RESEND_ERROR",
          statusCode: response.status,
          retryable: isRetryableStatus(response.status),
          providerResponse: responseBody,
        },
      );
    }

    if (
      !isRecord(responseBody) || typeof responseBody.id !== "string" ||
      !responseBody.id.trim()
    ) {
      throw new EmailGatewayError("Resend returned no message ID", {
        provider: this.provider,
        code: "INVALID_PROVIDER_RESPONSE",
        statusCode: response.status,
        providerResponse: responseBody,
      });
    }

    return {
      providerMessageId: responseBody.id,
      providerResponse: responseBody,
    };
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
