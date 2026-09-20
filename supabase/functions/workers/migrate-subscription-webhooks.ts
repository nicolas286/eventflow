import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { migrateSubscriptionWebhooksSchema } from "../../../shared/schemas/subscription-webhook-migration.ts";
import { assertInternalEdgeAuthentication } from "../_shared/app/internal-edge/mod.ts";
import {
  BodyTooLargeError,
  readLimitedJson,
} from "../_shared/app/request-body.ts";
import { json } from "../_shared/app/http.ts";
import { ResponseError } from "../_shared/errors.ts";

const STAGING_URL = "https://cpcmcxerrsnnjncrhldr.supabase.co";
const API = "https://api.mollie.com/v2";
const mappingSchema = z.object({
  org_id: z.uuid(),
  mollie_customer_id: z.string().regex(/^cst_[a-zA-Z0-9]+$/),
  mollie_subscription_id: z.string().regex(/^sub_[a-zA-Z0-9]+$/).nullable(),
});
type Mapping = z.infer<typeof mappingSchema>;
const resourceSchema = z.object({
  id: z.string(),
  mode: z.string().optional(),
  status: z.string(),
  webhookUrl: z.string().nullable().optional(),
  customerId: z.string().optional(),
  metadata: z.object({
    org_id: z.string().optional(),
    kind: z.string().optional(),
  }).passthrough().nullable().optional(),
}).passthrough();
const paymentListSchema = z.object({
  _embedded: z.object({ payments: z.array(resourceSchema) }),
  _links: z.object({
    next: z.object({ href: z.string() }).nullable().optional(),
  }).optional(),
});
type Candidate = {
  kind: "subscription" | "payment";
  id: string;
  orgId: string;
  from: string;
  to: string;
  endpoint: string;
  mapping: Mapping;
};
class MigrationError extends Error {
  constructor(readonly code: string, readonly status = 502) {
    super(code);
  }
}

async function mollieRequest(
  key: string,
  url: string,
  patch?: { webhookUrl: string },
): Promise<unknown> {
  const response = await fetch(url, {
    method: patch ? "PATCH" : "GET",
    redirect: "error",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    ...(patch ? { body: JSON.stringify(patch) } : {}),
  });
  if (!response.ok) {
    throw new MigrationError(
      `MOLLIE_${patch ? "PATCH" : "GET"}_FAILED_${response.status}`,
    );
  }
  return await response.json();
}

function candidateFor(
  resource: z.infer<typeof resourceSchema>,
  mapping: Mapping,
  kind: Candidate["kind"],
): Candidate | null {
  if (resource.mode && resource.mode !== "test") {
    throw new MigrationError("NON_TEST_RESOURCE_REFUSED", 409);
  }
  if (
    resource.customerId && resource.customerId !== mapping.mollie_customer_id
  ) return null;
  if (resource.metadata?.org_id !== mapping.org_id) return null;
  if (kind === "subscription") {
    if (
      resource.id !== mapping.mollie_subscription_id ||
      resource.metadata?.kind !== "platform_subscription"
    ) return null;
    if (!["active", "pending", "suspended"].includes(resource.status)) {
      return null;
    }
  } else {
    if (
      !/^tr_[a-zA-Z0-9]+$/.test(resource.id) ||
      !["open", "pending", "authorized"].includes(resource.status)
    ) return null;
    if (
      !["subscription_first", "platform_subscription"].includes(
        resource.metadata?.kind ?? "",
      )
    ) return null;
  }
  const base = `${STAGING_URL}/functions/v1`;
  const replacements: Record<string, string> = {
    [`${base}/payment-first`]: `${base}/subscriptions/webhooks/first-payment`,
    [`${base}/mollie-subscription-webhook`]:
      `${base}/subscriptions/webhooks/recurring-payment`,
  };
  const from = resource.webhookUrl ?? "";
  const to = replacements[from];
  if (!to) return null;
  if (
    kind === "subscription" && from !== `${base}/mollie-subscription-webhook`
  ) return null;
  return {
    kind,
    id: resource.id,
    orgId: mapping.org_id,
    from,
    to,
    mapping,
    endpoint: kind === "subscription"
      ? `${API}/customers/${mapping.mollie_customer_id}/subscriptions/${resource.id}`
      : `${API}/payments/${resource.id}`,
  };
}

async function inventory(
  admin: SupabaseClient,
  key: string,
): Promise<Candidate[]> {
  const { data, error } = await admin.from("subscriptions")
    .select("org_id,mollie_customer_id,mollie_subscription_id")
    .not("mollie_customer_id", "is", null).limit(501);
  if (error) throw new MigrationError("SUBSCRIPTIONS_INVENTORY_FAILED", 500);
  if ((data?.length ?? 0) > 500) {
    throw new MigrationError("INVENTORY_TOO_LARGE", 409);
  }
  const mappings = z.array(mappingSchema).parse(data ?? []);
  const candidates = new Map<string, Candidate>();
  for (const mapping of mappings) {
    if (mapping.mollie_subscription_id) {
      const resource = resourceSchema.parse(
        await mollieRequest(
          key,
          `${API}/customers/${mapping.mollie_customer_id}/subscriptions/${mapping.mollie_subscription_id}`,
        ),
      );
      const candidate = candidateFor(resource, mapping, "subscription");
      if (candidate) candidates.set(candidate.endpoint, candidate);
    }
    const paymentPath = `/v2/customers/${mapping.mollie_customer_id}/payments`;
    let next: string | null = `https://api.mollie.com${paymentPath}?limit=250`;
    const visited = new Set<string>();
    while (next) {
      const url = new URL(next);
      if (
        url.origin !== "https://api.mollie.com" ||
        url.pathname !== paymentPath || url.username || url.password
      ) throw new MigrationError("UNSAFE_PAGINATION_URL", 409);
      if (visited.has(next) || visited.size >= 20) {
        throw new MigrationError("PAYMENT_INVENTORY_INCOMPLETE", 409);
      }
      visited.add(next);
      const page = paymentListSchema.parse(await mollieRequest(key, next));
      for (const resource of page._embedded.payments) {
        const candidate = candidateFor(resource, mapping, "payment");
        if (candidate) candidates.set(candidate.endpoint, candidate);
      }
      next = page._links?.next?.href ?? null;
    }
  }
  return [...candidates.values()];
}

/** Narrow, staging-only maintenance; never changes payment or subscription terms. */
export async function migrateSubscriptionWebhooks(
  req: Request,
  admin: SupabaseClient,
): Promise<Response> {
  const applied: string[] = [];
  const attempted: string[] = [];
  try {
    if (req.method !== "POST") {
      return json(req, { error: "METHOD_NOT_ALLOWED" }, 405);
    }
    const serviceToken = Deno.env.get("EDGE_SERVICE_TOKEN")?.trim();
    if (!serviceToken) {
      return json(req, { error: "WORKER_NOT_CONFIGURED" }, 500);
    }
    await assertInternalEdgeAuthentication(req, serviceToken);
    if (
      Deno.env.get("APP_ENV") !== "staging" ||
      Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "") !== STAGING_URL
    ) {
      return json(req, { error: "STAGING_ONLY" }, 403);
    }
    const key = Deno.env.get("MOLLIE_API_KEY")?.trim();
    if (!key?.startsWith("test_")) {
      return json(req, { error: "TEST_KEY_REQUIRED" }, 403);
    }
    const parsed = migrateSubscriptionWebhooksSchema.safeParse(
      await readLimitedJson(req),
    );
    if (!parsed.success) return json(req, { error: "INVALID_PAYLOAD" }, 400);
    const candidates = await inventory(admin, key);
    const skippedChanged: string[] = [];
    if (parsed.data.apply) {
      for (const candidate of candidates) {
        // Re-read immediately before PATCH, avoiding stale inventory overwrites.
        const current = resourceSchema.parse(
          await mollieRequest(key, candidate.endpoint),
        );
        const fresh = candidateFor(current, candidate.mapping, candidate.kind);
        if (
          !fresh || fresh.from !== candidate.from || fresh.id !== candidate.id
        ) {
          skippedChanged.push(candidate.id);
          continue;
        }
        attempted.push(candidate.id);
        const updated = resourceSchema.parse(
          await mollieRequest(key, candidate.endpoint, {
            webhookUrl: candidate.to,
          }),
        );
        if (
          updated.webhookUrl !== candidate.to || updated.id !== candidate.id
        ) throw new MigrationError("PATCH_VERIFICATION_FAILED");
        applied.push(candidate.id);
      }
    }
    return json(req, {
      ok: true,
      apply: parsed.data.apply,
      candidates: candidates.map(({ kind, id, orgId, from, to }) => ({
        kind,
        id,
        orgId,
        from,
        to,
      })),
      applied,
      skippedChanged,
    });
  } catch (error) {
    if (error instanceof ResponseError) {
      return json(req, { error: error.code }, error.status);
    }
    if (error instanceof BodyTooLargeError) {
      return json(req, { error: error.message }, 413);
    }
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      return json(
        req,
        { error: "INVALID_MIGRATION_DATA", applied, attempted },
        400,
      );
    }
    return json(req, {
      error: error instanceof MigrationError ? error.code : "MIGRATION_FAILED",
      applied,
      attempted,
    }, error instanceof MigrationError ? error.status : 500);
  }
}
