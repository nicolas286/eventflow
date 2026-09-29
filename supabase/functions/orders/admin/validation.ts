import { readLimitedJson, BodyTooLargeError } from "../../_shared/app/request-body.ts";
import { adminRegisterPayloadSchema } from "./adminRegister.contracts.ts";
import { badRequest, ResponseError } from "../../_shared/errors.ts";

type LoggerLike = {
  warn: (step: string, data?: Record<string, unknown>) => void;
  info: (step: string, data?: Record<string, unknown>) => void;
};

export async function parseAdminRegisterPayload(
  req: Request,
  logger: LoggerLike,
) {
  const body = await readLimitedJson(req, 2 * 1024 * 1024).catch((error: unknown) => {
    if (error instanceof BodyTooLargeError) throw new ResponseError(413, "PAYLOAD_TOO_LARGE");
    throw badRequest("INVALID_JSON");
  });

  const parsed = adminRegisterPayloadSchema.safeParse(body);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));

    logger.warn("invalid_payload", { issues });

    const flat = parsed.error.flatten();

    const messages = [
      ...Object.values(flat.fieldErrors).flat(),
      ...flat.formErrors,
    ];

    if (messages.includes("BUYER_REQUIRED")) {
      throw badRequest("BUYER_REQUIRED");
    }

    if (messages.includes("ATTENDEE_PRODUCT_NOT_IN_ITEMS")) {
      throw badRequest("ATTENDEE_PRODUCT_NOT_IN_ITEMS");
    }

    if (messages.includes("ATTENDEES_COUNT_MISMATCH")) {
      throw badRequest("ATTENDEES_COUNT_MISMATCH");
    }

    if (messages.includes("CUSTOM_AMOUNT_REQUIRED")) {
      throw badRequest("CUSTOM_AMOUNT_REQUIRED");
    }

    throw badRequest("INVALID_PAYLOAD");
  }

  const data = parsed.data;

  logger.info("payload_parsed", {
    eventId: data.eventId,
    itemsCount: data.items.length,
    attendeesCount: data.attendees.length,
    markPaid: Boolean(data.markPaid),
  });

  return data;
}