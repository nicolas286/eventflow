import { assertMailRecipients } from "../_shared/environment-safety.ts";
import { captureMail, isMailCaptureEnabled } from "../_shared/mail/capture.ts";
import { badGateway } from "../_shared/errors.ts";

type SendMailPayload = {
  to: string;
  subject: string;
  content: string;
  isHtml?: boolean;
};

type MailServiceConfig = {
  mailServiceUrl: string;
  mailServiceToken: string;
};

export async function sendMail(
  config: MailServiceConfig,
  payload: SendMailPayload,
) {
  if (isMailCaptureEnabled()) { await captureMail(payload); return; }
  assertMailRecipients(payload.to);
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10_000);

  try {
    const res = await fetch(config.mailServiceUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-service-token": config.mailServiceToken,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    const text = await res.text().catch(() => "");

    let data: { ok?: boolean; raw?: string; [key: string]: unknown } = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {
        raw: text.slice(0, 300),
      };
    }

    if (!res.ok || !data?.ok) {
      throw badGateway("MAIL_SERVICE_FAILED", {
        status: res.status,
        data,
      });
    }
  } finally {
    clearTimeout(timeout);
  }
}
