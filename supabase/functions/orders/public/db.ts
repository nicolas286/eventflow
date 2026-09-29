import type { SupabaseClient } from "@supabase/supabase-js";
import { internal, ResponseError } from "../../_shared/errors.ts";
import { EVENTFLOW_BUYER_TERMS_VERSION } from "../../../../shared/schemas/organization-sales-terms.ts";
import type { RegisterItemInput } from "./types.ts";

export async function issueFreeOrderTicketsOrThrow(
  admin: SupabaseClient,
  orderId: string,
) {
  const { data, error } = await admin.rpc("issue_order_tickets", {
    p_order_id: orderId,
  });
  if (error) {
    console.error("[register] issue_order_tickets failed", error);
    throw internal("TICKETS_ISSUE_FAILED", {
      data,
      error,
    });
  }
}
export async function getEventPaymentContextOrThrow(
  admin: SupabaseClient,
  eventId: string,
) {
  const { data, error } = await admin
    .from("events")
    .select("org_id, title")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !data?.org_id) {
    throw new ResponseError(404, "EVENT_NOT_FOUND");
  }
  return {
    orgId: data.org_id,
    eventTitle: data.title ?? null,
  };
}

export async function selectedItemsIncludePaidProductOrThrow(
  admin: SupabaseClient,
  eventId: string,
  items: RegisterItemInput[],
) {
  const productIds = [...new Set(items.map((item) => item.eventProductId))];
  const { data, error } = await admin
    .from("event_products")
    .select("id, price_cents")
    .eq("event_id", eventId)
    .in("id", productIds);

  if (error) throw internal("EVENT_PRODUCTS_LOAD_FAILED");
  return (data ?? []).some((product) => Number(product.price_cents ?? 0) > 0);
}

export async function recordOrderTermsAcceptanceOrThrow(
  admin: SupabaseClient,
  orderId: string,
) {
  const { error } = await admin.rpc("record_order_terms_acceptance", {
    p_order_id: orderId,
    p_platform_terms_version: EVENTFLOW_BUYER_TERMS_VERSION,
  });

  if (error) throw internal("ORDER_TERMS_ACCEPTANCE_FAILED");
}
export async function getOrgPlanOrThrow(admin: SupabaseClient, orgId: string) {
  const { data, error } = await admin
    .from("organizations")
    .select("plan")
    .eq("id", orgId)
    .maybeSingle();
  if (error) {
    throw internal("ORG_PLAN_LOAD_FAILED");
  }
  return String(data?.plan ?? "free")
    .trim()
    .toLowerCase();
}
