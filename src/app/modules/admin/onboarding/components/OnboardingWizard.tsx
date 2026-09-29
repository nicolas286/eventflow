import { useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { z } from "zod";

import "./OnboardingWizard.desktop.css";
import "./OnboardingWizard.mobile.css";

import type { AdminOutletContext } from "../../dashboard/components/AdminDashboard";
import { supabase } from "@gateways/supabase/supabaseClient";

import { useSaveAdminProfile } from "../../profile/hooks/useUpdateAdminProfile";
import { useCreateOrganization } from "../hooks/useCreateOrganization";

import type { AdminProfileForm } from "../../profile/schemas/admin.updateAdminProfile.schema";
import type { CreateOrganizationForm } from "../schemas/admin.createOrganization.schema";

import { inferCountryCode } from "@helpers/countries";
import { Button, Input, Badge, Select } from "@ui/components";

import CountrySelect from "@shared/ui/components/inputs/CountrySelect";
import PhoneInput from "@shared/ui/components/inputs/PhoneInput";
import {
  parseE164,
  buildE164,
} from "@shared/ui/components/inputs/countryPhoneData";

import { MessageBox } from "@shared/ui/components/message/MessageBox";
import { useLiveForm } from "@shared/hooks/useLiveZodForm";

type WizardForm = {
  firstName: string;
  lastName: string;

  // UI
  phone: string; // ce que renvoie PhoneInput (parfois national, parfois e164 selon ton composant)
  countryLabel: string;

  // org
  orgType: CreateOrganizationForm["type"];
  orgName: string;
};

function t(v: string) {
  return v.trim();
}
function toNullIfEmpty(v: string): string | null {
  const s = t(v);
  return s ? s : null;
}

// ✅ e164 strict: + puis 7..15 digits (E.164 max 15)
function isValidE164(e164: string) {
  return /^\+\d{7,15}$/.test(e164);
}

/* -------------------- ZOD -------------------- */

const wizardSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(2, "Prénom trop court")
    .max(120, "Prénom trop long"),
  lastName: z
    .string()
    .trim()
    .min(2, "Nom trop court")
    .max(120, "Nom trop long"),

  phone: z
    .string()
    .trim()
    .max(40, "Téléphone trop long")
    .refine(
      (v) => {
        if (!v) return true; // optionnel

        // On reconstruit un E164 “propre” depuis ton parser
        const p = parseE164(v);
        const e164 = buildE164(p.dial || "+32", p.national);

        // ✅ avant tu faisais juste “return !!e164”
        // => "+32ffddd" passait. Là non.
        return isValidE164(e164);
      },
      { message: "Téléphone invalide" },
    ),

  countryLabel: z
    .string()
    .trim()
    .min(1, "Pays requis")
    .max(120, "Pays invalide"),

  orgType: z.enum(["person", "association"], { message: "Type requis" }),
  orgName: z
    .string()
    .trim()
    .min(3, "Nom d’organisation trop court")
    .max(120, "Nom d’organisation trop long"),
});

const step1Keys: (keyof WizardForm)[] = [
  "firstName",
  "lastName",
  "phone",
  "countryLabel",
];

const step1Schema = wizardSchema.pick({
  firstName: true,
  lastName: true,
  phone: true,
  countryLabel: true,
});

const step2Schema = wizardSchema.pick({
  orgType: true,
  orgName: true,
});

export default function OnboardingWizard() {
  const navigate = useNavigate();
  const { bootstrap, refetch } = useOutletContext<AdminOutletContext>();

  const userId = bootstrap?.profile?.userId ?? null;

  const [step, setStep] = useState<1 | 2>(1);

  const saveProfile = useSaveAdminProfile({ supabase });
  const createOrg = useCreateOrganization({ supabase });

  const loading = saveProfile.loading || createOrg.loading;
  const error = saveProfile.error || createOrg.error;

  const live = useLiveForm<WizardForm>(wizardSchema, {
    firstName: "",
    lastName: "",
    phone: "",
    countryLabel: "",
    orgType: "association",
    orgName: "",
  });

  const {
    form,
    fieldErrors,
    handleChange,
    handleBlur,
    shouldShowFieldError,
    touchAll,
    validateAll,
  } = live;

  const canGoNext = useMemo(() => {
    if (step === 1) return step1Schema.safeParse(form).success;
    return step2Schema.safeParse(form).success;
  }, [step, form]);

  function goNext() {
    if (step === 1) {
      // même pattern que vos autres panels
      touchAll(step1Keys);

      // IMPORTANT: touchAll ne valide pas les champs vides tant qu’il n’y a pas eu blur/change
      // donc on force le blur (qui valide) sur les champs du step
      handleBlur("firstName");
      handleBlur("lastName");
      handleBlur("phone");
      handleBlur("countryLabel");

      const ok = step1Schema.safeParse(form).success;
      if (!ok) return;

      setStep(2);
      return;
    }

    onSubmitFinal();
  }

  function goPrev() {
    if (loading) return;
    setStep(1);
  }

  async function onSubmitFinal() {
    if (!userId) return;

    touchAll([
      "firstName",
      "lastName",
      "phone",
      "countryLabel",
      "orgType",
      "orgName",
    ]);

    const parsed = validateAll();
    if (!parsed.ok) return;

    // téléphone => e164 clean (sans espaces)
    const p = parseE164(parsed.data.phone || null);
    const phoneE164 = buildE164(p.dial || "+32", p.national);

    const profileForm: AdminProfileForm = {
      userId,
      firstName: toNullIfEmpty(parsed.data.firstName),
      lastName: toNullIfEmpty(parsed.data.lastName),
      phone: phoneE164 && isValidE164(phoneE164) ? phoneE164 : null,

      addressLine1: null,
      addressLine2: null,
      postalCode: null,
      city: null,

      countryCode: inferCountryCode(parsed.data.countryLabel),
    };

    const saved = await saveProfile.saveAdminProfile({
      userId,
      form: profileForm,
    });
    if (!saved) return;

    const createdOrgId = await createOrg.createOrganization({
      type: parsed.data.orgType,
      name: t(parsed.data.orgName),
    });
    if (!createdOrgId) return;

    await refetch();
    navigate("/admin");
  }

  return (
    <div className="onboardingPage">
      <div className="onboardingCard">
        <aside className="onboardingIntro">
          <span className="onboardingIntro__mark" aria-hidden="true">
            EF
          </span>
          <div>
            <span className="onboardingIntro__eyebrow">Premiers pas</span>
            <h2>Préparons votre espace organisateur.</h2>
            <p>
              Ces informations permettent de personnaliser votre compte et de
              créer votre première organisation.
            </p>
          </div>
          <div className="onboardingIntro__help">
            Vous pourrez compléter l’adresse, l’identité visuelle et les moyens
            de paiement plus tard.
          </div>
        </aside>

        <main className="onboardingContent">
          <div className="onboardingHeader">
            <div>
              <span>Configuration du compte</span>
              <h1>Bienvenue sur Eventflow</h1>
              <p>Deux étapes rapides avant de créer votre premier événement.</p>
            </div>
          </div>

          <ol className="onboardingProgress" aria-label="Progression">
            <li className={step === 1 ? "isActive" : "isComplete"}>
              <span>1</span>
              <div>
                <strong>Votre profil</strong>
                <small>Coordonnées personnelles</small>
              </div>
            </li>
            <li className={step === 2 ? "isActive" : ""}>
              <span>2</span>
              <div>
                <strong>Organisation</strong>
                <small>Nom et structure</small>
              </div>
            </li>
          </ol>

          {error ? <div className="onboardingError">{error}</div> : null}

          {/* -------------------- STEP 1 -------------------- */}
          {step === 1 && (
            <div className="onboardingStep">
              <div className="onboardingStep__titleRow">
                <h2>Votre profil</h2>
              </div>

              <div className="onboardingGrid2">
                <div>
                  <Input
                    label="Prénom"
                    placeholder="Votre prénom"
                    value={form.firstName}
                    onChange={(e) => handleChange("firstName", e.target.value)}
                    onBlur={() => handleBlur("firstName")}
                    disabled={loading}
                    required
                  />
                  {shouldShowFieldError("firstName") &&
                  fieldErrors.firstName ? (
                    <MessageBox variant="error">
                      {fieldErrors.firstName}
                    </MessageBox>
                  ) : null}
                </div>

                <div>
                  <Input
                    label="Nom"
                    placeholder="Votre nom"
                    value={form.lastName}
                    onChange={(e) => handleChange("lastName", e.target.value)}
                    onBlur={() => handleBlur("lastName")}
                    disabled={loading}
                    required
                  />
                  {shouldShowFieldError("lastName") && fieldErrors.lastName ? (
                    <MessageBox variant="error">
                      {fieldErrors.lastName}
                    </MessageBox>
                  ) : null}
                </div>
              </div>

              <div className="onboardingGrid2">
                {/* Téléphone */}
                <div
                  // ✅ assure qu’on “touche” même si PhoneInput ne déclenche pas un blur propre
                  onBlurCapture={() => handleBlur("phone")}
                >
                  <PhoneInput
                    label="Téléphone (optionnel)"
                    value={form.phone}
                    onChange={(v) => handleChange("phone", v)}
                    required={false}
                  />
                  {shouldShowFieldError("phone") && fieldErrors.phone ? (
                    <MessageBox variant="error">{fieldErrors.phone}</MessageBox>
                  ) : null}
                </div>

                {/* Pays */}
                <div onBlurCapture={() => handleBlur("countryLabel")}>
                  <CountrySelect
                    label="Pays"
                    value={form.countryLabel}
                    onChange={(v) => handleChange("countryLabel", v || "")}
                    required
                  />
                  {shouldShowFieldError("countryLabel") &&
                  fieldErrors.countryLabel ? (
                    <MessageBox variant="error">
                      {fieldErrors.countryLabel}
                    </MessageBox>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* -------------------- STEP 2 -------------------- */}
          {step === 2 && (
            <div className="onboardingStep">
              <div className="onboardingStep__titleRow">
                <h2>Votre organisation</h2>
                <Badge tone="info" label="Création" />
              </div>

              <div className="onboardingRow">
                <div>
                  <Select
                    label="Type"
                    value={form.orgType}
                    onChange={(e) =>
                      handleChange(
                        "orgType",
                        e.target.value as WizardForm["orgType"],
                      )
                    }
                    onBlur={() => handleBlur("orgType")}
                    disabled={loading}
                  >
                    <option value="person">Personne physique</option>
                    <option value="association">Personne morale</option>
                  </Select>

                  {shouldShowFieldError("orgType") && fieldErrors.orgType ? (
                    <MessageBox variant="error">
                      {fieldErrors.orgType}
                    </MessageBox>
                  ) : null}
                </div>
              </div>

              <div>
                <Input
                  label="Nom de l’organisation"
                  placeholder="Ex: Maison des Jeunes de…"
                  value={form.orgName}
                  onChange={(e) => handleChange("orgName", e.target.value)}
                  onBlur={() => handleBlur("orgName")}
                  disabled={loading}
                />
                {shouldShowFieldError("orgName") && fieldErrors.orgName ? (
                  <MessageBox variant="error">{fieldErrors.orgName}</MessageBox>
                ) : null}
              </div>
            </div>
          )}

          {/* -------------------- ACTIONS -------------------- */}
          <div className="onboardingActionsBar">
            <div className="onboardingStatus">
              {!userId ? (
                <div className="onboardingError">
                  Utilisateur non chargé (bootstrap incomplet)
                </div>
              ) : null}
            </div>

            <div className="onboardingActions">
              {step > 1 ? (
                <Button
                  variant="secondary"
                  label="Précédent"
                  onClick={goPrev}
                  disabled={loading}
                />
              ) : null}

              <Button
                variant="primary"
                label={
                  step === 2 ? (loading ? "Création…" : "Terminer") : "Suivant"
                }
                onClick={goNext}
                disabled={loading || !canGoNext || (step === 2 && !userId)}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
