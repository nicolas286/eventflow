import {
  maskIban,
  organizationPaymentSettingsRequestSchema,
  organizationPaymentSettingsResultSchema,
} from "../../../shared/schemas/bank-transfer.ts";
import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import {
  BodyTooLargeError,
  readLimitedJson,
} from "../_shared/app/request-body.ts";
import {
  badRequest,
  forbidden,
  internal,
  ResponseError,
} from "../_shared/errors.ts";
import { sendEmailOrThrow } from "../_shared/app/email.ts";
import { escapeHtml } from "../_shared/text.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_BODY_BYTES = 65_536;

async function assertOrganizationManager(
  serviceClient: SupabaseClient,
  orgId: string,
  userId: string,
) {
  const { data, error } = await serviceClient
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw internal("MEMBERSHIP_LOAD_FAILED");
  if (!data || !["owner", "admin"].includes(data.role)) {
    throw forbidden("FORBIDDEN");
  }
}

function securityEmailHtml(input: {
  organizationName: string;
  oldIbanMasked: string | null;
  newIbanMasked: string | null;
  changedAt: string;
}) {
  return `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.6;color:#111">
  <h2>Coordonnées bancaires modifiées</h2>
  <p>Les coordonnées bancaires de <strong>${
    escapeHtml(input.organizationName)
  }</strong> ont été modifiées le ${escapeHtml(input.changedAt)}.</p>
  <p><strong>Ancien IBAN :</strong> ${
    escapeHtml(input.oldIbanMasked ?? "Non renseigné")
  }</p>
  <p><strong>Nouvel IBAN :</strong> ${
    escapeHtml(input.newIbanMasked ?? "Non renseigné")
  }</p>
  <p>Si vous n’êtes pas à l’origine de cette modification, vérifiez immédiatement les accès à votre organisation.</p>
</div>`;
}

export const handleOrganizationPaymentSettingsRequest = createEdgeHandler(
  {
    name: "organization-payment-settings",
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
        return json(req, { error: error.code }, error.status);
      }
      logger.error("organization_payment_settings_failed", {
        code: "UNEXPECTED_ERROR",
      });
      return json(req, { error: "UNEXPECTED_ERROR" }, 500);
    },
  },
  async ({ req, user, supabase, serviceClient, logger }) => {
    const parsed = organizationPaymentSettingsRequestSchema.safeParse(
      await readLimitedJson(req, MAX_BODY_BYTES),
    );
    if (!parsed.success) throw badRequest("INVALID_PAYMENT_SETTINGS");

    const input = parsed.data;
    await assertOrganizationManager(serviceClient, input.orgId, user.id);

    if (input.action === "read") {
      const { data, error } = await serviceClient
        .from("organizations")
        .select(
          "id, payments_provider, bank_transfer_beneficiary, bank_transfer_iban, organization_profile(sales_terms, sales_terms_version, sales_terms_accepted_version, sales_terms_accepted_at, sales_terms_accepted_by, seller_legal_name, seller_address, seller_business_number, seller_type, phone, connect_terms_accepted_version, dpa_accepted_version, platform_terms_accepted_version, privacy_accepted_version, platform_agreements_accepted_at)",
        )
        .eq("id", input.orgId)
        .maybeSingle();

      if (error || !data) throw internal("PAYMENT_SETTINGS_LOAD_FAILED");

      const profile = Array.isArray(data.organization_profile)
        ? data.organization_profile[0]
        : data.organization_profile;

      return json(
        req,
        organizationPaymentSettingsResultSchema.parse({
          orgId: data.id,
          paymentsProvider: data.payments_provider,
          bankTransferBeneficiary: data.bank_transfer_beneficiary,
          bankTransferIban: data.bank_transfer_iban,
          bankTransferIbanMasked: data.bank_transfer_iban
            ? maskIban(data.bank_transfer_iban)
            : null,
          sellerLegalName: profile?.seller_legal_name ?? null,
          sellerAddress: profile?.seller_address ?? null,
          sellerBusinessNumber: profile?.seller_business_number ?? null,
          sellerType: profile?.seller_type ?? null,
          sellerPhone: profile?.phone ?? null,
          connectTermsAcceptedVersion:
            profile?.connect_terms_accepted_version ?? null,
          dpaAcceptedVersion: profile?.dpa_accepted_version ?? null,
          platformTermsAcceptedVersion:
            profile?.platform_terms_accepted_version ?? null,
          privacyAcceptedVersion: profile?.privacy_accepted_version ?? null,
          platformAgreementsAcceptedAt:
            profile?.platform_agreements_accepted_at ?? null,
          salesTerms: profile?.sales_terms ?? null,
          salesTermsVersion: profile?.sales_terms_version ?? null,
          salesTermsAcceptedVersion: profile?.sales_terms_accepted_version ??
            null,
          salesTermsAcceptedAt: profile?.sales_terms_accepted_at ?? null,
          salesTermsAcceptedBy: profile?.sales_terms_accepted_by ?? null,
          salesTermsCurrent: Boolean(
            profile?.sales_terms_accepted_at &&
              profile?.sales_terms_version &&
              profile.sales_terms_accepted_version ===
                profile.sales_terms_version,
          ),
        }),
      );
    }

    if (input.action === "accept_terms") {
      const { data: accepted, error: acceptError } = await supabase.rpc(
        "accept_organization_sales_terms",
        {
          p_org_id: input.orgId,
          p_sales_terms: input.salesTerms,
        },
      );

      if (acceptError || !accepted) {
        if (acceptError?.message?.includes("FORBIDDEN")) {
          throw forbidden("FORBIDDEN");
        }
        if (acceptError?.message?.includes("valid public organizer email")) {
          throw badRequest("ORGANIZER_PUBLIC_EMAIL_REQUIRED");
        }
        if (acceptError?.message?.includes("invalid organizer sales terms")) {
          throw badRequest("ORGANIZER_SALES_TERMS_INVALID");
        }
        throw internal("ORGANIZER_TERMS_ACCEPTANCE_FAILED");
      }

      return json(req, organizationPaymentSettingsResultSchema.parse(accepted));
    }

    const { data: updated, error: updateError } = await supabase.rpc(
      "update_organization_payment_settings",
      {
        p_org_id: input.orgId,
        p_provider: input.paymentsProvider,
        p_bank_transfer_beneficiary: input.bankTransferBeneficiary,
        p_bank_transfer_iban: input.bankTransferIban,
      },
    );

    if (updateError || !updated) {
      if (updateError?.message?.includes("invalid IBAN")) {
        throw badRequest("INVALID_IBAN");
      }
      if (updateError?.message?.includes("FORBIDDEN")) {
        throw forbidden("FORBIDDEN");
      }
      throw internal("PAYMENT_SETTINGS_UPDATE_FAILED");
    }

    let securityEmailSent = false;
    if (updated.bankTransferIbanChanged) {
      const [{ data: organization }, { data: profile }, { data: billing }] =
        await Promise.all([
          serviceClient
            .from("organizations")
            .select("name")
            .eq("id", input.orgId)
            .maybeSingle(),
          serviceClient
            .from("organization_profile")
            .select("public_email")
            .eq("org_id", input.orgId)
            .maybeSingle(),
          serviceClient
            .from("organization_billing")
            .select("billing_email")
            .eq("org_id", input.orgId)
            .maybeSingle(),
        ]);

      const recipients = Array.from(
        new Set(
          [
            user.email?.trim().toLowerCase(),
            profile?.public_email?.trim().toLowerCase(),
            billing?.billing_email?.trim().toLowerCase(),
          ].filter((value): value is string => Boolean(value)),
        ),
      );

      if (recipients.length > 0) {
        try {
          await sendEmailOrThrow({
            to: recipients,
            subject: "Sécurité — coordonnées bancaires modifiées",
            html: securityEmailHtml({
              organizationName: organization?.name ?? "votre organisation",
              oldIbanMasked: updated.oldBankTransferIbanMasked ?? null,
              newIbanMasked: updated.bankTransferIbanMasked ?? null,
              changedAt: new Intl.DateTimeFormat("fr-BE", {
                dateStyle: "long",
                timeStyle: "short",
                timeZone: "Europe/Brussels",
              }).format(new Date()),
            }),
            tags: {
              kind: "bank_account_security_notice",
              orgId: input.orgId,
              auditId: updated.auditId ?? "unknown",
            },
            idempotencyKey: updated.auditId
              ? `bank-account-security:${updated.auditId}`
              : undefined,
          });
          securityEmailSent = true;
        } catch {
          // Deliberately omit the error object: provider errors must never make
          // the IBAN or the email body observable in application logs.
          logger.error("bank_account_security_email_failed", {
            orgId: input.orgId,
            auditId: updated.auditId ?? null,
          });
        }
      }
    }

    return json(
      req,
      organizationPaymentSettingsResultSchema.parse({
        ...updated,
        securityEmailSent,
      }),
    );
  },
);

if (import.meta.main) Deno.serve(handleOrganizationPaymentSettingsRequest);
