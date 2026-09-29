import { registerSuccessPaidSchema } from "./registerTickets.contracts.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EdgeLogger } from "../../_shared/modules/logger/mod.ts";
import type { RuntimeConfig } from "./types.ts";
import type { createOrderIntentOrThrow } from "./order-intent-repository.ts";
import { json } from "../../_shared/app/http.ts";
import { issueFreeOrderTicketsOrThrow } from "./db.ts";
import { sendConfirmationEmailForOrderSafe } from "./emails.ts";

export async function completeFreeOrderOrThrow(
  opts: {
    req: Request;
    admin: SupabaseClient;
    order: Awaited<ReturnType<typeof createOrderIntentOrThrow>>;
    logger: EdgeLogger;
    config: RuntimeConfig;
  },
) {
  const { admin, order, logger, config } = opts;

  logger.info("free_order_start", {
    orderId: order.orderId,
    totalCents: order.totalCents,
    discountCents: order.discountCents,
    dueNowCents: order.dueNowCents,
  });

  await issueFreeOrderTicketsOrThrow(admin, order.orderId);

  logger.info("free_tickets_issued", {
    orderId: order.orderId,
  });

  await sendConfirmationEmailForOrderSafe({
    admin,
    orderId: order.orderId,
    functionsBase: config.functionsBase,
    edgeServiceToken: config.edgeServiceToken,
    logger,
  });

  logger.info("free_order_completed", {
    orderId: order.orderId,
    totalCents: order.totalCents,
    discountCents: order.discountCents,
    dueNowCents: order.dueNowCents,
  });

  return json(
    opts.req,
    registerSuccessPaidSchema.parse({
      ok: true,
      orderId: order.orderId,
      status: "paid",
      bookingToken: order.bookingToken,
      totalCents: order.totalCents,
      amountDueNowCents: order.dueNowCents,
      discountCents: order.discountCents,
    }),
  );
}
