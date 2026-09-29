import type {
  EmailAddress,
  EmailAttachment,
  EmailTag,
  SendEmailInput,
} from "./types.ts";

export function formatEmailAddress(address: EmailAddress): string {
  return address.name ? `${address.name} <${address.email}>` : address.email;
}

export function normalizeSendEmailInput(
  input: SendEmailInput,
): SendEmailInput {
  const subject = input.subject.trim();
  if (!subject) throw new Error("Email subject is required");
  if (!input.to.length) {
    throw new Error("At least one email recipient is required");
  }

  const html = normalizeOptionalContent(input.html);
  const text = normalizeOptionalContent(input.text);
  if (!html && !text) {
    throw new Error("Email html or text content is required");
  }

  return {
    from: normalizeEmailAddress(input.from),
    to: input.to.map(normalizeEmailAddress),
    replyTo: input.replyTo?.map(normalizeEmailAddress) ?? null,
    subject,
    html,
    text,
    attachments: input.attachments?.map(normalizeAttachment) ?? null,
    tags: input.tags?.map(normalizeTag) ?? null,
    idempotencyKey: normalizeOptionalText(input.idempotencyKey),
  };
}

function normalizeEmailAddress(address: EmailAddress): EmailAddress {
  const email = address.email.trim().toLowerCase();
  if (!email) throw new Error("Email address is required");

  return {
    email,
    name: normalizeOptionalText(address.name),
  };
}

function normalizeAttachment(attachment: EmailAttachment): EmailAttachment {
  const filename = attachment.filename.trim();
  if (!filename) throw new Error("Email attachment filename is required");
  if (!attachment.content) {
    throw new Error("Email attachment content is required");
  }

  return {
    filename,
    content: attachment.content,
    contentType: normalizeOptionalText(attachment.contentType),
  };
}

function normalizeTag(tag: EmailTag): EmailTag {
  const name = tag.name.trim();
  const value = tag.value.trim();
  if (!name || !value) throw new Error("Email tag name and value are required");
  return { name, value };
}

function normalizeOptionalContent(
  value: string | null | undefined,
): string | null {
  if (value == null || !value.trim()) return null;
  return value;
}

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  return value.trim() || null;
}
