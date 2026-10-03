import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  memberSchema,
  organizationProfileSchema,
  organizationSchema,
  planLimitsSchema,
  profileSchema,
  subscriptionUISchema,
} from "../../../shared/schemas/organization-data.ts";
import {
  brandingSchema,
  dashboardBootstrapSchema,
} from "../../../shared/schemas/organizations.ts";
import {
  databasePatch,
  dtoColumns,
  dtoRow,
  throwOrganizerDatabaseError,
} from "../_shared/organizer-dto.ts";
import { internal } from "../_shared/errors.ts";

const subscriptionRowSchema = subscriptionUISchema;
const profileRowSchema = profileSchema.omit({ country: true });
const organizationRowSchema = organizationSchema;
const invoiceSchema = dashboardBootstrapSchema.shape.latestOpenInvoice.unwrap()
  .unwrap();
export function createOrganizationsRepository(client: SupabaseClient) {
  async function loadRow<T extends z.ZodRawShape>(
    table: string,
    schema: z.ZodObject<T>,
    key: string,
    value: string,
  ) {
    const { data, error } = await client.from(table).select(dtoColumns(schema))
      .eq(key, value).maybeSingle();
    if (error) throw internal("ORGANIZATION_LOAD_FAILED");
    return data === null ? null : dtoRow(schema, data);
  }
  return {
    async selectedMembership(actorId: string, orgId?: string) {
      let query = client.from("organization_members").select(
        dtoColumns(memberSchema),
      ).eq("user_id", actorId);
      if (orgId) query = query.eq("org_id", orgId);
      const { data, error } = await query.order("created_at", {
        ascending: true,
      }).limit(1).maybeSingle();
      if (error) throw internal("MEMBERSHIP_LOAD_FAILED");
      return data === null ? null : dtoRow(memberSchema, data);
    },
    async bootstrap(
      actorId: string,
      membership: z.infer<typeof memberSchema> | null,
    ) {
      const profile = await loadRow(
        "user_profile",
        profileRowSchema,
        "user_id",
        actorId,
      );
      if (!profile) throw internal("PROFILE_LOAD_FAILED");
      const freeLimits = await loadRow(
        "plan_limits",
        planLimitsSchema,
        "plan",
        "free",
      );
      if (!freeLimits) throw internal("PLAN_LIMITS_LOAD_FAILED");
      if (!membership) {
        return dashboardBootstrapSchema.parse({
          profile,
          membership: null,
          organization: null,
          organizationProfile: null,
          subscription: null,
          latestOpenInvoice: null,
          planLimits: freeLimits,
        });
      }
      const orgId = membership.orgId;
      const organization = await loadRow(
        "organizations",
        organizationRowSchema,
        "id",
        orgId,
      );
      if (!organization) throw internal("ORGANIZATION_LOAD_FAILED");
      // Match the historical SQL masking; never return the billing IBAN here.
      if (organization.bankTransferIban) {
        const iban = organization.bankTransferIban.replace(/\s/g, "")
          .toUpperCase();
        const masked = iban.length < 6
          ? "•".repeat(iban.length)
          : iban.slice(0, 2) + "•".repeat(iban.length - 6) + iban.slice(-4);
        organization.bankTransferIban = masked.match(/.{1,4}/g)?.join(" ") ??
          "";
      }
      const organizationProfile = await loadRow(
        "organization_profile",
        organizationProfileSchema,
        "org_id",
        orgId,
      );
      const subscription = await loadRow(
        "subscriptions",
        subscriptionRowSchema,
        "org_id",
        orgId,
      );
      const planLimits = await loadRow(
        "plan_limits",
        planLimitsSchema,
        "plan",
        organization.plan,
      ) ?? freeLimits;
      const { data, error } = await client.from("invoices").select(
        dtoColumns(invoiceSchema),
      )
        .eq("org_id", orgId).eq("provider", "manual").eq("status", "issued")
        .not("due_at", "is", null).not("payment_reference", "is", null)
        .order("issued_at", { ascending: false }).order("id", {
          ascending: false,
        }).limit(1).maybeSingle();
      if (error) throw internal("INVOICE_LOAD_FAILED");
      return dashboardBootstrapSchema.parse({
        profile,
        membership,
        organization,
        organizationProfile,
        subscription,
        planLimits,
        latestOpenInvoice: data === null ? null : dtoRow(invoiceSchema, data),
      });
    },
    async updateProfile(actorId: string, patch: object) {
      const { data, error } = await client.from("user_profile").update(
        databasePatch(patch),
      )
        .eq("user_id", actorId).select(dtoColumns(profileRowSchema)).single();
      if (error) throwOrganizerDatabaseError(error);
      return dtoRow(profileRowSchema, data);
    },
    async updateBranding(orgId: string, patch: object) {
      const { data, error } = await client.from("organization_profile").update(
        databasePatch(patch),
      )
        .eq("org_id", orgId).select(dtoColumns(brandingSchema)).single();
      if (error) throwOrganizerDatabaseError(error);
      return dtoRow(brandingSchema, data);
    },
    async transaction(
      name:
        | "organizer_create_organization"
        | "organizer_update_organization"
        | "organizer_update_seller_identity"
        | "organizer_accept_platform_agreements",
      args: Record<string, unknown>,
    ): Promise<unknown> {
      const { data, error } = await client.rpc(name, args);
      if (error) throwOrganizerDatabaseError(error);
      return data;
    },
  };
}
