import {
  ticketCheckInRequestSchema,
  ticketCheckInResponseSchema,
  ticketQrCheckInRequestSchema,
  ticketsListRequestSchema,
} from "../../../../shared/schemas/ticket-check-in.ts";
import { z } from "zod";
import {
  adminDeleteOrderResultSchema,
  adminUpdateOrderAttendeeInputSchema,
  adminUpdateOrderAttendeeResultSchema,
  attendeeAnswersSchema,
  attendeeSchema,
  bankSummariesPageSchema,
  bankSummariesRequestSchema,
  eventAdminOrdersViewSchema,
  getEventTicketsAdminResponseSchema,
  orderItemSchema,
  orderMutationRequestSchema,
  ordersListRequestSchema,
  ordersSearchRequestSchema,
  orderUISchema,
  participantsExportPageSchema,
  participantsExportRequestSchema,
  paymentUISchema,
  ticketsSearchRequestSchema,
} from "../../../../shared/schemas/orders-management.ts";
import {
  bankTransferAdminSummariesSchema,
  expireBankTransferOrderResultSchema,
} from "../../../../shared/schemas/bank-transfer.ts";
import { createEdgeHandler } from "../../_shared/app/edge-handler/mod.ts";
import { json } from "../../_shared/app/http.ts";
import {
  BodyTooLargeError,
  readLimitedJson,
} from "../../_shared/app/request-body.ts";
import { consumeRequestRateLimit } from "../../_shared/app/rate-limit/mod.ts";
import { applicationRateLimits } from "../../_shared/app/config/rate-limits.ts";
import { assertOrganizationManager } from "../../_shared/organization-access.ts";
import {
  databasePatch,
  organizerInput,
  throwOrganizerDatabaseError,
} from "../../_shared/organizer-dto.ts";
import {
  conflict,
  forbidden,
  internal,
  notFound,
  ResponseError,
} from "../../_shared/errors.ts";
import { createEventsRepository } from "../../events/repository.ts";

// Rename declared row columns only. Business JSON values never pass through a
// recursive naming transform; extra DB columns never cross the response boundary.
function row<T extends z.ZodRawShape>(schema: z.ZodObject<T>, raw: unknown) {
  const data = z.record(z.string(), z.unknown()).parse(raw);
  return schema.parse(
    Object.fromEntries(
      Object.keys(schema.shape).map((key) => [
        key,
        key in data
          ? data[key]
          : data[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)],
      ]),
    ),
  );
}
const bundleSchema = z.object({
  orders: z.object({ rows: z.array(z.unknown()) }).passthrough(),
  orderItems: z.array(z.unknown()),
  attendees: z.array(z.unknown()),
  attendeeAnswers: z.array(z.unknown()),
  payments: z.array(z.unknown()).optional(),
  nextCursor: z.unknown().optional(),
});
function bundle(raw: unknown) {
  const data = bundleSchema.parse(raw);
  return {
    ...data,
    orders: {
      ...data.orders,
      rows: data.orders.rows.map((r) => row(orderUISchema, r)),
    },
    orderItems: data.orderItems.map((r) => row(orderItemSchema, r)),
    attendees: data.attendees.map((r) => row(attendeeSchema, r)),
    attendeeAnswers: data.attendeeAnswers.map((r) =>
      row(attendeeAnswersSchema, r)
    ),
    payments: data.payments?.map((r) => row(paymentUISchema, r)),
  };
}
const orderReferenceSchema = z.object({
  id: z.uuid(),
  org_id: z.uuid(),
  event_id: z.uuid(),
});
const attendeeReferenceSchema = z.object({ order_id: z.uuid() });

export const handleOrderManagementRequest = createEdgeHandler({
  name: "orders-management",
  method: "POST",
  auth: "required",
  serviceClient: true,
  onError: ({ req, logger, error }) => {
    if (error instanceof BodyTooLargeError) {
      return json(req, { error: "PAYLOAD_TOO_LARGE" }, 413);
    }
    if (error instanceof SyntaxError) {
      return json(req, { error: "INVALID_JSON" }, 400);
    }
    if (error instanceof ResponseError) {
      return json(req, { error: error.code }, {
        status: error.status,
        ...(error.status === 429
          ? {
            headers: {
              "retry-after": "60",
              "access-control-expose-headers": "Retry-After",
            },
          }
          : {}),
      });
    }
    logger.error("orders_management_failed", { code: "UNEXPECTED_ERROR" });
    return json(req, { error: "UNEXPECTED_ERROR" }, 500);
  },
}, async ({ req, user, serviceClient, logger }) => {
  const action = new URL(req.url).pathname.split("/").at(-1);
  const body = await readLimitedJson(
    req,
    action === "participant-update" ? 65536 : 4096,
  );
  const events = createEventsRepository(serviceClient);
  async function event(
    input: { eventId?: string; orgId?: string; eventSlug?: string },
  ) {
    if (input.orgId) {
      await assertOrganizationManager(serviceClient, input.orgId, user.id);
    }
    const ref = input.eventId
      ? { eventId: input.eventId }
      : input.orgId && input.eventSlug
      ? { orgId: input.orgId, eventSlug: input.eventSlug }
      : null;
    if (!ref) throw forbidden();
    const found = await events.findEvent(ref);
    if (input.orgId && found.orgId !== input.orgId) throw forbidden();
    if (!input.orgId) {
      await assertOrganizationManager(serviceClient, found.orgId, user.id);
    }
    return found;
  }
  async function order(
    input: { orderId: string; eventId?: string; orgId?: string },
  ) {
    const { data, error } = await serviceClient.from("orders").select(
      "id,org_id,event_id",
    ).eq("id", input.orderId).maybeSingle();
    if (error) throw internal("ORDER_LOAD_FAILED");
    if (!data) throw notFound("NOT_FOUND");
    const found = orderReferenceSchema.parse(data);
    if (
      input.eventId && input.eventId !== found.event_id ||
      input.orgId && input.orgId !== found.org_id
    ) throw forbidden();
    const scope = await event({ eventId: found.event_id, orgId: found.org_id });
    return { ...scope, orderId: found.id };
  }
  async function quota(orgId: string, write = false) {
    const result = await consumeRequestRateLimit({
      req,
      supabase: serviceClient,
      logger,
      key: `user:${user.id}:org:${orgId}`,
      ...(write
        ? applicationRateLimits.organizerWrite
        : applicationRateLimits.organizerRead),
    });
    return result.allowed ? null : result.response;
  }
  async function transaction(name: string, args: Record<string, unknown>) {
    const { data, error } = await serviceClient.rpc(name, args);
    if (error) {
      const code = error.message.split(":", 1)[0];
      if (code === "FORBIDDEN") throw forbidden();
      if (code === "TICKET_NOT_FOUND") throw notFound("TICKET_NOT_FOUND");
      if (
        ["TICKET_INVALID", "TICKET_CANCELLED", "EVENT_MISMATCH"].includes(code)
      ) throw conflict(code);
      if (code === "ORDER_NOT_FOUND") throw notFound("NOT_FOUND");
      if (
        code === "ORDER_NOT_EXPIRABLE" ||
        code === "ORDER_IS_NOT_A_BANK_TRANSFER"
      ) throw conflict(code);
      throwOrganizerDatabaseError(error);
    }
    return data;
  }
  if (
    action === "tickets-list" || action === "ticket-check-in" ||
    action === "ticket-check-in-qr"
  ) {
    if (action === "tickets-list") {
      const input = organizerInput(ticketsListRequestSchema, body);
      const scope = await event(input);
      const denied = await quota(scope.orgId);
      if (denied) return denied;
      return json(
        req,
        getEventTicketsAdminResponseSchema.parse(
          await transaction("organizer_get_event_tickets_admin", {
            p_org_id: scope.orgId,
            p_event_id: scope.eventId,
            p_limit: input.limit,
            p_offset: input.offset,
          }),
        ),
      );
    }
    const input = action === "ticket-check-in"
      ? organizerInput(ticketCheckInRequestSchema, body)
      : organizerInput(ticketQrCheckInRequestSchema, body);
    const scope = await event(input);
    const denied = await quota(scope.orgId, true);
    if (denied) return denied;
    const result = await transaction(
      "ticketId" in input
        ? "organizer_check_in_ticket"
        : "organizer_check_in_ticket_by_qr",
      {
        p_actor_id: user.id,
        p_org_id: scope.orgId,
        p_event_id: scope.eventId,
        ...("ticketId" in input
          ? { p_ticket_id: input.ticketId }
          : { p_qr_token: input.qrToken }),
      },
    );
    return json(req, ticketCheckInResponseSchema.parse(result));
  }
  if (action === "list" || action === "search") {
    const input = action === "list"
      ? organizerInput(ordersListRequestSchema, body)
      : organizerInput(ordersSearchRequestSchema, body);
    const scope = await event(input);
    const denied = await quota(scope.orgId);
    if (denied) return denied;
    const args = {
      p_org_id: scope.orgId,
      p_event_id: scope.eventId,
      p_orders_limit: input.ordersLimit,
      p_orders_offset: input.ordersOffset,
      ...("query" in input && "filterMode" in input
        ? { p_query: input.query, p_filter_mode: input.filterMode }
        : {}),
    };
    return json(
      req,
      eventAdminOrdersViewSchema.parse(bundle(
        await transaction(
          action === "list"
            ? "organizer_get_event_admin_orders_view"
            : "organizer_search_event_admin_orders_view",
          args,
        ),
      )),
    );
  }
  if (action === "tickets-search") {
    const input = organizerInput(ticketsSearchRequestSchema, body);
    const scope = await event(input);
    const denied = await quota(scope.orgId);
    if (denied) return denied;
    return json(
      req,
      getEventTicketsAdminResponseSchema.parse(
        await transaction("organizer_search_event_admin_tickets_view", {
          p_org_id: scope.orgId,
          p_event_id: scope.eventId,
          p_query: input.query,
          p_limit: input.limit,
          p_offset: input.offset,
        }),
      ),
    );
  }
  if (action === "participants-export") {
    const input = organizerInput(participantsExportRequestSchema, body);
    const scope = await event(input);
    const denied = await quota(scope.orgId);
    if (denied) return denied;
    return json(
      req,
      participantsExportPageSchema.parse(
        bundle(
          await transaction(
            "organizer_get_event_admin_participants_export_data",
            {
              p_org_id: scope.orgId,
              p_event_id: scope.eventId,
              p_confirmed_only: input.confirmedOnly,
              p_limit: input.limit,
              p_after: input.cursor?.after ?? null,
              p_through: input.cursor?.through ?? null,
              p_snapshot: input.cursor?.snapshot ?? null,
            },
          ),
        ),
      ),
    );
  }
  if (action === "participant-update") {
    const input = organizerInput(adminUpdateOrderAttendeeInputSchema, body);
    const { data, error } = await serviceClient.from("order_attendees").select(
      "order_id",
    ).eq("id", input.attendeeId).maybeSingle();
    if (error) throw internal("ATTENDEE_LOAD_FAILED");
    if (!data) throw notFound("NOT_FOUND");
    const found = attendeeReferenceSchema.parse(data);
    const scope = await order({ ...input, orderId: found.order_id });
    const denied = await quota(scope.orgId, true);
    if (denied) return denied;
    const raw = await transaction("organizer_admin_update_order_attendee", {
      p_actor_id: user.id,
      p_org_id: scope.orgId,
      p_event_id: scope.eventId,
      p_attendee_id: input.attendeeId,
      p_attendee: {
        answers: input.attendee.answers.map((answer) => databasePatch(answer)),
      },
    });
    return json(req, row(adminUpdateOrderAttendeeResultSchema, raw));
  }
  if (action === "delete" || action === "bank-expire") {
    const input = organizerInput(orderMutationRequestSchema, body);
    const scope = await order(input);
    const denied = await quota(scope.orgId, true);
    if (denied) return denied;
    const raw = await transaction(
      action === "delete"
        ? "organizer_admin_delete_order"
        : "organizer_expire_bank_transfer_order",
      {
        p_actor_id: user.id,
        p_org_id: scope.orgId,
        p_event_id: scope.eventId,
        p_order_id: scope.orderId,
      },
    );
    return json(
      req,
      action === "delete"
        ? adminDeleteOrderResultSchema.parse(raw)
        : expireBankTransferOrderResultSchema.parse(raw),
    );
  }
  if (action === "bank-summaries") {
    const input = organizerInput(bankSummariesRequestSchema, body);
    const scope = await event(input);
    const denied = await quota(scope.orgId);
    if (denied) return denied;
    const items = bankTransferAdminSummariesSchema.parse(
      await transaction("organizer_get_bank_transfer_admin_summaries", {
        p_org_id: scope.orgId,
        p_event_id: scope.eventId,
        p_limit: input.limit,
        p_after: input.after ?? null,
      }),
    );
    return json(
      req,
      bankSummariesPageSchema.parse({
        items,
        nextAfter: items.length === input.limit
          ? items.at(-1)?.orderId ?? null
          : null,
      }),
    );
  }
  throw notFound("NOT_FOUND");
});
