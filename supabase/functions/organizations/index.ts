import {
  acceptAgreementsRequestSchema,
  createOrganizationRequestSchema,
  createOrganizationResponseSchema,
  dashboardRequestSchema,
  mutationSuccessSchema,
  sellerIdentityRequestSchema,
  updateBrandingRequestSchema,
  updateOrganizationRequestSchema,
  updateOrganizationResponseSchema,
  updateProfileRequestSchema,
} from "../../../shared/schemas/organizations.ts";
import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import {
  BodyTooLargeError,
  readLimitedJson,
} from "../_shared/app/request-body.ts";
import { consumeRequestRateLimit } from "../_shared/app/rate-limit/mod.ts";
import { applicationRateLimits } from "../_shared/app/config/rate-limits.ts";
import { badRequest, forbidden, ResponseError } from "../_shared/errors.ts";
import { assertOrganizationManager } from "../_shared/organization-access.ts";
import { databasePatch, organizerInput } from "../_shared/organizer-dto.ts";
import { createOrganizationsRepository } from "./repository.ts";
import { handleOrganizationAssetsRequest } from "./assets.ts";
import {
  billingReadResponseSchema,
  billingRequestSchema,
  organizationBillingPatchSchema,
} from "../../../shared/schemas/organization-billing.ts";
import {
  getOrganizationBilling,
  updateOrganizationBilling,
} from "./billing.ts";

const handleOrganizationCoreRequest = createEdgeHandler({
  name: "organizations",
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
    logger.error("organization_operation_failed", { code: "UNEXPECTED_ERROR" });
    return json(req, { error: "UNEXPECTED_ERROR" }, 500);
  },
}, async ({ req, user, serviceClient, logger }) => {
  const path = new URL(req.url).pathname;
  const body = await readLimitedJson(req, 16384);
  const repository = createOrganizationsRepository(serviceClient);
  async function quota(orgId: string | null, write: boolean, create = false) {
    if (orgId) await assertOrganizationManager(serviceClient, orgId, user.id);
    const result = await consumeRequestRateLimit({
      req,
      supabase: serviceClient,
      logger,
      key: orgId ? `user:${user.id}:org:${orgId.toLowerCase()}` : `user:${user.id}`,
      ...(create
        ? applicationRateLimits.organizationCreate
        : write
        ? applicationRateLimits.organizerWrite
        : applicationRateLimits.organizerRead),
    });
    return result.allowed ? null : result.response;
  }
  if (path.endsWith("/organizations/billing/read")) {
    const input = organizerInput(billingRequestSchema, body);
    const denied = await quota(input.orgId, false);
    if (denied) return denied;
    return json(
      req,
      billingReadResponseSchema.parse({
        billing: await getOrganizationBilling(serviceClient, input.orgId),
      }),
    );
  }
  if (path.endsWith("/organizations/billing/update")) {
    const input = organizerInput(organizationBillingPatchSchema, body);
    const denied = await quota(input.orgId, true);
    if (denied) return denied;
    return json(
      req,
      await updateOrganizationBilling(serviceClient, user.id, input),
    );
  }
  if (path.endsWith("/organizations/bootstrap")) {
    const input = organizerInput(dashboardRequestSchema, body);
    const membership = await repository.selectedMembership(
      user.id,
      input.orgId,
    );
    if (input.orgId && !membership) throw forbidden();
    const denied = await quota(membership?.orgId ?? null, false);
    if (denied) return denied;
    return json(req, await repository.bootstrap(user.id, membership));
  }
  if (path.endsWith("/organizations/create")) {
    const input = organizerInput(createOrganizationRequestSchema, body);
    const denied = await quota(null, true, true);
    if (denied) return denied;
    return json(
      req,
      createOrganizationResponseSchema.parse(
        await repository.transaction(
          "organizer_create_organization",
          { p_actor_id: user.id, p_input: input },
        ),
      ),
    );
  }
  if (path.endsWith("/organizations/update")) {
    const input = organizerInput(updateOrganizationRequestSchema, body);
    const denied = await quota(input.orgId, true);
    if (denied) return denied;
    return json(
      req,
      updateOrganizationResponseSchema.parse(
        await repository.transaction(
          "organizer_update_organization",
          { p_actor_id: user.id, p_input: databasePatch(input) },
        ),
      ),
    );
  }
  if (path.endsWith("/organizations/profile")) {
    const input = organizerInput(updateProfileRequestSchema, body);
    if (input.userId !== user.id) throw forbidden();
    const denied = await quota(null, true);
    if (denied) return denied;
    return json(req, await repository.updateProfile(user.id, input.patch));
  }
  if (path.endsWith("/organizations/branding")) {
    const input = organizerInput(updateBrandingRequestSchema, body);
    const denied = await quota(input.orgId, true);
    if (denied) return denied;
    return json(req, await repository.updateBranding(input.orgId, input.patch));
  }
  if (path.endsWith("/organizations/seller-identity")) {
    const input = organizerInput(sellerIdentityRequestSchema, body);
    const denied = await quota(input.orgId, true);
    if (denied) return denied;
    await repository.transaction("organizer_update_seller_identity", {
      p_actor_id: user.id,
      p_org_id: input.orgId,
      p_legal_name: input.legalName,
      p_address: input.address,
      p_business_number: input.businessNumber,
      p_seller_type: input.sellerType,
      p_phone: input.phone,
    });
    return json(req, mutationSuccessSchema.parse({ success: true }));
  }
  if (path.endsWith("/organizations/agreements")) {
    const input = organizerInput(acceptAgreementsRequestSchema, body);
    const denied = await quota(input.orgId, true);
    if (denied) return denied;
    await repository.transaction("organizer_accept_platform_agreements", {
      p_actor_id: user.id,
      p_org_id: input.orgId,
      p_connect_version: input.connectVersion,
      p_dpa_version: input.dpaVersion,
      p_platform_terms_version: input.platformTermsVersion,
      p_privacy_version: input.privacyVersion,
    });
    return json(req, mutationSuccessSchema.parse({ success: true }));
  }
  throw badRequest("UNKNOWN_ROUTE");
});
export function handleOrganizationsRequest(req: Request): Promise<Response> {
  if (new URL(req.url).pathname.includes("/organizations/assets/")) {
    return handleOrganizationAssetsRequest(req);
  }
  return handleOrganizationCoreRequest(req);
}
if (import.meta.main) Deno.serve(handleOrganizationsRequest);
