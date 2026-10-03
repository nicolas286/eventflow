import { mapPlatformTransport } from "./transport.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  platformAccessSchema,
  platformAdminAccessRequestSchema,
  platformAnnouncementDraftRequestSchema,
  platformAuditSchema,
  platformConfigurationSchema,
  platformCommunicationsSchema,
  platformEmailCampaignRequestSchema,
  platformEmailCampaignResultSchema,
  platformFinanceSchema,
  platformOnboardingRequestSchema,
  platformOrganizationDetailSchema,
  platformOrganizationOwnerRequestSchema,
  platformOrganizationPlanRequestSchema,
  platformOrganizationsPageSchema,
  platformOrganizationStatusRequestSchema,
  platformOverviewSchema,
  platformOperationsSchema,
  platformAdminsSchema,
  platformRegistrationSettingsRequestSchema,
  platformSimpleMutationSchema,
  platformStepUpRequestSchema,
  platformStepUpResponseSchema,
} from "../../../shared/schemas/platform-admin.ts";
import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { platformAdminRateLimits } from "../_shared/app/config/rate-limits.ts";
import { json } from "../_shared/app/http.ts";
import { sendEmailOrThrow } from "../_shared/app/email.ts";
import {
  BodyTooLargeError,
  readLimitedJson,
} from "../_shared/app/request-body.ts";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  ResponseError,
} from "../_shared/errors.ts";
import { serializeError } from "../_shared/modules/logger/mod.ts";
import {
  assertRecentTotp,
  randomStepUpToken,
  resolvePlatformAccess,
  sha256Hex,
} from "./auth.ts";

const MAX_BODY_BYTES = 64 * 1024;
const overviewQuerySchema = z.coerce.number().int().min(7).max(365);
const organizationsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(120).default(""),
    status: z
      .union([z.enum(["trial", "active", "suspended"]), z.literal("")])
      .default(""),
    plan: z
      .union([z.enum(["free", "starter", "pro"]), z.literal("")])
      .default(""),
    paymentsProvider: z
      .union([z.enum(["mollie", "stripe", "bank_transfer"]), z.literal("")])
      .default(""),
    paymentsStatus: z
      .union([
        z.enum(["not_connected", "pending", "connected", "revoked"]),
        z.literal(""),
      ])
      .default(""),
    cursorCreatedAt: z
      .union([z.iso.datetime({ offset: true }), z.literal("")])
      .default(""),
    cursorId: z.union([z.uuid(), z.literal("")]).default(""),
  })
  .refine(
    (value) => Boolean(value.cursorCreatedAt) === Boolean(value.cursorId),
    {
      message: "PLATFORM_CURSOR_INCOMPLETE",
    },
  );
const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursorCreatedAt: z
    .union([z.iso.datetime({ offset: true }), z.literal("")])
    .default(""),
});
const emailCampaignDeliverySchema = z.object({
  id: z.uuid(),
  subject: z.string().min(1).max(160),
  body: z.string().min(1).max(10000),
  deliveries: z
    .array(
      z.object({
        id: z.uuid(),
        email: z.email(),
        organizationId: z.uuid(),
        organizationName: z.string(),
        claimToken: z.uuid(),
      }),
    )
    .max(100),
});

function routePath(req: Request): string[] {
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const base = segments.lastIndexOf("platform-admin");
  return base < 0 ? [] : segments.slice(base + 1);
}

async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await readLimitedJson(req, MAX_BODY_BYTES));
  if (!parsed.success) throw badRequest("PLATFORM_INVALID_PAYLOAD");
  return parsed.data;
}

async function rpcJson(
  serviceClient: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await serviceClient.rpc(name, args);
  if (!error) return mapPlatformTransport(name, args.p_resource, data);

  const message = error.message ?? "";
  if (message.includes("PLATFORM_STEP_UP_REQUIRED")) {
    throw forbidden("PLATFORM_STEP_UP_REQUIRED");
  }
  if (message.includes("PLATFORM_MFA_REQUIRED")) {
    throw forbidden("PLATFORM_MFA_REQUIRED");
  }
  if (message.includes("PLATFORM_FORBIDDEN")) {
    throw forbidden("PLATFORM_FORBIDDEN");
  }
  if (message.includes("PLATFORM_ORGANIZATION_NOT_FOUND")) {
    throw notFound("PLATFORM_ORGANIZATION_NOT_FOUND");
  }
  if (message.includes("PLATFORM_OWNER_ALREADY_MEMBER")) {
    throw conflict("PLATFORM_OWNER_ALREADY_MEMBER");
  }
  if (
    message.includes("CONFLICT") ||
    message.includes("STATE_CONFLICT") ||
    message.includes("PLATFORM_PROVIDER_MANAGED_SUBSCRIPTION")
  ) {
    throw conflict("PLATFORM_CONFLICT");
  }
  if (message.includes("PLATFORM_")) {
    throw badRequest(
      message.match(/PLATFORM_[A-Z0-9_]+/)?.[0] ?? "PLATFORM_INVALID_REQUEST",
    );
  }
  throw error;
}

function stepUpToken(req: Request): string {
  const token = req.headers.get("x-platform-step-up")?.trim();
  if (!token || token.length > 512)
    throw forbidden("PLATFORM_STEP_UP_REQUIRED");
  return token;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function campaignHtml(body: string, organizationName: string): string {
  const safeBody = escapeHtml(body).replaceAll("\n", "<br>");
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f7fb;color:#14213d;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:auto;background:#fff;border:1px solid #dce4ef;border-radius:16px"><tr><td style="padding:28px"><p style="margin:0 0 20px;color:#3157d5;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Eventflow · Information plateforme</p><p style="margin:0 0 18px;font-size:16px">Bonjour ${escapeHtml(organizationName)},</p><div style="font-size:16px;line-height:1.65">${safeBody}</div><p style="margin:28px 0 0;padding-top:18px;border-top:1px solid #e7edf5;color:#66758c;font-size:13px">L’équipe Eventflow</p></td></tr></table></td></tr></table></body></html>`;
}

async function mutate(input: {
  serviceClient: SupabaseClient;
  userId: string;
  sessionId: string;
  aal: "aal1" | "aal2";
  action: string;
  payload: Record<string, unknown>;
  rawStepUpToken?: string;
}) {
  try {
    return await rpcJson(input.serviceClient, "platform_admin_mutate", {
      p_user_id: input.userId,
      p_session_id: input.sessionId,
      p_aal: input.aal,
      p_action: input.action,
      p_payload: input.payload,
      p_step_up_hash: input.rawStepUpToken
        ? await sha256Hex(input.rawStepUpToken)
        : null,
    });
  } catch (error) {
    await auditFailure({
      serviceClient: input.serviceClient,
      userId: input.userId,
      sessionId: input.sessionId,
      aal: input.aal,
      action: input.action,
      targetId: mutationTarget(input.payload),
      reason:
        typeof input.payload.reason === "string" ? input.payload.reason : null,
      error,
    });
    throw error;
  }
}

function mutationTarget(payload: Record<string, unknown>): string | null {
  for (const key of ["orgId", "id", "userId", "ownerEmail", "email"]) {
    if (typeof payload[key] === "string") return payload[key];
  }
  return null;
}

async function auditFailure(input: {
  serviceClient: SupabaseClient;
  userId: string;
  sessionId: string;
  aal: "aal1" | "aal2";
  action: string;
  targetId: string | null;
  reason: string | null;
  error: unknown;
}) {
  const errorCode =
    input.error instanceof ResponseError
      ? input.error.code
      : "UNEXPECTED_ERROR";
  try {
    await input.serviceClient.rpc("platform_admin_mutate", {
      p_user_id: input.userId,
      p_session_id: input.sessionId,
      p_aal: input.aal,
      p_action: "external.audit",
      p_payload: {
        externalAction: input.action,
        targetType: "platform_mutation",
        targetId: input.targetId,
        success: false,
        reason: input.reason,
        metadata: { errorCode },
      },
      p_step_up_hash: null,
    });
  } catch {
    // Never mask the original mutation error if audit storage is unavailable.
  }
}

async function findAuthUserByEmail(
  serviceClient: SupabaseClient,
  email: string,
): Promise<{ id: string; email: string } | null> {
  const result = await rpcJson(
    serviceClient,
    "platform_find_auth_user_by_email",
    {
      p_email: email,
    },
  );
  if (!result) return null;
  const parsed = z.object({ id: z.uuid(), email: z.email() }).safeParse(result);
  if (!parsed.success) throw new Error("PLATFORM_AUTH_USER_RESPONSE_INVALID");
  return parsed.data;
}

async function inviteOwner(input: {
  serviceClient: SupabaseClient;
  email: string;
  firstName: string;
  lastName: string;
}) {
  const appBaseUrl = Deno.env.get("APP_BASE_URL")?.trim();
  const { data, error } =
    await input.serviceClient.auth.admin.inviteUserByEmail(input.email, {
      data: {
        first_name: input.firstName,
        last_name: input.lastName,
        invited_for: "organization_owner",
      },
      ...(appBaseUrl
        ? { redirectTo: `${appBaseUrl.replace(/\/$/, "")}/admin/login` }
        : {}),
    });
  if (error || !data.user) throw conflict("PLATFORM_INVITATION_FAILED");
  return data.user;
}

export const handlePlatformAdminRequest = createEdgeHandler(
  {
    name: "platform-admin",
    method: ["GET", "POST", "PATCH"],
    auth: "required",
    requireVerifiedEmail: true,
    serviceClient: true,
    rateLimit: {
      ...platformAdminRateLimits.api,
      key: "user",
    },
    onError: ({ req, logger, error }) => {
      if (error instanceof BodyTooLargeError) {
        return json(req, { error: "PAYLOAD_TOO_LARGE" }, 413);
      }
      if (error instanceof SyntaxError) {
        return json(req, { error: "INVALID_JSON" }, 400);
      }
      if (error instanceof z.ZodError) {
        return json(req, { error: "PLATFORM_INVALID_PAYLOAD" }, 400);
      }
      if (error instanceof ResponseError) {
        return json(req, { error: error.code }, error.status);
      }
      logger.error("platform_admin_request_failed", {
        error: serializeError(error),
      });
      return json(req, { error: "UNEXPECTED_ERROR" }, 500);
    },
  },
  async ({ req, user, serviceClient }) => {
    const path = routePath(req);

    if (req.method === "GET" && path.length === 1 && path[0] === "access") {
      const claims = await resolvePlatformAccess({
        req,
        user,
        serviceClient,
        requireAal2: false,
      });
      return json(
        req,
        platformAccessSchema.parse({
          isPlatformAdmin: true,
          sessionActive: true,
          aal: claims.aal,
          mfaRequired: claims.aal !== "aal2",
        }),
      );
    }

    const claims = await resolvePlatformAccess({ req, user, serviceClient });
    const baseReadArgs = {
      p_user_id: user.id,
      p_session_id: claims.sessionId,
      p_aal: claims.aal,
    };

    if (req.method === "POST" && path.length === 1 && path[0] === "step-up") {
      const body = await parseBody(req, platformStepUpRequestSchema);
      assertRecentTotp(claims);
      const token = randomStepUpToken();
      const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
      await rpcJson(serviceClient, "platform_admin_issue_step_up", {
        ...baseReadArgs,
        p_token_hash: await sha256Hex(token),
        p_action: body.action,
        p_target_id: body.targetId,
        p_expires_at: expiresAt,
      });
      return json(
        req,
        platformStepUpResponseSchema.parse({ token, expiresAt }),
      );
    }

    if (req.method === "GET" && path.length === 1 && path[0] === "overview") {
      const raw = new URL(req.url).searchParams.get("periodDays") ?? "30";
      const periodDays = overviewQuerySchema.parse(raw);
      const data = await rpcJson(serviceClient, "platform_admin_read", {
        ...baseReadArgs,
        p_resource: "overview",
        p_params: { periodDays },
      });
      return json(req, platformOverviewSchema.parse(data));
    }

    if (
      req.method === "GET" &&
      path.length === 1 &&
      path[0] === "organizations"
    ) {
      const query = new URL(req.url).searchParams;
      const filters = organizationsQuerySchema.parse({
        limit: query.get("limit") ?? undefined,
        search: query.get("search") ?? undefined,
        status: query.get("status") ?? undefined,
        plan: query.get("plan") ?? undefined,
        paymentsProvider: query.get("paymentsProvider") ?? undefined,
        paymentsStatus: query.get("paymentsStatus") ?? undefined,
        cursorCreatedAt: query.get("cursorCreatedAt") ?? undefined,
        cursorId: query.get("cursorId") ?? undefined,
      });
      const data = await rpcJson(serviceClient, "platform_admin_read", {
        ...baseReadArgs,
        p_resource: "organizations",
        p_params: filters,
      });
      return json(req, platformOrganizationsPageSchema.parse(data));
    }

    if (
      req.method === "GET" &&
      path.length === 2 &&
      path[0] === "organizations"
    ) {
      const orgId = z.uuid().parse(path[1]);
      const data = await rpcJson(serviceClient, "platform_admin_read", {
        ...baseReadArgs,
        p_resource: "organization",
        p_params: { orgId },
      });
      return json(req, platformOrganizationDetailSchema.parse(data));
    }

    if (
      req.method === "GET" &&
      path.length === 1 &&
      ["finance", "operations", "admins"].includes(path[0])
    ) {
      const data = await rpcJson(serviceClient, "platform_admin_read", {
        ...baseReadArgs,
        p_resource: path[0],
        p_params: { limit: 50 },
      });
      const schema =
        path[0] === "finance"
          ? platformFinanceSchema
          : path[0] === "operations"
            ? platformOperationsSchema
            : platformAdminsSchema;
      return json(req, schema.parse(data));
    }

    if (
      req.method === "GET" &&
      path.length === 1 &&
      path[0] === "configuration"
    ) {
      const data = await rpcJson(serviceClient, "platform_admin_read", {
        ...baseReadArgs,
        p_resource: "configuration",
        p_params: {},
      });
      return json(req, platformConfigurationSchema.parse(data));
    }

    if (
      req.method === "GET" &&
      path.length === 1 &&
      path[0] === "communications"
    ) {
      const data = await rpcJson(
        serviceClient,
        "platform_admin_read_email_campaigns",
        {
          ...baseReadArgs,
          p_limit: 30,
        },
      );
      return json(req, platformCommunicationsSchema.parse(data));
    }

    if (req.method === "GET" && path.length === 1 && path[0] === "audit") {
      const query = new URL(req.url).searchParams;
      const filters = auditQuerySchema.parse({
        limit: query.get("limit") ?? undefined,
        cursorCreatedAt: query.get("cursorCreatedAt") ?? undefined,
      });
      const data = await rpcJson(serviceClient, "platform_admin_read", {
        ...baseReadArgs,
        p_resource: "audit",
        p_params: filters,
      });
      return json(req, platformAuditSchema.parse(data));
    }

    if (
      req.method === "POST" &&
      path.length === 1 &&
      path[0] === "onboarding"
    ) {
      const body = await parseBody(req, platformOnboardingRequestSchema);
      const payloadHash = await sha256Hex(JSON.stringify(body));
      await rpcJson(serviceClient, "platform_admin_authorize_onboarding", {
        ...baseReadArgs,
        p_idempotency_key: body.idempotencyKey,
        p_owner_email: body.ownerEmail,
        p_payload_hash: payloadHash,
        p_step_up_hash: await sha256Hex(stepUpToken(req)),
      });
      let owner;
      let invitationSent = false;
      try {
        owner = await findAuthUserByEmail(serviceClient, body.ownerEmail);
        if (!owner) {
          const invited = await inviteOwner({
            serviceClient,
            email: body.ownerEmail,
            firstName: body.ownerFirstName,
            lastName: body.ownerLastName,
          });
          owner = { id: invited.id, email: invited.email ?? body.ownerEmail };
          invitationSent = true;
        }
      } catch (error) {
        await auditFailure({
          serviceClient,
          userId: user.id,
          sessionId: claims.sessionId,
          aal: claims.aal,
          action: "organizations.onboard",
          targetId: body.ownerEmail,
          reason: body.reason,
          error,
        });
        throw error;
      }

      const payload = {
        ...body,
        ownerUserId: owner.id,
        payloadHash,
      };
      const result = await mutate({
        serviceClient,
        userId: user.id,
        sessionId: claims.sessionId,
        aal: claims.aal,
        action: "organizations.onboard",
        payload,
      });
      return json(req, { ...(result as object), invitationSent }, 201);
    }

    if (
      req.method === "PATCH" &&
      path.length === 3 &&
      path[0] === "organizations"
    ) {
      const orgId = z.uuid().parse(path[1]);
      const action = path[2];
      let mutationAction: string;
      let payload: Record<string, unknown>;

      if (action === "status") {
        mutationAction = "organizations.status";
        payload = {
          ...(await parseBody(req, platformOrganizationStatusRequestSchema)),
          orgId,
        };
      } else if (action === "plan") {
        mutationAction = "organizations.plan";
        payload = {
          ...(await parseBody(req, platformOrganizationPlanRequestSchema)),
          orgId,
        };
      } else if (action === "owner") {
        mutationAction = "organizations.owner";
        const body = await parseBody(
          req,
          platformOrganizationOwnerRequestSchema,
        );
        const owner = await findAuthUserByEmail(serviceClient, body.ownerEmail);
        if (!owner) throw notFound("PLATFORM_OWNER_NOT_FOUND");
        payload = { ...body, orgId, ownerUserId: owner.id };
      } else {
        throw notFound("NOT_FOUND");
      }

      return json(
        req,
        await mutate({
          serviceClient,
          userId: user.id,
          sessionId: claims.sessionId,
          aal: claims.aal,
          action: mutationAction,
          payload,
          rawStepUpToken: stepUpToken(req),
        }),
      );
    }

    if (
      req.method === "PATCH" &&
      path.length === 2 &&
      path[0] === "configuration" &&
      path[1] === "registrations"
    ) {
      const body = await parseBody(
        req,
        platformRegistrationSettingsRequestSchema,
      );
      return json(
        req,
        await mutate({
          serviceClient,
          userId: user.id,
          sessionId: claims.sessionId,
          aal: claims.aal,
          action: "settings.registrations.set",
          payload: body,
          rawStepUpToken: stepUpToken(req),
        }),
      );
    }

    if (
      req.method === "POST" &&
      path.length === 2 &&
      path[0] === "announcements" &&
      path[1] === "draft"
    ) {
      const body = await parseBody(req, platformAnnouncementDraftRequestSchema);
      return json(
        req,
        await mutate({
          serviceClient,
          userId: user.id,
          sessionId: claims.sessionId,
          aal: claims.aal,
          action: "announcements.save",
          payload: body,
        }),
      );
    }

    if (
      req.method === "POST" &&
      path.length === 2 &&
      path[0] === "communications" &&
      path[1] === "email"
    ) {
      const body = await parseBody(req, platformEmailCampaignRequestSchema);
      const rawStepUpToken = stepUpToken(req);
      let created;
      try {
        created = platformEmailCampaignResultSchema.parse(
          await rpcJson(
            serviceClient,
            "platform_admin_create_email_campaign",
            {
              ...baseReadArgs,
              p_payload: body,
              p_step_up_hash: await sha256Hex(rawStepUpToken),
            },
          ),
        );
      } catch (error) {
        await auditFailure({
          serviceClient,
          userId: user.id,
          sessionId: claims.sessionId,
          aal: claims.aal,
          action: "communications.email.send",
          targetId:
            body.target === "all"
              ? "all-organizations"
              : body.organizationId,
          reason: body.reason,
          error,
        });
        throw error;
      }
      const campaign = emailCampaignDeliverySchema.parse(
        await rpcJson(
          serviceClient,
          "platform_admin_email_campaign_deliveries",
          { p_campaign_id: created.id },
        ),
      );

      for (let offset = 0; offset < campaign.deliveries.length; offset += 5) {
        await Promise.all(
          campaign.deliveries.slice(offset, offset + 5).map(async (delivery) => {
            let result: Awaited<ReturnType<typeof sendEmailOrThrow>>;
            try {
              result = await sendEmailOrThrow({
                to: delivery.email,
                subject: campaign.subject,
                text: `Bonjour ${delivery.organizationName},\n\n${campaign.body}\n\nL’équipe Eventflow`,
                html: campaignHtml(campaign.body, delivery.organizationName),
                tags: {
                  source: "platform-admin",
                  campaign: created.id,
                },
                idempotencyKey: `platform-email/${created.id}/${delivery.id}`,
              });
            } catch {
              await rpcJson(
                serviceClient,
                "platform_admin_complete_email_delivery",
                {
                  p_campaign_id: created.id,
                  p_delivery_id: delivery.id,
                  p_claim_token: delivery.claimToken,
                  p_success: false,
                  p_provider: null,
                  p_provider_message_id: null,
                  p_error_code: "MAIL_SERVICE_FAILED",
                },
              );
              return;
            }
            await rpcJson(
              serviceClient,
              "platform_admin_complete_email_delivery",
              {
                p_campaign_id: created.id,
                p_delivery_id: delivery.id,
                  p_claim_token: delivery.claimToken,
                p_success: true,
                p_provider: result.provider,
                p_provider_message_id: result.id,
                p_error_code: null,
              },
            );
          }),
        );
      }

      const result = await rpcJson(
        serviceClient,
        "platform_admin_finish_email_campaign",
        {
          p_campaign_id: created.id,
        },
      );
      return json(req, platformEmailCampaignResultSchema.parse(result), 201);
    }

    if (
      req.method === "POST" &&
      path.length === 3 &&
      path[0] === "announcements" &&
      ["publish", "retire"].includes(path[2])
    ) {
      const id = z.uuid().parse(path[1]);
      const body = await parseBody(req, platformSimpleMutationSchema);
      const action = `announcements.${path[2]}`;
      return json(
        req,
        await mutate({
          serviceClient,
          userId: user.id,
          sessionId: claims.sessionId,
          aal: claims.aal,
          action,
          payload: { ...body, id },
          rawStepUpToken: stepUpToken(req),
        }),
      );
    }

    if (
      req.method === "POST" &&
      path.length === 2 &&
      path[0] === "admins" &&
      ["grant", "revoke"].includes(path[1])
    ) {
      const body = await parseBody(req, platformAdminAccessRequestSchema);
      const target = await findAuthUserByEmail(serviceClient, body.email);
      if (!target) throw notFound("PLATFORM_ADMIN_USER_NOT_FOUND");
      const action = `admins.${path[1]}`;
      return json(
        req,
        await mutate({
          serviceClient,
          userId: user.id,
          sessionId: claims.sessionId,
          aal: claims.aal,
          action,
          payload: { ...body, userId: target.id },
          rawStepUpToken: stepUpToken(req),
        }),
      );
    }

    throw notFound("NOT_FOUND");
  },
);

if (import.meta.main) Deno.serve(handlePlatformAdminRequest);
