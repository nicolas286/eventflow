import { assertMailRecipients } from "../environment-safety.ts";
import { captureMail, isMailCaptureEnabled } from "./capture.ts";
import { resolveMailConfig } from "./mailConfig.ts";
import type { SendMailInput, SendMailResult } from "./mailTypes.ts";

function cleanTags(tags?: SendMailInput["tags"]) {
  if (!tags) return undefined;

  return Object.entries(tags)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => ({
      name,
      value: String(value),
    }));
}

function normalizeRecipients(value: string | string[] | undefined) {
  if (!value) return undefined;
  return Array.isArray(value) ? value : [value];
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  if (isMailCaptureEnabled()) return captureMail(input);
  assertMailRecipients(input.to);
  const config = resolveMailConfig();

  if (!input.html && !input.text) {
  return {
    ok: false,
    provider: "resend",
    message: "Email must contain html or text content",
  };
}

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from ?? config.defaultFrom,
        to: normalizeRecipients(input.to),
        reply_to: normalizeRecipients(input.replyTo),
        subject: input.subject,
        html: input.html,
        text: input.text,
        attachments: input.attachments,
        tags: cleanTags(input.tags),
      }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        ok: false,
        provider: "resend",
        status: response.status,
        message:
          typeof payload?.message === "string"
            ? payload.message
            : "Failed to send email",
        details: payload,
      };
    }

    return {
      ok: true,
      provider: "resend",
      id: typeof payload?.id === "string" ? payload.id : null,
    };
  } catch (error) {
    return {
      ok: false,
      provider: "resend",
      message: error instanceof Error ? error.message : "Unknown mail error",
      details: error,
    };
  }
}
