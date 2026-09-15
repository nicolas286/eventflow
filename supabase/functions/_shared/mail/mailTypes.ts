export type MailAttachment = {
  filename: string;
  content: string; 
  contentType?: string;
};

export type SendMailInput = {
  from?: string;
  to: string | string[];
  replyTo?: string | string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: MailAttachment[];
  tags?: Record<string, string | number | boolean | null | undefined>;
};

export type SendMailResult =
  | {
      ok: true;
      provider: "resend" | "capture";
      id: string | null;
    }
  | {
      ok: false;
      provider: "resend";
      status?: number;
      message: string;
      details?: unknown;
    };
