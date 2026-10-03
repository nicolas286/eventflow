import { z } from "zod";
import {
  eventProductSchema,
  productCreateRequestSchema,
  productDeleteRequestSchema,
  productDeleteResponseSchema,
  productReadRequestSchema,
  productUpdateRequestSchema,
} from "../../../shared/schemas/event-products.ts";
import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import {
  BodyTooLargeError,
  readLimitedJson,
} from "../_shared/app/request-body.ts";
import { consumeRequestRateLimit } from "../_shared/app/rate-limit/mod.ts";
import { applicationRateLimits } from "../_shared/app/config/rate-limits.ts";
import { internal, notFound, ResponseError } from "../_shared/errors.ts";
import { assertOrganizationManager } from "../_shared/organization-access.ts";
import {
  databasePatch,
  dtoColumns,
  dtoRow,
  organizerInput,
  throwOrganizerDatabaseError,
} from "../_shared/organizer-dto.ts";
import { createEventsRepository } from "./repository.ts";

const productReferenceSchema = z.object({ id: z.uuid(), event_id: z.uuid() });

export const handleEventProductsRequest = createEdgeHandler({
  name: "event-products",
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
    logger.error("product_operation_failed", { code: "UNEXPECTED_ERROR" });
    return json(req, { error: "UNEXPECTED_ERROR" }, 500);
  },
}, async ({ req, user, serviceClient, logger }) => {
  const path = new URL(req.url).pathname;
  const body = await readLimitedJson(req, 16384);
  const repository = createEventsRepository(serviceClient);
  async function authorizedEvent(eventId: string) {
    const event = await repository.findEvent({ eventId });
    await assertOrganizationManager(serviceClient, event.orgId, user.id);
    return event;
  }
  async function authorizedProduct(productId: string) {
    const { data, error } = await serviceClient.from("event_products").select(
      "id,event_id",
    ).eq("id", productId).maybeSingle();
    if (error) throw internal("PRODUCT_LOAD_FAILED");
    if (!data) throw notFound("NOT_FOUND");
    const product = productReferenceSchema.parse(data);
    return {
      ...(await authorizedEvent(product.event_id)),
      productId: product.id,
    };
  }
  async function quota(orgId: string, write: boolean) {
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
    if (error) throwOrganizerDatabaseError(error);
    return data;
  }
  if (
    path === "/events/products/create" ||
    path === "/functions/v1/events/products/create"
  ) {
    const input = organizerInput(productCreateRequestSchema, body);
    const event = await authorizedEvent(input.eventId);
    const denied = await quota(event.orgId, true);
    if (denied) return denied;
    const raw = await transaction("organizer_create_event_product", {
      p_actor_id: user.id,
      p_input: { org_id: event.orgId, ...databasePatch(input) },
    });
    return json(req, dtoRow(eventProductSchema, raw));
  }
  if (
    path === "/events/products/update" ||
    path === "/functions/v1/events/products/update"
  ) {
    const input = organizerInput(productUpdateRequestSchema, body);
    const product = await authorizedProduct(input.productId);
    const denied = await quota(product.orgId, true);
    if (denied) return denied;
    const raw = await transaction("organizer_update_event_product", {
      p_actor_id: user.id,
      p_input: {
        org_id: product.orgId,
        event_id: product.eventId,
        product_id: product.productId,
        ...databasePatch(input.patch),
      },
    });
    return json(req, dtoRow(eventProductSchema, raw));
  }
  if (
    path === "/events/products/read" ||
    path === "/functions/v1/events/products/read"
  ) {
    const input = organizerInput(productReadRequestSchema, body);
    const product = await authorizedProduct(input.productId);
    const denied = await quota(product.orgId, false);
    if (denied) return denied;
    const { data, error } = await serviceClient.from("event_products").select(
      dtoColumns(eventProductSchema),
    ).eq("id", product.productId).eq("event_id", product.eventId).maybeSingle();
    if (error) throw internal("PRODUCT_LOAD_FAILED");
    if (!data) throw notFound("NOT_FOUND");
    return json(req, dtoRow(eventProductSchema, data));
  }
  if (
    path === "/events/products/delete" ||
    path === "/functions/v1/events/products/delete"
  ) {
    const input = organizerInput(productDeleteRequestSchema, body);
    const product = await authorizedProduct(input.id);
    const denied = await quota(product.orgId, true);
    if (denied) return denied;
    const result = await transaction("organizer_delete_event_product", {
      p_actor_id: user.id,
      p_org_id: product.orgId,
      p_event_id: product.eventId,
      p_product_id: product.productId,
    });
    return json(req, productDeleteResponseSchema.parse(result));
  }
  return json(req, { error: "NOT_FOUND" }, 404);
});
