import { z } from "zod";

const fields: Readonly<Record<string, string>> = {
  created_at: "createdAt", updated_at: "updatedAt", created_by: "createdBy",
  org_id: "orgId", organization_name: "organizationName", owner_email: "ownerEmail",
  events_count: "eventsCount", orders_count: "ordersCount", paid_cents: "paidCents",
  plan_started_at: "planStartedAt", plan_expires_at: "planExpiresAt",
  payments_provider: "paymentsProvider", payments_status: "paymentsStatus",
  payments_live_ready: "paymentsLiveReady", payments_account_updated_at: "paymentsAccountUpdatedAt",
  is_published: "isPublished", starts_at: "startsAt", current_period_start: "currentPeriodStart",
  current_period_end: "currentPeriodEnd", total_cents: "totalCents", issued_at: "issuedAt",
  due_at: "dueAt", paid_at: "paidAt", invoice_id: "invoiceId", error_code: "errorCode",
  error_message: "errorMessage", actor_user_id: "actorUserId", actor_session_id: "actorSessionId",
  actor_email: "actorEmail", target_type: "targetType", target_id: "targetId",
};
const recordSchema = z.record(z.string(), z.unknown());
function row(value: unknown) {
  return Object.fromEntries(Object.entries(recordSchema.parse(value)).map(([key, entry]) => [fields[key] ?? key, entry]));
}
/** Only documented SQL row collections are mapped. Metadata remains opaque. */
export function mapPlatformTransport(name: string, resource: unknown, value: unknown): unknown {
  if (name !== "platform_admin_read") return value;
  const result = recordSchema.parse(value);
  const collections = resource === "organizations" || resource === "audit" ? ["items"]
    : resource === "organization" ? ["recentEvents"]
    : resource === "finance" ? ["subscriptions", "invoices"]
    : resource === "operations" ? ["staleOrders", "emailFailures", "invoiceFailures", "paymentConnections"] : [];
  return { ...result, ...Object.fromEntries(collections.map((key) => [key, z.array(z.unknown()).parse(result[key]).map(row)])) };
}
