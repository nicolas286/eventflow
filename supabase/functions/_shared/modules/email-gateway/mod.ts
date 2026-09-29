export { EmailGatewayError } from "./errors.ts";
export { formatEmailAddress, normalizeSendEmailInput } from "./normalize.ts";
export { ResendEmailGateway } from "./providers/resend.ts";

export type { EmailGatewayErrorOptions } from "./errors.ts";
export type { ResendGatewayOptions } from "./providers/resend.ts";
export type {
  EmailAddress,
  EmailAttachment,
  EmailGateway,
  EmailProvider,
  EmailTag,
  SendEmailInput,
  SendEmailResult,
} from "./types.ts";
