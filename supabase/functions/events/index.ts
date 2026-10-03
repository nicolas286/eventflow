import { handlePublicCatalogRequest } from "./public.ts";
import {
  createEventInputSchema,
  deleteEventInputSchema,
  duplicateEventInputSchema,
  eventDetailRequestSchema,
  eventsOverviewRequestSchema,
  mutationSuccessSchema,
  updateEventRequestSchema,
} from "../../../shared/schemas/events.ts";
import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import {
  BodyTooLargeError,
  readLimitedJson,
} from "../_shared/app/request-body.ts";
import { consumeRequestRateLimit } from "../_shared/app/rate-limit/mod.ts";
import { applicationRateLimits } from "../_shared/app/config/rate-limits.ts";
import { forbidden, ResponseError } from "../_shared/errors.ts";
import { assertOrganizationManager } from "../_shared/organization-access.ts";
import { databasePatch, organizerInput } from "../_shared/organizer-dto.ts";
import { createEventsRepository } from "./repository.ts";
import { handleEventProductsRequest } from "./products.ts";
import { handleEventFormsRequest } from "./forms.ts";
import { handleEventPromosRequest } from "./promos.ts";

const handleEventCoreRequest = createEdgeHandler({
  name: "events",
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
    logger.error("event_operation_failed", { code: "UNEXPECTED_ERROR" });
    return json(req, { error: "UNEXPECTED_ERROR" }, 500);
  },
}, async ({ req, user, serviceClient, logger }) => {
  const path = new URL(req.url).pathname;
  const body = await readLimitedJson(req, 32768);
  const repository = createEventsRepository(serviceClient);
  async function authorizedEvent(
    input: { eventId: string } | { orgId: string; eventSlug: string },
  ) {
    if ("orgId" in input) {
      await assertOrganizationManager(serviceClient, input.orgId, user.id);
    }
    const event = await repository.findEvent(input);
    if (!("orgId" in input)) {
      await assertOrganizationManager(serviceClient, event.orgId, user.id);
    }
    return event;
  }
  async function quota(orgId: string, write: boolean) {
    const result = await consumeRequestRateLimit({
      req,
      supabase: serviceClient,
      logger,
      key: `user:${user.id}:org:${orgId.toLowerCase()}`,
      ...(write
        ? applicationRateLimits.organizerWrite
        : applicationRateLimits.organizerRead),
    });
    return result.allowed ? null : result.response;
  }
  if (path === "/events/overview" || path === "/functions/v1/events/overview") {
    const { orgId } = organizerInput(eventsOverviewRequestSchema, body);
    await assertOrganizationManager(serviceClient, orgId, user.id);
    const denied = await quota(orgId, false);
    if (denied) return denied;
    return json(req, await repository.overview(orgId));
  }
  if (path === "/events/detail" || path === "/functions/v1/events/detail") {
    const input = organizerInput(eventDetailRequestSchema, body);
    const event = await authorizedEvent(input);
    const denied = await quota(event.orgId, false);
    if (denied) return denied;
    return json(req, await repository.detail(event.orgId, event.eventId));
  }
  if (path === "/events/create" || path === "/functions/v1/events/create") {
    const input = organizerInput(createEventInputSchema, body);
    await assertOrganizationManager(serviceClient, input.orgId, user.id);
    const denied = await quota(input.orgId, true);
    if (denied) return denied;
    return json(
      req,
      await repository.mutate(
        "organizer_create_event",
        user.id,
        databasePatch(input),
      ),
    );
  }
  if (path === "/events/update" || path === "/functions/v1/events/update") {
    const input = organizerInput(updateEventRequestSchema, body);
    const event = await authorizedEvent({ eventId: input.eventId });
    const denied = await quota(event.orgId, true);
    if (denied) return denied;
    return json(
      req,
      await repository.mutate("organizer_update_event", user.id, {
        org_id: event.orgId,
        event_id: event.eventId,
        ...databasePatch(input.patch),
      }),
    );
  }
  if (
    path === "/events/duplicate" || path === "/functions/v1/events/duplicate"
  ) {
    const input = organizerInput(duplicateEventInputSchema, body);
    const event = await authorizedEvent({ eventId: input.sourceEventId });
    const denied = await quota(event.orgId, true);
    if (denied) return denied;
    return json(
      req,
      await repository.mutate("organizer_duplicate_event", user.id, {
        org_id: event.orgId,
        ...databasePatch(input),
      }),
    );
  }
  if (path === "/events/delete" || path === "/functions/v1/events/delete") {
    const input = organizerInput(deleteEventInputSchema, body);
    const event = await authorizedEvent({ eventId: input.eventId });
    if (input.orgId && input.orgId !== event.orgId) {
      throw forbidden("FORBIDDEN");
    }
    const denied = await quota(event.orgId, true);
    if (denied) return denied;
    await repository.remove(user.id, event.orgId, event.eventId);
    return json(req, mutationSuccessSchema.parse({ success: true }));
  }
  return json(req, { error: "NOT_FOUND" }, 404);
});

export function handleEventsRequest(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (/^(?:\/functions\/v1)?\/events\/public\//.test(path)) return handlePublicCatalogRequest(req);
  if (
    path.startsWith("/events/promos/") ||
    path.startsWith("/functions/v1/events/promos/")
  ) return handleEventPromosRequest(req);
  if (
    path.startsWith("/events/forms/") ||
    path.startsWith("/functions/v1/events/forms/")
  ) return handleEventFormsRequest(req);
  return path.startsWith("/events/products/") ||
      path.startsWith("/functions/v1/events/products/")
    ? handleEventProductsRequest(req)
    : handleEventCoreRequest(req);
}

if (import.meta.main) Deno.serve(handleEventsRequest);
