import { z } from "zod";
import {
  promoCreateRequestSchema,
  promoDeleteRequestSchema,
  promoListRequestSchema,
  promoMutationSuccessSchema,
  promoReadRequestSchema,
  promoUpdateRequestSchema,
} from "../../../shared/schemas/promo-codes.ts";
import {
  promoCodeBaseSchema,
  promoCodeSchema,
} from "../../../shared/schemas/promo-code-data.ts";
import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import {
  BodyTooLargeError,
  readLimitedJson,
} from "../_shared/app/request-body.ts";
import { consumeRequestRateLimit } from "../_shared/app/rate-limit/mod.ts";
import { applicationRateLimits } from "../_shared/app/config/rate-limits.ts";
import {
  conflict,
  forbidden,
  internal,
  notFound,
  ResponseError,
} from "../_shared/errors.ts";
import { assertOrganizationManager } from "../_shared/organization-access.ts";
import {
  databasePatch,
  dtoColumns,
  dtoRow,
  organizerInput,
  throwOrganizerDatabaseError,
} from "../_shared/organizer-dto.ts";
import { createEventsRepository } from "./repository.ts";

const referenceSchema = z.object({
  id: z.uuid(),
  event_id: z.uuid(),
  org_id: z.uuid(),
});
const responseDto = (raw: unknown) =>
  promoCodeSchema.parse(dtoRow(promoCodeBaseSchema, raw));

export const handleEventPromosRequest = createEdgeHandler({
  name: "event-promos",
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
    logger.error("promo_operation_failed", { code: "UNEXPECTED_ERROR" });
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
  async function authorizedPromo(promoCodeId: string) {
    const { data, error } = await serviceClient.from("promo_codes")
      .select("id,event_id,org_id").eq("id", promoCodeId).maybeSingle();
    if (error) throw internal("PROMO_LOAD_FAILED");
    if (!data) throw notFound("NOT_FOUND");
    const promo = referenceSchema.parse(data);
    const event = await authorizedEvent(promo.event_id);
    // Independent legacy FKs do not prove this relationship.
    if (promo.org_id.toLowerCase() !== event.orgId.toLowerCase()) {
      throw conflict("RELATIONSHIP_CONFLICT");
    }
    return { ...event, promoCodeId: promo.id };
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
    path === "/events/promos/list" ||
    path === "/functions/v1/events/promos/list"
  ) {
    const input = organizerInput(promoListRequestSchema, body);
    const event = await authorizedEvent(input.eventId);
    const denied = await quota(event.orgId, false);
    if (denied) return denied;
    const { data, error } = await serviceClient.from("promo_codes")
      .select(dtoColumns(promoCodeBaseSchema)).eq("org_id", event.orgId)
      .eq("event_id", event.eventId).order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw internal("PROMO_LOAD_FAILED");
    // Preserve the configured Data API maximum of the existing list.
    return json(req, z.array(z.unknown()).parse(data).map(responseDto));
  }
  if (
    path === "/events/promos/create" ||
    path === "/functions/v1/events/promos/create"
  ) {
    const input = organizerInput(promoCreateRequestSchema, body);
    const event = await authorizedEvent(input.eventId);
    if (input.orgId.toLowerCase() !== event.orgId.toLowerCase()) {
      throw forbidden("FORBIDDEN");
    }
    const denied = await quota(event.orgId, true);
    if (denied) return denied;
    return json(
      req,
      responseDto(
        await transaction("organizer_create_event_promo_code", {
          p_actor_id: user.id,
          p_input: {
            ...databasePatch(input),
            org_id: event.orgId,
            event_id: event.eventId,
          },
        }),
      ),
    );
  }
  if (
    path === "/events/promos/update" ||
    path === "/functions/v1/events/promos/update"
  ) {
    const input = organizerInput(promoUpdateRequestSchema, body);
    const promo = await authorizedPromo(input.promoCodeId);
    const denied = await quota(promo.orgId, true);
    if (denied) return denied;
    return json(
      req,
      responseDto(
        await transaction("organizer_update_event_promo_code", {
          p_actor_id: user.id,
          p_input: {
            ...databasePatch(input.patch),
            org_id: promo.orgId,
            event_id: promo.eventId,
            promo_code_id: promo.promoCodeId,
          },
        }),
      ),
    );
  }
  if (
    path === "/events/promos/read" ||
    path === "/functions/v1/events/promos/read"
  ) {
    const input = organizerInput(promoReadRequestSchema, body);
    const promo = await authorizedPromo(input.promoCodeId);
    const denied = await quota(promo.orgId, false);
    if (denied) return denied;
    const { data, error } = await serviceClient.from("promo_codes")
      .select(dtoColumns(promoCodeBaseSchema)).eq("id", promo.promoCodeId)
      .eq("org_id", promo.orgId).eq("event_id", promo.eventId).maybeSingle();
    if (error) throw internal("PROMO_LOAD_FAILED");
    if (!data) throw notFound("NOT_FOUND");
    return json(req, responseDto(data));
  }
  if (
    path === "/events/promos/delete" ||
    path === "/functions/v1/events/promos/delete"
  ) {
    const input = organizerInput(promoDeleteRequestSchema, body);
    const promo = await authorizedPromo(input.id);
    const denied = await quota(promo.orgId, true);
    if (denied) return denied;
    return json(
      req,
      promoMutationSuccessSchema.parse(
        await transaction("organizer_delete_event_promo_code", {
          p_actor_id: user.id,
          p_org_id: promo.orgId,
          p_event_id: promo.eventId,
          p_promo_code_id: promo.promoCodeId,
        }),
      ),
    );
  }
  return json(req, { error: "NOT_FOUND" }, 404);
});
