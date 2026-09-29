import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./OrganizationPanel.desktop.css";
import "./OrganizationPanel.mobile.css";

import { Button, Input, Select, Badge } from "@ui/components";
import { MarkdownRichTextarea } from "@shared/ui/components/inputs/MarkdownRichTextArea";

import { supabase } from "@shared/gateways/supabase/supabaseClient";
import { useSaveOrgInfo } from "../../hooks/useSaveOrgInfo";
import { useStripeConnect } from "@app/modules/admin/payments/hooks/useStripeConnect";
import { useSavePaymentSettings } from "../../hooks/useSavePaymentSettings";
import type { Organization } from "@shared/models/db/db.organization.schema";
import type { OrganizationProfile } from "@shared/models/db/db.organizationProfile.schema";

type Props = {
  orgId: string;
  orgInfo: Organization | null;
  orgProfile: OrganizationProfile | null;
  stripeConnectAllowed: boolean;
  onSaved: () => Promise<void>;
};

type Form = {
  type: NonNullable<Organization["type"]>;
  name: string;
  status: NonNullable<Organization["status"]>;
  description: string;
  publicEmail: string;
  phone: string;
  website: string;

  // ✅ NEW: nullable (vide = null)
  emailReminderDaysBefore: number | null;
};

type PaymentForm = {
  provider: "stripe" | "bank_transfer";
  beneficiary: string;
  iban: string;
};

const emptyForm: Form = {
  type: "association",
  name: "",
  status: "active",
  description: "",
  publicEmail: "",
  phone: "",
  website: "",
  emailReminderDaysBefore: null,
};

function toForm(
  o: Organization | null,
  profile: OrganizationProfile | null,
): Form {
  if (!o || !profile) return emptyForm;

  return {
    type: o.type ?? emptyForm.type,
    name: o.name ?? "",
    status: o.status ?? emptyForm.status,
    description: profile.description ?? "",
    publicEmail: profile.publicEmail ?? "",
    phone: profile.phone ?? "",
    website: profile.website ?? "",
    emailReminderDaysBefore: profile.emailReminderDaysBefore ?? null,
  };
}

function prettyPaymentLabel(s: Organization["paymentsStatus"]) {
  if (s === "not_connected") return "Non connecté";
  if (s === "pending") return "En attente";
  if (s === "connected") return "Connecté";
  if (s === "revoked") return "Révoqué";
  return s;
}

/** ✅ helper : string input -> number|null (>=0) */
function parseNullableNonNegativeInt(v: string): number | null {
  const t = String(v ?? "").trim();
  if (!t) return null; // vide => null
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 0) return 0;
  return i;
}

export default function StructurePanel({
  orgId,
  orgInfo,
  orgProfile,
  stripeConnectAllowed,
  onSaved,
}: Props) {
  const location = useLocation();
  const navigate = useNavigate();

  const { loading, error, updated, saveOrgInfo, reset, hasChanges } =
    useSaveOrgInfo({ supabase });

  const stripeConnect = useStripeConnect({ supabase });
  const paymentSettings = useSavePaymentSettings({ supabase });
  const stripeReady = Boolean(
    orgInfo?.stripeConnectedAccountId &&
    orgInfo.stripeDetailsSubmitted &&
    orgInfo.stripeChargesEnabled &&
    orgInfo.stripePayoutsEnabled,
  );
  const stripeStatus: Organization["paymentsStatus"] = stripeReady
    ? "connected"
    : orgInfo?.stripeConnectedAccountId
      ? "pending"
      : "not_connected";

  // ✅ initial dépend de org (pas juste orgId)
  const initial = useMemo<Form>(
    () => toForm(orgInfo, orgProfile),
    [orgInfo, orgProfile],
  );

  // form local (on n’édite pas org directement tant que pas save)
  const [form, setForm] = useState<Form>(initial);

  const initialPaymentForm = useMemo<PaymentForm>(
    () => ({
      provider:
        stripeConnectAllowed && orgInfo?.paymentsProvider === "stripe"
          ? "stripe"
          : "bank_transfer",
      beneficiary: orgInfo?.bankTransferBeneficiary ?? "",
      iban: orgInfo?.bankTransferIban ?? "",
    }),
    [orgInfo, stripeConnectAllowed],
  );
  const [paymentForm, setPaymentForm] =
    useState<PaymentForm>(initialPaymentForm);
  const [hasStoredBankTransferIban, setHasStoredBankTransferIban] = useState(
    Boolean(orgInfo?.bankTransferIban),
  );
  const [paymentDetailsRevealed, setPaymentDetailsRevealed] = useState(
    !hasStoredBankTransferIban,
  );

  // resync quand bootstrap/refetch modifie org
  useEffect(() => {
    setForm(initial);
  }, [initial]);

  useEffect(() => {
    setPaymentForm(initialPaymentForm);
    setHasStoredBankTransferIban(Boolean(orgInfo?.bankTransferIban));
    setPaymentDetailsRevealed(!orgInfo?.bankTransferIban);
  }, [initialPaymentForm, orgInfo?.bankTransferIban]);

  const dirty = hasChanges(initial, form);
  const paymentDirty =
    paymentForm.provider !== initialPaymentForm.provider ||
    paymentForm.beneficiary.trim() !== initialPaymentForm.beneficiary.trim() ||
    paymentForm.iban.replace(/\s+/g, "").toUpperCase() !==
      initialPaymentForm.iban.replace(/\s+/g, "").toUpperCase();
  const bankTransferReady = Boolean(
    paymentForm.beneficiary.trim() && paymentForm.iban.trim(),
  );

  const effectiveSlug = useMemo(() => {
    return updated?.profile?.slug ?? orgProfile?.slug ?? "";
  }, [updated?.profile?.slug, orgProfile?.slug]);

  const [connectFlash, setConnectFlash] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    const stripeReturn = qs.get("stripe_connect");
    if (!stripeReturn || !stripeConnectAllowed) return;

    async function handleStripeReturn() {
      if (stripeReturn === "refresh") {
        const url = await stripeConnect.start(orgId);
        if (url) window.location.assign(url);
        return;
      }

      const status = await stripeConnect.refreshStatus(orgId);
      if (status) {
        setConnectFlash({
          ok: status.status === "connected",
          message:
            status.status === "connected"
              ? "Stripe est prêt à encaisser et verser les fonds."
              : "Onboarding Stripe reçu, mais les paiements ou versements ne sont pas encore activés.",
        });
        await onSaved();
      }

      qs.delete("stripe_connect");
      navigate(
        {
          pathname: location.pathname,
          search: qs.toString() ? `?${qs.toString()}` : "",
        },
        { replace: true },
      );
    }

    void handleStripeReturn();
    // The return marker must be handled once; hook methods are intentionally not dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    location.search,
    location.pathname,
    navigate,
    orgId,
    stripeConnectAllowed,
  ]);

  /* -------- actions -------- */

  async function handleSave() {
    reset();

    const res = await saveOrgInfo({
      orgId,
      initial,
      current: form,
    });

    if (!res) return;

    // ✅ refresh bootstrap
    await onSaved();

    // ✅ resync immédiat avec réponse RPC
    setForm({
      type: res.type as Form["type"],
      name: res.name ?? "",
      status: res.status as Form["status"],
      description: res.profile.description ?? "",
      publicEmail: res.profile.publicEmail ?? "",
      phone: res.profile.phone ?? "",
      website: res.profile.website ?? "",

      // ✅ NEW
      emailReminderDaysBefore:
        typeof res.profile.emailReminderDaysBefore === "number"
          ? Math.max(0, res.profile.emailReminderDaysBefore)
          : null,
    });
  }

  async function handleStripeConnect() {
    setConnectFlash(null);
    const url = await stripeConnect.start(orgId);
    if (url) window.location.assign(url);
  }

  async function handlePaymentSettingsSave() {
    if (
      paymentForm.provider === "bank_transfer" &&
      hasStoredBankTransferIban &&
      !paymentDetailsRevealed
    ) {
      return;
    }

    paymentSettings.reset();
    const result = await paymentSettings.save({
      orgId,
      paymentsProvider: paymentForm.provider,
      bankTransferBeneficiary:
        paymentForm.provider === "bank_transfer"
          ? paymentForm.beneficiary || null
          : null,
      bankTransferIban:
        paymentForm.provider === "bank_transfer"
          ? paymentForm.iban || null
          : null,
    });
    if (!result) return;

    setPaymentForm({
      provider: result.paymentsProvider,
      beneficiary: result.bankTransferBeneficiary ?? "",
      iban: result.bankTransferIbanMasked ?? "",
    });
    setHasStoredBankTransferIban(Boolean(result.bankTransferIbanMasked));
    setPaymentDetailsRevealed(false);
    await onSaved();
  }

  async function handleRevealPaymentSettings() {
    paymentSettings.reset();
    const result = await paymentSettings.read(orgId);
    if (!result) return;

    setPaymentForm({
      provider: result.paymentsProvider,
      beneficiary: result.bankTransferBeneficiary ?? "",
      iban: result.bankTransferIban ?? "",
    });
    setPaymentDetailsRevealed(true);
  }

  /* -------- render -------- */

  return (
    <div className="structurePanel">
      <div className="structurePanel__grid2">
        {/* ---------------- Organisation ---------------- */}
        <div className="structurePanel__block">
          <div className="structurePanel__labelRow">
            <div>
              <div className="structurePanel__label">Organisation</div>
              <div className="structurePanel__hint">
                Le nom impacte le slug public. Si vous changez le nom, l’URL
                publique change.
              </div>
            </div>

            <Badge
              tone={dirty ? "warn" : "info"}
              label={dirty ? "Modifs" : "OK"}
            />
          </div>

          <div className="structurePanel__field">
            <div className="structurePanel__fieldLabel">Type</div>
            <Select
              value={form.type}
              onChange={(e) =>
                setForm((s) => ({ ...s, type: e.target.value as Form["type"] }))
              }
            >
              <option value="association">Association</option>
              <option value="person">Personne</option>
            </Select>
          </div>

          <div className="structurePanel__field">
            <Input
              label="Nom"
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              placeholder="Nom de l’organisation"
            />
            <div className="structurePanel__help">
              Slug :{" "}
              <span className="structurePanel__mono">
                {effectiveSlug || "—"}
              </span>
            </div>
          </div>
        </div>

        {/* ---------------- Infos publiques ---------------- */}
        <div className="structurePanel__block">
          <div className="structurePanel__labelRow">
            <div>
              <div className="structurePanel__label">Infos publiques</div>
              <div className="structurePanel__hint">
                Affichées sur les pages publiques si tu les utilises (contact,
                event page, etc.)
              </div>
            </div>
          </div>

          <div className="structurePanel__field">
            <MarkdownRichTextarea
              label="Description"
              value={form.description}
              onChange={(next: string) =>
                setForm((s) => ({ ...s, description: next }))
              }
            />
          </div>

          <div className="structurePanel__grid2Inner">
            <Input
              label="Email public"
              value={form.publicEmail}
              onChange={(e) =>
                setForm((s) => ({ ...s, publicEmail: e.target.value }))
              }
              placeholder="contact@..."
            />

            <Input
              label="Téléphone"
              value={form.phone}
              onChange={(e) =>
                setForm((s) => ({ ...s, phone: e.target.value }))
              }
              placeholder="+32 ..."
            />
          </div>

          <div className="structurePanel__field">
            <Input
              label="Site web"
              value={form.website}
              onChange={(e) =>
                setForm((s) => ({ ...s, website: e.target.value }))
              }
              placeholder="https://..."
            />
          </div>

          {/* ✅ NEW: rappel email */}
          <div className="structurePanel__field">
            <Input
              label="Rappel email (jours avant l’événement)"
              type="number"
              inputMode="numeric"
              min={0}
              value={
                form.emailReminderDaysBefore === null
                  ? ""
                  : String(form.emailReminderDaysBefore)
              }
              onChange={(e) =>
                setForm((s) => ({
                  ...s,
                  emailReminderDaysBefore: parseNullableNonNegativeInt(
                    e.target.value,
                  ),
                }))
              }
              placeholder="ex: 3 (laisser vide pour désactiver)"
            />
            <div className="structurePanel__help">
              Vide = aucun rappel automatique. 0 = rappel le jour même.
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- Payment providers ---------------- */}
      <div className="structurePanel__block">
        <div className="structurePanel__labelRow">
          <div>
            <div className="structurePanel__label">
              Paiements des événements
            </div>
            <div className="structurePanel__hint">
              {stripeConnectAllowed
                ? "Choisissez Stripe Connect pour un encaissement immédiat ou le virement bancaire pour confirmer vous-même les paiements reçus."
                : "Renseignez vos coordonnées bancaires pour recevoir les paiements par virement et confirmer vous-même les montants reçus."}
            </div>
          </div>

          <div className="structurePanel__chip">
            <span className="structurePanel__chipLabel">Fournisseur</span>
            <span className="structurePanel__chipValue">
              {paymentForm.provider === "stripe" ? "Stripe" : "Virement"}
            </span>
            <span className="structurePanel__chipLabel">Statut</span>
            <span className="structurePanel__chipValue">
              {paymentForm.provider === "stripe"
                ? orgInfo
                  ? prettyPaymentLabel(stripeStatus)
                  : "—"
                : bankTransferReady
                  ? "Configuré"
                  : "À compléter"}
            </span>

            {(
              paymentForm.provider === "stripe"
                ? stripeReady
                : bankTransferReady
            ) ? (
              <span className="structurePanel__chipOk">prêt</span>
            ) : (
              <span className="structurePanel__chipWarn">non prêt</span>
            )}
          </div>
        </div>

        <div className="structurePanel__field">
          <div className="structurePanel__fieldLabel">Mode de paiement</div>
          <Select
            value={paymentForm.provider}
            onChange={(event) =>
              setPaymentForm((current) => ({
                ...current,
                provider: event.target.value as PaymentForm["provider"],
              }))
            }
          >
            {stripeConnectAllowed ? (
              <option value="stripe">Stripe Connect (Bancontact)</option>
            ) : null}
            <option value="bank_transfer">Virement bancaire</option>
          </Select>
        </div>

        {paymentForm.provider === "bank_transfer" ? (
          <>
            <div className="structurePanel__grid2Inner">
              <Input
                label="Nom du bénéficiaire"
                value={paymentForm.beneficiary}
                readOnly={hasStoredBankTransferIban && !paymentDetailsRevealed}
                onChange={(event) =>
                  setPaymentForm((current) => ({
                    ...current,
                    beneficiary: event.target.value,
                  }))
                }
                placeholder="Nom ou raison sociale"
              />
              <Input
                label="IBAN"
                value={paymentForm.iban}
                readOnly={hasStoredBankTransferIban && !paymentDetailsRevealed}
                onChange={(event) =>
                  setPaymentForm((current) => ({
                    ...current,
                    iban: event.target.value.toUpperCase(),
                  }))
                }
                placeholder="BE00 0000 0000 0000"
              />
            </div>
            {hasStoredBankTransferIban && !paymentDetailsRevealed ? (
              <div className="structurePanel__actions">
                <Button
                  variant="secondary"
                  onClick={handleRevealPaymentSettings}
                  disabled={paymentSettings.loading}
                >
                  Modifier les coordonnées bancaires
                </Button>
              </div>
            ) : null}
          </>
        ) : null}

        <div className="structurePanel__actionsBar">
          <div className="structurePanel__actions">
            {stripeConnectAllowed && paymentForm.provider === "stripe" ? (
              <Button
                variant="secondary"
                label={
                  stripeConnect.loading ? "Ouverture…" : "Configurer Stripe"
                }
                onClick={handleStripeConnect}
                disabled={stripeConnect.loading}
              />
            ) : null}
            <Button
              variant="primary"
              label={
                paymentSettings.loading
                  ? "Enregistrement…"
                  : "Enregistrer le mode"
              }
              onClick={handlePaymentSettingsSave}
              disabled={
                !paymentDirty ||
                paymentSettings.loading ||
                (paymentForm.provider === "bank_transfer" &&
                  hasStoredBankTransferIban &&
                  !paymentDetailsRevealed)
              }
            />
          </div>

          <div className="structurePanel__status">
            {stripeConnectAllowed && stripeConnect.error ? (
              <div className="structurePanel__error">{stripeConnect.error}</div>
            ) : null}
            {connectFlash ? (
              <div
                className={
                  connectFlash.ok
                    ? "structurePanel__success"
                    : "structurePanel__error"
                }
              >
                {connectFlash.message}
              </div>
            ) : null}
            {paymentSettings.error ? (
              <div className="structurePanel__error">
                {paymentSettings.error}
              </div>
            ) : null}
            {paymentSettings.updated ? (
              <div className="structurePanel__success">
                Mode de paiement enregistré
              </div>
            ) : null}
            {paymentSettings.updated?.bankTransferIbanChanged &&
            !paymentSettings.updated.securityEmailSent ? (
              <div className="structurePanel__error">
                Les coordonnées ont été enregistrées, mais l’e-mail de sécurité n’a pas pu être envoyé.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ---------------- Save bar ---------------- */}
      <div className="structurePanel__actionsBar">
        <div className="structurePanel__status">
          {error ? <div className="structurePanel__error">{error}</div> : null}
          {updated ? (
            <div className="structurePanel__success">Infos sauvegardées</div>
          ) : null}
        </div>

        <div className="structurePanel__actions">
          <Button
            variant="primary"
            label={loading ? "Enregistrement…" : "Enregistrer"}
            onClick={handleSave}
            disabled={!dirty || loading}
          />
        </div>
      </div>
    </div>
  );
}
