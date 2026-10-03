import { z } from "zod";
import {
  publicEventDetailSchema,
  publicEventRequestSchema,
  publicEventShareSchema,
  publicEventsPageRequestSchema,
  publicEventsPageSchema,
  publicOrgBySlugSchema,
  publicOrgRequestSchema,
  publicSalesTermsSchema,
} from "../../../shared/schemas/public-catalog.ts";
import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import {
  BodyTooLargeError,
  readLimitedJson,
} from "../_shared/app/request-body.ts";
import { consumeRequestRateLimit } from "../_shared/app/rate-limit/mod.ts";
import { applicationRateLimits } from "../_shared/app/config/rate-limits.ts";
import { resolveRequestClientIp } from "../_shared/app/client-ip.ts";
import {
  organizerInput,
  throwOrganizerDatabaseError,
} from "../_shared/organizer-dto.ts";
import {
  conflict,
  internal,
  notFound,
  ResponseError,
} from "../_shared/errors.ts";

const reference = z.object({ id: z.uuid() });
const profileReference = z.object({ org_id: z.uuid() });
const detailTransport = z.object({
  org: z.record(z.string(), z.unknown()),
  event: z.unknown(),
  products: z.array(z.unknown()),
  formFields: z.array(z.unknown()),
  formFieldsGroups: z.array(z.unknown()),
});

const handle = createEdgeHandler({
  name: "events-public",
  method: "POST",
  auth: "none",
  serviceClient: true,
  requestContextOptions: { useRequestAuthorization: false },
  onError: ({ req, logger, error }) => {
    if (error instanceof BodyTooLargeError) {
      return json(req, { error: "PAYLOAD_TOO_LARGE" }, 413);
    }
    if (error instanceof SyntaxError) {
      return json(req, { error: "INVALID_JSON" }, 400);
    }
    if (error instanceof ResponseError) {
      return json(req, { error: error.code }, error.status);
    }
    logger.error("public_catalog_failed", { code: "UNEXPECTED_ERROR" });
    return json(req, { error: "UNEXPECTED_ERROR" }, 500);
  },
}, async ({ req, serviceClient, logger }) => {
  const route = new URL(req.url).pathname.match(
    /^(?:\/functions\/v1)?\/events\/public\/(org|overview|detail|sales-terms|share)$/,
  )?.[1];
  if (!route) throw notFound("NOT_FOUND");
  const ip = await resolveRequestClientIp(req);
  const ingress = await consumeRequestRateLimit({
    req,
    supabase: serviceClient,
    logger,
    key: ip ? `ip:${ip.ip}` : "shared:unresolved",
    ...(ip
      ? applicationRateLimits.publicCatalogIp
      : applicationRateLimits.publicCatalogFallback),
  });
  if (!ingress.allowed) return ingress.response;
  const body = await readLimitedJson(req, 4096);
  const input = route === "overview"
    ? organizerInput(publicEventsPageRequestSchema, body)
    : route === "detail" || route === "share"
    ? organizerInput(publicEventRequestSchema, body)
    : organizerInput(publicOrgRequestSchema, body);

  // Only minimal references are read before publication authorization. Slugs and
  // supplied IDs never authorize a private organization or unpublished event.
  const profile = await serviceClient.from("organization_profile").select(
    "org_id",
  ).eq("slug", input.orgSlug).maybeSingle();
  if (profile.error) throw internal("CATALOG_LOAD_FAILED");
  if (!profile.data) throw notFound("NOT_FOUND");
  const orgId = profileReference.parse(profile.data).org_id;
  const org = await serviceClient.from("organizations").select("id").eq(
    "id",
    orgId,
  ).eq("status", "active").maybeSingle();
  if (org.error) throw internal("CATALOG_LOAD_FAILED");
  if (!org.data) throw notFound("NOT_FOUND");
  reference.parse(org.data);
  let eventId: string | null = null;
  if ("eventSlug" in input) {
    const event = await serviceClient.from("events").select("id").eq(
      "org_id",
      orgId,
    )
      .eq("slug", input.eventSlug).eq("is_published", true).maybeSingle();
    if (event.error) throw internal("CATALOG_LOAD_FAILED");
    if (!event.data) throw notFound("NOT_FOUND");
    eventId = reference.parse(event.data).id;
  }
  const resource = await consumeRequestRateLimit({
    req,
    supabase: serviceClient,
    logger,
    key: `org:${orgId}:event:${eventId ?? "none"}:route:${route}`,
    ...applicationRateLimits.publicCatalogResource,
  });
  if (!resource.allowed) return resource.response;
  const base = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  if (!base) throw internal("CATALOG_CONFIGURATION_FAILED");
  const banner =
    `${base}/storage/v1/object/public/public-assets/defaults/default_banner.webp`;
  const logo =
    `${base}/storage/v1/object/public/public-assets/defaults/default_logo.webp`;
  async function transaction(name: string, args: Record<string, unknown>) {
    const { data, error } = await serviceClient.rpc(name, args);
    if (error) {
      if (error.message === "FORBIDDEN") {
        throw new ResponseError(403, "FORBIDDEN");
      }
      if (error.message === "CATALOG_LIMIT_EXCEEDED") {
        throw conflict("CATALOG_LIMIT_EXCEEDED");
      }
      throwOrganizerDatabaseError(error);
    }
    return data;
  }
  const args = { p_org_id: orgId, p_org_slug: input.orgSlug };
  if (route === "org") {
    const result = publicOrgBySlugSchema.parse(
      await transaction("catalog_get_public_org_by_slug", {
        p_org_id: orgId,
        p_slug: input.orgSlug,
      }),
    );
    const image = (value: string | null, filename: string, fallback: string) =>
      value?.endsWith(`/public-assets/defaults/${filename}`) ? fallback : value;
    return json(
      req,
      publicOrgBySlugSchema.parse({
        ...result,
        profile: {
          ...result.profile,
          logoUrl: image(result.profile.logoUrl, "default_logo.webp", logo),
          defaultEventBannerUrl: image(
            result.profile.defaultEventBannerUrl,
            "default_banner.webp",
            banner,
          ),
        },
      }),
    );
  }
  if (route === "overview") {
    const pageInput = organizerInput(publicEventsPageRequestSchema, body);
    return json(
      req,
      publicEventsPageSchema.parse(
        await transaction("catalog_get_public_org_events_overview", {
          ...args,
          p_default_banner_url: banner,
          p_limit: pageInput.limit,
          p_after: pageInput.after ?? null,
        }),
      ),
    );
  }
  if (route === "share" && eventId) {
    return json(
      req,
      publicEventShareSchema.parse(
        await transaction("catalog_event_share", {
          p_org_id: orgId,
          p_event_id: eventId,
          p_default_banner_url: banner,
        }),
      ),
    );
  }
  const terms = await transaction(
    "catalog_get_public_organization_sales_terms",
    args,
  );
  if (route === "sales-terms") {
    return json(req, publicSalesTermsSchema.parse(terms));
  }
  if (route === "detail" && "eventSlug" in input) {
    const detail = detailTransport.parse(
      await transaction("catalog_get_public_event_detail", {
        ...args,
        p_event_slug: input.eventSlug,
        p_default_banner_url: banner,
        p_default_logo_url: logo,
      }),
    );
    return json(
      req,
      publicEventDetailSchema.parse({
        ...detail,
        org: { ...detail.org, ...publicSalesTermsSchema.parse(terms) },
      }),
    );
  }
  throw notFound("NOT_FOUND");
});

export async function handlePublicCatalogRequest(
  req: Request,
): Promise<Response> {
  const response = await handle(req);
  // Public data contains live availability and publication state; no stale
  // cached response should keep a withdrawn event or old contract available.
  response.headers.set("cache-control", "no-store");
  return response;
}
