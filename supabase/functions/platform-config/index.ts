import { z } from "zod";
import { platformPublicConfigSchema } from "../../../shared/schemas/platform-admin.ts";
import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { applicationRateLimits } from "../_shared/app/config/rate-limits.ts";
import { consumeRequestRateLimit } from "../_shared/app/rate-limit/mod.ts";
import { resolveRequestClientIp } from "../_shared/app/client-ip.ts";
import { json } from "../_shared/app/http.ts";
import { ResponseError } from "../_shared/errors.ts";
import { serializeError } from "../_shared/modules/logger/mod.ts";

const audienceSchema = z.enum(["public", "organizer"]);

export const handlePlatformConfigRequest = createEdgeHandler(
  {
    name: "platform-config",
    method: "GET",
    auth: "none",
    serviceClient: true,
    onError: ({ req, logger, error }) => {
      if (error instanceof ResponseError) {
        return json(req, { error: error.code }, error.status);
      }
      if (error instanceof z.ZodError) {
        return json(req, { error: "PLATFORM_INVALID_PAYLOAD" }, 400);
      }
      logger.error("platform_config_request_failed", {
        error: serializeError(error),
      });
      return json(req, { error: "UNEXPECTED_ERROR" }, 500);
    },
  },
  async ({ req, serviceClient, logger }) => {
    const path = new URL(req.url).pathname.split("/").filter(Boolean);
    if (path[path.length - 1] !== "platform-config") {
      return json(req, { error: "NOT_FOUND" }, 404);
    }

    const clientIp = await resolveRequestClientIp(req);
    const quota = await consumeRequestRateLimit({
      req, supabase: serviceClient, logger,
      key: clientIp ? `ip:${clientIp.ip}` : "shared:unresolved",
      ...(clientIp ? applicationRateLimits.platformConfigIp : applicationRateLimits.platformConfigFallback),
    });
    if (!quota.allowed) return quota.response;

    const audience = audienceSchema.parse(
      new URL(req.url).searchParams.get("audience") ?? "public",
    );
    const { data, error } = await serviceClient.rpc("platform_public_config", {
      p_audience: audience,
    });
    if (error) throw error;
    return json(req, platformPublicConfigSchema.parse(data));
  },
);

if (import.meta.main) Deno.serve(handlePlatformConfigRequest);
