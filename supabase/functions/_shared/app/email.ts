import { badGateway } from "../errors.ts";
import { assertMailRecipients } from "../environment-safety.ts";
import { captureMail, isMailCaptureEnabled } from "../mail/capture.ts";
import { resolveMailConfig } from "../mail/mailConfig.ts";
import {
  type EmailAddress,
  type EmailAttachment,
  EmailGatewayError,
  type EmailTag,
  ResendEmailGateway,
} from "../modules/email-gateway/mod.ts";

export type EventflowEmailInput = {
  from?: string;
  to: string | string[];
  replyTo?: string | string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
  tags?: Record<string, string | number | boolean | null | undefined>;
  idempotencyKey?: string;
};

export type EmailDelivery = {
  provider: "capture" | "resend";
  id: string;
};

export async function sendEmail(
  input: EventflowEmailInput,
): Promise<EmailDelivery> {
  if (isMailCaptureEnabled()) {
    const captured = await captureMail(input);
    return { provider: captured.provider, id: captured.id };
  }

  const recipients = normalizeAddresses(input.to);
  assertMailRecipients(recipients.map((recipient) => recipient.email));

  const config = resolveMailConfig();
  const gateway = new ResendEmailGateway({ apiKey: config.resendApiKey });
  const result = await gateway.send({
    from: parseEmailAddress(input.from ?? config.defaultFrom),
    to: recipients,
    replyTo: input.replyTo ? normalizeAddresses(input.replyTo) : null,
    subject: input.subject,
    html: input.html,
    text: input.text,
    attachments: input.attachments,
    tags: normalizeTags(input.tags),
    idempotencyKey: input.idempotencyKey,
  });

  return { provider: gateway.provider, id: result.providerMessageId };
}

export async function sendEmailOrThrow(
  input: EventflowEmailInput,
): Promise<EmailDelivery> {
  try {
    return await sendEmail(input);
  } catch (error) {
    if (!(error instanceof EmailGatewayError)) throw error;

    throw badGateway("MAIL_SERVICE_FAILED", {
      provider: error.provider,
      code: error.code,
      status: error.statusCode,
      retryable: error.retryable,
      message: error.message,
      details: error.providerResponse,
    });
  }
}

function normalizeAddresses(value: string | string[]): EmailAddress[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map(parseEmailAddress);
}

function parseEmailAddress(value: string): EmailAddress {
  const normalized = value.trim();
  const displayAddress = /^(.*?)\s*<([^<>]+)>$/.exec(normalized);

  if (!displayAddress) return { email: normalized };

  const name = displayAddress[1].trim().replace(/^"|"$/g, "");
  return {
    email: displayAddress[2].trim(),
    name: name || null,
  };
}

function normalizeTags(
  tags: EventflowEmailInput["tags"],
): EmailTag[] | null {
  if (!tags) return null;

  return Object.entries(tags)
    .filter((entry): entry is [string, string | number | boolean] =>
      entry[1] !== undefined && entry[1] !== null
    )
    .map(([name, value]) => ({ name, value: String(value) }));
}
