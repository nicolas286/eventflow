import type { SupabaseClient } from "@supabase/supabase-js";
import {
  organizationBillingPatchSchema,
  organizationBillingSchema,
} from "../../../shared/schemas/organization-billing.ts";
import {
  databasePatch,
  dtoColumns,
  dtoRow,
  throwOrganizerDatabaseError,
} from "../_shared/organizer-dto.ts";
import { internal } from "../_shared/errors.ts";
import { z } from "zod";

export async function getOrganizationBilling(
  client: SupabaseClient,
  orgId: string,
) {
  const { data, error } = await client.from("organization_billing")
    .select(dtoColumns(organizationBillingSchema)).eq("org_id", orgId)
    .maybeSingle();
  if (error) throw internal("BILLING_LOAD_FAILED");
  return data === null ? null : dtoRow(organizationBillingSchema, data);
}

export async function updateOrganizationBilling(
  client: SupabaseClient,
  actorId: string,
  input: z.infer<typeof organizationBillingPatchSchema>,
) {
  const { data, error } = await client.rpc(
    "organizer_upsert_organization_billing",
    {
      p_actor_id: actorId,
      p_input: databasePatch(input),
    },
  );
  if (error) throwOrganizerDatabaseError(error);
  return organizationBillingSchema.parse(data);
}
