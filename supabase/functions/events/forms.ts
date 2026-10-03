import { z } from "zod";
import {
  fieldCreateRequestSchema,
  fieldDeleteRequestSchema,
  fieldReadRequestSchema,
  fieldUpdateRequestSchema,
  formReorderRequestSchema,
  groupCreateRequestSchema,
  groupDeleteRequestSchema,
  groupReadRequestSchema,
  groupUpdateRequestSchema,
  mutationSuccessSchema,
} from "../../../shared/schemas/event-forms.ts";
import {
  eventFormFieldGroupSchema,
  eventFormFieldSchema,
} from "../../../shared/schemas/event-form-fields-data.ts";
import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import {
  BodyTooLargeError,
  readLimitedJson,
} from "../_shared/app/request-body.ts";
import { consumeRequestRateLimit } from "../_shared/app/rate-limit/mod.ts";
import { applicationRateLimits } from "../_shared/app/config/rate-limits.ts";
import {
  badRequest,
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

const referenceSchema = z.object({ id: z.uuid(), event_id: z.uuid() });
type FormTable = "event_form_fields" | "event_form_field_groups";

export const handleEventFormsRequest = createEdgeHandler({
  name: "event-forms",
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
    logger.error("form_operation_failed", { code: "UNEXPECTED_ERROR" });
    return json(req, { error: "UNEXPECTED_ERROR" }, 500);
  },
}, async ({ req, user, serviceClient, logger }) => {
  const path = new URL(req.url).pathname;
  const body = await readLimitedJson(req, 65536);
  const repository = createEventsRepository(serviceClient);
  async function authorizedEvent(eventId: string) {
    const event = await repository.findEvent({ eventId });
    await assertOrganizationManager(serviceClient, event.orgId, user.id);
    return event;
  }
  async function authorizedChild(table: FormTable, id: string) {
    const { data, error } = await serviceClient.from(table).select(
      "id,event_id",
    ).eq("id", id).maybeSingle();
    if (error) throw internal("FORM_LOAD_FAILED");
    if (!data) throw notFound("NOT_FOUND");
    const child = referenceSchema.parse(data);
    return { ...(await authorizedEvent(child.event_id)), id: child.id };
  }
  async function checkGroup(
    groupId: string | null | undefined,
    eventId: string,
  ) {
    if (!groupId) return;
    const { data, error } = await serviceClient.from("event_form_field_groups")
      .select("id,event_id").eq("id", groupId).eq("event_id", eventId)
      .maybeSingle();
    if (error) throw internal("FORM_LOAD_FAILED");
    if (!data) throw badRequest("VALIDATION_ERROR");
    referenceSchema.parse(data);
  }
  async function checkReorder(
    table: FormTable,
    ids: string[],
    eventId: string,
  ) {
    if (!ids.length) return;
    const { data, error } = await serviceClient.from(table).select(
      "id,event_id",
    ).eq("event_id", eventId).in("id", ids).limit(100);
    if (error) throw internal("FORM_LOAD_FAILED");
    const rows = z.array(referenceSchema).parse(data);
    const requestedIds = new Set(ids.map((id) => id.toLowerCase()));
    if (
      rows.length !== ids.length ||
      rows.some((row) => !requestedIds.has(row.id.toLowerCase()))
    ) throw badRequest("VALIDATION_ERROR");
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
    path === "/events/forms/fields/create" ||
    path === "/functions/v1/events/forms/fields/create"
  ) {
    const input = organizerInput(fieldCreateRequestSchema, body);
    const event = await authorizedEvent(input.eventId);
    await checkGroup(input.groupId, event.eventId);
    const denied = await quota(event.orgId, true);
    if (denied) return denied;
    return json(
      req,
      dtoRow(
        eventFormFieldSchema,
        await transaction("organizer_create_event_form_field", {
          p_actor_id: user.id,
          p_input: { org_id: event.orgId, ...databasePatch(input) },
        }),
      ),
    );
  }
  if (
    path === "/events/forms/fields/update" ||
    path === "/functions/v1/events/forms/fields/update"
  ) {
    const input = organizerInput(fieldUpdateRequestSchema, body);
    const field = await authorizedChild("event_form_fields", input.fieldId);
    await checkGroup(input.patch.groupId, field.eventId);
    const denied = await quota(field.orgId, true);
    if (denied) return denied;
    return json(
      req,
      dtoRow(
        eventFormFieldSchema,
        await transaction("organizer_update_event_form_field", {
          p_actor_id: user.id,
          p_input: {
            org_id: field.orgId,
            event_id: field.eventId,
            field_id: field.id,
            ...databasePatch(input.patch),
          },
        }),
      ),
    );
  }
  if (
    path === "/events/forms/fields/read" ||
    path === "/functions/v1/events/forms/fields/read"
  ) {
    const input = organizerInput(fieldReadRequestSchema, body);
    const field = await authorizedChild("event_form_fields", input.fieldId);
    const denied = await quota(field.orgId, false);
    if (denied) return denied;
    const { data, error } = await serviceClient.from("event_form_fields")
      .select(dtoColumns(eventFormFieldSchema)).eq("id", field.id).eq(
        "event_id",
        field.eventId,
      ).maybeSingle();
    if (error) throw internal("FORM_LOAD_FAILED");
    if (!data) throw notFound("NOT_FOUND");
    return json(req, dtoRow(eventFormFieldSchema, data));
  }
  if (
    path === "/events/forms/fields/delete" ||
    path === "/functions/v1/events/forms/fields/delete"
  ) {
    const input = organizerInput(fieldDeleteRequestSchema, body);
    const field = await authorizedChild("event_form_fields", input.id);
    const denied = await quota(field.orgId, true);
    if (denied) return denied;
    return json(
      req,
      mutationSuccessSchema.parse(
        await transaction("organizer_delete_event_form_field", {
          p_actor_id: user.id,
          p_org_id: field.orgId,
          p_event_id: field.eventId,
          p_field_id: field.id,
        }),
      ),
    );
  }
  if (
    path === "/events/forms/groups/create" ||
    path === "/functions/v1/events/forms/groups/create"
  ) {
    const input = organizerInput(groupCreateRequestSchema, body);
    const event = await authorizedEvent(input.eventId);
    const denied = await quota(event.orgId, true);
    if (denied) return denied;
    return json(
      req,
      dtoRow(
        eventFormFieldGroupSchema,
        await transaction("organizer_create_event_form_field_group", {
          p_actor_id: user.id,
          p_input: { org_id: event.orgId, ...databasePatch(input) },
        }),
      ),
    );
  }
  if (
    path === "/events/forms/groups/update" ||
    path === "/functions/v1/events/forms/groups/update"
  ) {
    const input = organizerInput(groupUpdateRequestSchema, body);
    const group = await authorizedChild(
      "event_form_field_groups",
      input.groupId,
    );
    const denied = await quota(group.orgId, true);
    if (denied) return denied;
    return json(
      req,
      dtoRow(
        eventFormFieldGroupSchema,
        await transaction("organizer_update_event_form_field_group", {
          p_actor_id: user.id,
          p_input: {
            org_id: group.orgId,
            event_id: group.eventId,
            group_id: group.id,
            ...databasePatch(input.patch),
          },
        }),
      ),
    );
  }
  if (
    path === "/events/forms/groups/read" ||
    path === "/functions/v1/events/forms/groups/read"
  ) {
    const input = organizerInput(groupReadRequestSchema, body);
    const group = await authorizedChild(
      "event_form_field_groups",
      input.groupId,
    );
    const denied = await quota(group.orgId, false);
    if (denied) return denied;
    const { data, error } = await serviceClient.from("event_form_field_groups")
      .select(dtoColumns(eventFormFieldGroupSchema)).eq("id", group.id).eq(
        "event_id",
        group.eventId,
      ).maybeSingle();
    if (error) throw internal("FORM_LOAD_FAILED");
    if (!data) throw notFound("NOT_FOUND");
    return json(req, dtoRow(eventFormFieldGroupSchema, data));
  }
  if (
    path === "/events/forms/groups/delete" ||
    path === "/functions/v1/events/forms/groups/delete"
  ) {
    const input = organizerInput(groupDeleteRequestSchema, body);
    const group = await authorizedChild("event_form_field_groups", input.id);
    const denied = await quota(group.orgId, true);
    if (denied) return denied;
    return json(
      req,
      mutationSuccessSchema.parse(
        await transaction("organizer_delete_event_form_field_group", {
          p_actor_id: user.id,
          p_org_id: group.orgId,
          p_event_id: group.eventId,
          p_group_id: group.id,
        }),
      ),
    );
  }
  if (
    path === "/events/forms/reorder" ||
    path === "/functions/v1/events/forms/reorder"
  ) {
    const input = organizerInput(formReorderRequestSchema, body);
    const event = await authorizedEvent(input.eventId);
    await checkReorder(
      "event_form_fields",
      input.fields.map((field) => field.id),
      event.eventId,
    );
    await checkReorder(
      "event_form_field_groups",
      input.groups.map((group) => group.id),
      event.eventId,
    );
    const denied = await quota(event.orgId, true);
    if (denied) return denied;
    return json(
      req,
      mutationSuccessSchema.parse(
        await transaction("organizer_reorder_event_form", {
          p_actor_id: user.id,
          p_input: {
            org_id: event.orgId,
            event_id: event.eventId,
            fields: input.fields.map((field) => ({
              id: field.id,
              sort_order: field.sortOrder,
            })),
            groups: input.groups.map((group) => ({
              id: group.id,
              sort_order: group.sortOrder,
            })),
          },
        }),
      ),
    );
  }
  return json(req, { error: "NOT_FOUND" }, 404);
});
