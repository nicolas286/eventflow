import { stripeConnectInputSchema } from "../../../../shared/schemas/stripe-connect.ts";
import { BodyTooLargeError, readLimitedJson } from "../app/request-body.ts";
import { badRequest, ResponseError } from "../errors.ts";

// Connect receives only an organization UUID, with room for JSON whitespace.
export const STRIPE_CONNECT_MAX_BODY_BYTES = 4 * 1024;
export const STRIPE_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;

export async function readStripeConnectInput(req: Request) {
  const body = await readLimitedJson(req, STRIPE_CONNECT_MAX_BODY_BYTES).catch(
    (error: unknown) => {
      if (error instanceof BodyTooLargeError) {
        throw new ResponseError(413, "PAYLOAD_TOO_LARGE");
      }
      throw badRequest("INVALID_ORG_ID");
    },
  );
  const parsed = stripeConnectInputSchema.safeParse(body);
  if (!parsed.success) throw badRequest("INVALID_ORG_ID");
  return parsed.data;
}
