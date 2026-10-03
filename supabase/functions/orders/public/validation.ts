import { EVENTFLOW_BUYER_TERMS_VERSION } from "../../../../shared/legal/documents.ts";
import {
  BodyTooLargeError,
  readLimitedJson,
} from "../../_shared/app/request-body.ts";
import { registerPayloadSchema } from "./registerTickets.contracts.ts";
import { badRequest, ResponseError } from "../../_shared/errors.ts";

export async function parseRegisterPayload(req: Request) {
  const body = await readLimitedJson(req, 2 * 1024 * 1024).catch(
    (error: unknown) => {
      if (error instanceof BodyTooLargeError) {
        throw new ResponseError(413, "PAYLOAD_TOO_LARGE");
      }
      throw badRequest("INVALID_JSON");
    },
  );

  const parsed = registerPayloadSchema.safeParse(body);

  if (!parsed.success) {
    const flat = parsed.error.flatten();

    console.warn("[register-tickets] invalid payload", flat);

    const messages = [
      ...Object.values(flat.fieldErrors).flat(),
      ...flat.formErrors,
    ];

    if (messages.includes("BUYER_EMAIL_REQUIRED")) {
      throw badRequest("BUYER_EMAIL_REQUIRED");
    }

    throw badRequest("INVALID_PAYLOAD");
  }

  if (parsed.data.platformTermsVersion !== EVENTFLOW_BUYER_TERMS_VERSION) {
    throw new ResponseError(409, "TERMS_CHANGED_RELOAD");
  }
  return parsed.data;
}
