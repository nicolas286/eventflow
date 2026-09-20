import type { SupabaseClient } from "@supabase/supabase-js";
import { internal, ResponseError } from "../../_shared/errors.ts";

export async function issueFreeOrderTicketsOrThrow(admin: SupabaseClient, orderId: string) {
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
export async function getEventPaymentContextOrThrow(admin: SupabaseClient, eventId: string) {
  const { data, error } = await admin.from("events").select("org_id, title").eq(
    "id",
    eventId,
  ).maybeSingle();
  if (error || !data?.org_id) {
    throw new ResponseError(404, "EVENT_NOT_FOUND");
  }
  return {
    orgId: data.org_id,
    eventTitle: data.title ?? null,
  };
}
export async function getOrgPlanOrThrow(admin: SupabaseClient, orgId: string) {
  const { data, error } = await admin.from("organizations").select("plan").eq(
    "id",
    orgId,
  ).maybeSingle();
  if (error) {
    throw internal("ORG_PLAN_LOAD_FAILED");
  }
  return String(data?.plan ?? "free").trim().toLowerCase();
}
