export type EmailProvider = string;

export type EmailAddress = {
  email: string;
  name?: string | null;
};

export type EmailAttachment = {
  filename: string;
  content: string;
  contentType?: string | null;
};

export type EmailTag = {
  name: string;
  value: string;
};

export type SendEmailInput = {
  from: EmailAddress;
  to: readonly EmailAddress[];
  replyTo?: readonly EmailAddress[] | null;
  subject: string;
  html?: string | null;
  text?: string | null;
  attachments?: readonly EmailAttachment[] | null;
  tags?: readonly EmailTag[] | null;
  idempotencyKey?: string | null;
};

export type SendEmailResult = {
  providerMessageId: string;
  providerResponse: Record<string, unknown>;
};

export interface EmailGateway {
  readonly provider: EmailProvider;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
