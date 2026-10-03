import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { useToast } from "@shared/ui/components/toast/useToast";

import { Container } from "@ui/components";
import Card, { CardBody, CardHeader } from "@ui/components/card/Card";
import Badge from "@ui/components/badge/Badge";
import Button from "@ui/components/button/Button";
import { Input } from "@ui/components";
import CountrySelect from "@shared/ui/components/inputs/CountrySelect";

import type { AdminOutletContext } from "../../dashboard/components/AdminDashboard";
import { supabase } from "@gateways/supabase/supabaseClient";
import { useStartSubscription } from "../hooks/useStartSubscription";
import { useCancelSubscription } from "../hooks/useCancelSubscription";
import { ConfirmModal } from "@ui/components/modals/ConfirmModal";
import { MessageBox } from "@ui/components/message/MessageBox";
import type {
  StartSubscriptionPayload,
  StartSubscriptionResponse,
} from "../schemas/admin.startSubscription.schema";
import { useMakeOrganizationBilling } from "../hooks/useMakeOrganizationBilling";
import { useUpsertOrganizationBilling } from "../hooks/useUpsertOrganizationBilling";

import type {
  OrganizationBilling,
  OrganizationBillingPatch,
} from "@shared/models/db/db.organizationBilling.schema";

import { inferCountryCode } from "@helpers/countries";

import { InvoicesTab } from "../components/InvoicesTab";

import { countryCodeToLabel } from "@helpers/countries";

import "./adminSubscription.desktop.css";
import "./adminSubscription.mobile.css";
import { AdminPageHeader } from "../../dashboard/components/AdminPageHeader/AdminPageHeader";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtDate(d: string | null | undefined) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString("fr-BE", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

function fmtLimit(v: number | null | undefined) {
  if (v === null || v === undefined) return "Illimité";
  return String(v);
}

function boolLabel(v: boolean) {
  return v ? "Oui" : "Non";
}

/* ------------------------------------------------------------------ */
/* Billing helpers                                                    */
/* ------------------------------------------------------------------ */

function t(v: string) {
  return v.trim();
}
function toNullIfEmpty(v: string): string | null {
  const s = t(v);
  return s ? s : null;
}

/* ------------------------------------------------------------------ */
/* Plans                                                              */
/* ------------------------------------------------------------------ */

type PlanKey = "free" | "starter" | "pro";

type PlanDef = {
  key: PlanKey;
  title: string;
  price: string;
  short: string;
  points: string[];
  highlight?: boolean;
  ctaLabel?: string;
};

const PLAN_DEFS: Record<PlanKey, PlanDef> = {
  free: {
    key: "free",
    title: "Free",
    price: "0 €",
    short: "Pour démarrer et tester.",
    points: [
      "Événements gratuits illimités",
      "1 événement payant / an",
      "Max 50 inscrits / événement payant",
      "Branding Eventflow",
    ],
  },
  starter: {
    key: "starter",
    title: "Starter",
    price: "15,99 €/mois",
    short: "Pour les petites assos actives.",
    points: [
      "Événements gratuits illimités",
      "5 événements payants / an",
      "Inscriptions illimitées",
      "Couleur & Logo personnalisés",
    ],
    highlight: false,
    ctaLabel: "Passer en Starter",
  },
  pro: {
    key: "pro",
    title: "Pro",
    price: "25,99 €/mois",
    short: "Le meilleur pour scaler (illimité).",
    points: [
      "Événements gratuits illimités",
      "Événements payants illimités",
      "Inscriptions illimitées",
      "Couleur & Logo personnalisés",
    ],
    highlight: true,
    ctaLabel: "Passer en Pro",
  },
};

function canStartSubscription(target: PlanKey): target is "starter" | "pro" {
  return target === "starter" || target === "pro";
}

function hasRetryableInvoiceProcessing(result: StartSubscriptionResponse) {
  return (
    !result.warnings.includes("BILLIT_REVIEW_REQUIRED") &&
    result.warnings.some(
      (warning) =>
        warning === "INVOICE_PDF_PENDING" || warning === "BILLIT_SEND_PENDING",
    )
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export default function AdminAbonnementPage() {
  const { bootstrap, refetch, orgId } = useOutletContext<AdminOutletContext>();
  const { showToast } = useToast();

  const billingGet = useMakeOrganizationBilling({ supabase, orgId });
  const billingUpsert = useUpsertOrganizationBilling({ supabase, orgId });
  const isCurrentBillingScope = () => billingGet.isCurrentScope() && billingUpsert.isCurrentScope();
  const [promoCode, setPromoCode] = useState("");

  const [pendingPlan, setPendingPlan] = useState<PlanKey | null>(null);

  type TabKey = "general" | "invoices" | "billing";
  const TAB_KEYS: TabKey[] = ["general", "invoices", "billing"];
  function isTabKey(v: string | null): v is TabKey {
    return !!v && (TAB_KEYS as string[]).includes(v);
  }

  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl: TabKey = isTabKey(searchParams.get("tab"))
    ? (searchParams.get("tab") as TabKey)
    : "general";
  const [tab, setTab] = useState<TabKey>(tabFromUrl);
  const [billingKey, setBillingKey] = useState(0);

  useEffect(() => {
    if (tabFromUrl === "billing") {
      billingGet.fetchBilling(orgId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabFromUrl, orgId]);

  function setTabAndUrl(next: TabKey) {
    setTab(next);

    if (next === "billing") {
      billingGet.fetchBilling(orgId);
    }

    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        sp.set("tab", next);
        return sp;
      },
      { replace: true },
    );
  }

  const {
    loading: startLoading,
    error: startError,
    result,
    startSubscription,
    reset,
  } = useStartSubscription({ supabase });

  const cancellation = useCancelSubscription({ supabase });
  const [cancelOrgId, setCancelOrgId] = useState<string | null>(null);
  const [pendingInvoiceProcessing, setPendingInvoiceProcessing] = useState<{
    payload: StartSubscriptionPayload;
    invoice: StartSubscriptionResponse;
  } | null>(null);

  useEffect(() => {
    if (!startError) return;
    showToast({
      title:
        pendingInvoiceProcessing?.payload.orgId === orgId
          ? "Traitement de la facture à réessayer"
          : "Erreur",
      description:
        pendingInvoiceProcessing?.payload.orgId === orgId
          ? `Votre abonnement reste actif. ${startError}`
          : startError,
      variant: "error",
      duration: 7000,
    });
  }, [startError, showToast, pendingInvoiceProcessing, orgId]);

  useEffect(() => {
    if (!result || result.orgId !== orgId) return;
    const warningMessages = result.warnings.map((warning) => {
      if (warning === "INVOICE_PDF_PENDING")
        return "Le PDF est en préparation ; réessayez son téléchargement dans Mes factures.";
      if (warning === "BILLIT_SEND_PENDING")
        return "La transmission comptable reste à réessayer.";
      if (warning === "BILLIT_REVIEW_REQUIRED")
        return "La transmission comptable doit être vérifiée avant un nouvel envoi.";
      return "Une étape de traitement de la facture reste à vérifier.";
    });
    showToast({
      title:
        warningMessages.length > 0
          ? "Abonnement actif, facture en cours de traitement"
          : result.reused
            ? "Facture déjà disponible"
            : "Facture créée",
      description:
        `La facture ${result.invoiceNumber} est payable par virement avant le ${fmtDate(result.dueAt) ?? result.dueAt}. ${warningMessages.join(" ")}`.trim(),
      variant: warningMessages.length > 0 ? "warning" : "success",
      duration: warningMessages.length > 0 ? 0 : 6000,
    });
  }, [result, showToast, orgId]);

  const org = bootstrap.organization;
  const sub = bootstrap.subscription;
  const limits = bootstrap.planLimits;

  const plan = (org?.plan ?? "free") as PlanKey;
  const isPaidPlan = plan === "starter" || plan === "pro";
  const isInternalSubscription = sub?.provider === "manual";
  const planLabel =
    plan === "free" ? "Free" : plan === "starter" ? "Starter" : "Pro";

  const periodEndLabel = useMemo(() => {
    const d = sub?.currentPeriodEnd ?? org?.planExpiresAt ?? null;
    return fmtDate(d);
  }, [sub?.currentPeriodEnd, org?.planExpiresAt]);

  const startedAtLabel = fmtDate(org?.planStartedAt ?? null);
  const pendingInvoiceForCurrentPlan =
    pendingInvoiceProcessing !== null &&
    pendingInvoiceProcessing.payload.orgId === orgId &&
    pendingInvoiceProcessing.payload.plan === plan &&
    isInternalSubscription &&
    sub?.status === "active" &&
    Date.parse(sub.currentPeriodEnd ?? "") ===
      Date.parse(pendingInvoiceProcessing.invoice.currentPeriodEnd);

  async function requestSubscription(target: "starter" | "pro") {
    if (!isCurrentBillingScope()) return null;
    const payload: StartSubscriptionPayload = {
      orgId,
      plan: target,
      promoCode: promoCode.trim() || null,
    };
    setPendingInvoiceProcessing(null);
    const invoice = await startSubscription(payload);
    if (!isCurrentBillingScope()) return null;
    if (invoice && hasRetryableInvoiceProcessing(invoice)) {
      setPendingInvoiceProcessing({ payload, invoice });
    }
    return invoice;
  }

  async function retryInvoiceProcessing() {
    if (!isCurrentBillingScope()) return;
    const pending = pendingInvoiceProcessing;
    if (!pending || !pendingInvoiceForCurrentPlan || startLoading) return;
    if (!(Date.parse(pending.invoice.currentPeriodEnd) > Date.now())) {
      setPendingInvoiceProcessing(null);
      showToast({
        title: "Facture à vérifier",
        description:
          "La période de cette facture est terminée. Consultez vos factures actualisées avant de poursuivre.",
        variant: "info",
      });
      await refetch();
      return;
    }

    const invoice = await startSubscription(pending.payload);
    if (!isCurrentBillingScope()) return;
    if (invoice) {
      setPendingInvoiceProcessing(
        hasRetryableInvoiceProcessing(invoice)
          ? { payload: pending.payload, invoice }
          : null,
      );
    }
  }

  async function ensureBillingOrGoToTab(
    nextPlan: "starter" | "pro",
  ): Promise<boolean> {
    if (!isCurrentBillingScope()) return false;
    const billing = await billingGet.fetchBilling(orgId);
    if (!isCurrentBillingScope()) return false;
    if (billing) return true;

    setPendingPlan(nextPlan);
    setTabAndUrl("billing");

    showToast({
      title: "Infos de facturation requises",
      description: "Complétez la facturation pour activer un plan payant.",
      variant: "info",
      duration: 6000,
    });

    return false;
  }

  if (!bootstrap || !org) {
    return (
      <Container>
        <AdminPageHeader
          eyebrow="Compte et facturation"
          title="Abonnement"
          description="Chargement de votre offre et de vos informations de facturation…"
        />
        <Card>
          <CardHeader title="Abonnement" subtitle="Chargement…" />
          <CardBody>
            <div className="adminSub__loadingNote">Veuillez patienter.</div>
          </CardBody>
        </Card>
      </Container>
    );
  }

  async function onChoosePlan(target: PlanKey) {
    if (!isCurrentBillingScope()) return;
    reset();

    if (!canStartSubscription(target)) return;

    const okBilling = await ensureBillingOrGoToTab(target);
    if (!okBilling || !isCurrentBillingScope()) return;

    const res = await requestSubscription(target);
    if (!isCurrentBillingScope()) return;

    if (!res) {
      showToast({
        title: "Impossible de démarrer l’abonnement",
        description: "Réessayez dans quelques instants.",
        variant: "error",
        duration: 6000,
      });
      return;
    }

    await refetch();
    if (!isCurrentBillingScope()) return;
    setTabAndUrl("invoices");
  }

  async function onCancelPlan() {
    if (!isCurrentBillingScope()) return;
    if (
      cancelOrgId !== orgId ||
      !isInternalSubscription ||
      cancellation.loading
    )
      return;

    const canceled = await cancellation.cancelSubscription({ orgId });
    if (!isCurrentBillingScope()) return;
    if (!canceled?.ok) return;

    setCancelOrgId(null);
    await refetch();
    if (!isCurrentBillingScope()) return;
    showToast({
      title: "Abonnement résilié",
      description:
        "Votre organisation est repassée en Free. Le renouvellement des factures d’abonnement est arrêté.",
      variant: "success",
      duration: 6500,
    });
  }

  const anyLoading = startLoading || cancellation.loading;

  const upgradeTiles =
    plan === "free"
      ? (["pro", "starter"] as const)
      : plan === "starter"
        ? (["pro"] as const)
        : ([] as const);

  return (
    <Container>
      <AdminPageHeader
        eyebrow="Compte et facturation"
        title="Abonnement"
        description="Consultez votre offre, ses limites et vos factures, puis mettez à jour les informations utilisées pour la facturation."
      />
      <ConfirmModal
        isOpen={cancelOrgId === orgId && isInternalSubscription}
        title="Résilier votre abonnement Eventflow ?"
        intent="danger"
        confirmLabel="Résilier l’abonnement"
        confirmLoadingLabel="Résiliation…"
        loading={cancellation.loading}
        error={cancellation.error}
        onCancel={() => {
          if (cancellation.loading) return;
          setCancelOrgId(null);
          cancellation.reset();
        }}
        onConfirm={onCancelPlan}
      >
        Votre organisation repassera immédiatement en Free, avec ses limites.
        Aucune nouvelle facture d’abonnement ne sera créée par renouvellement.
        Les factures déjà émises restent disponibles dans « Mes factures ».
      </ConfirmModal>
      <div className="adminSub__page">
        <div className="adminEventTabs">
          <div className="adminEventTabsInner">
            <TabButton
              active={tab === "general"}
              onClick={() => setTabAndUrl("general")}
            >
              Général
            </TabButton>
            <TabButton
              active={tab === "invoices"}
              onClick={() => setTabAndUrl("invoices")}
            >
              Mes factures
            </TabButton>
            <TabButton
              active={tab === "billing"}
              onClick={() => setTabAndUrl("billing")}
            >
              Facturation
            </TabButton>
          </div>
        </div>

        {tab === "general" && (
          <>
            <Card>
              <CardHeader
                title="Abonnement"
                subtitle="Votre plan actuel, votre statut, et les prochaines étapes."
              />
              <CardBody>
                <div className="adminSub__summaryGrid">
                  <div className="adminSub__summaryCol">
                    <div className="adminSub__label">Plan actuel</div>
                    <div className="adminSub__badges">
                      <Badge>{planLabel}</Badge>
                      <Badge>{sub?.status ?? org.status}</Badge>
                    </div>
                    {sub?.discountPercent ? (
                      <div className="adminSub__mutedLine">
                        Tarif fondateur actif : <b>-{sub.discountPercent}%</b>
                        {sub.billingPriceValue ? (
                          <> • {sub.billingPriceValue} € / mois</>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="adminSub__line">
                      Démarré le{" "}
                      <span className="adminSub__valueStrong">
                        {startedAtLabel ?? "—"}
                      </span>
                    </div>
                  </div>

                  <div className="adminSub__summaryCol">
                    <div className="adminSub__label">Période</div>

                    {plan === "free" && !sub ? (
                      <div className="adminSub__text">
                        Vous êtes sur le plan <b>Free</b>.
                        <div className="adminSub__mutedLine">
                          Aucune échéance, upgrade possible à tout moment.
                        </div>
                      </div>
                    ) : (
                      <div className="adminSub__text">
                        Prochaine échéance :{" "}
                        <span className="adminSub__valueStrong">
                          {periodEndLabel ?? "—"}
                        </span>
                        <div className="adminSub__mutedLine">
                          {sub?.provider === "mollie"
                            ? "Ancien abonnement Mollie conservé dans l’historique."
                            : "Facturation Eventflow par facture et virement bancaire."}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="adminSub__actionsRow">
                  <Button
                    variant="secondary"
                    disabled={billingGet.loading || billingUpsert.loading}
                    onClick={() => {
                      setPendingPlan(null);
                      setTabAndUrl("billing");
                    }}
                  >
                    Infos de facturation
                  </Button>
                </div>
              </CardBody>
            </Card>

            <div className="adminSub__spacer" />

            <Card>
              <CardHeader
                title="Limites"
                subtitle="Ce que votre plan autorise actuellement."
              />
              <CardBody>
                <div className="adminSub__limitsGrid">
                  <Row
                    label="Événements / an"
                    value={fmtLimit(limits.maxEventsPerYear)}
                  />
                  <Row
                    label="Inscriptions / événement"
                    value={fmtLimit(limits.maxRegistrationsPerEvent)}
                  />
                  <Row
                    label="Branding Eventflow"
                    value={boolLabel(limits.brandingRequired)}
                  />
                </div>
              </CardBody>
            </Card>

            <div className="adminSub__spacer" />

            <div className="adminSub__spacer" />

            <Card>
              <CardHeader
                title="Offre de lancement"
                subtitle="Si vous disposez d’un code early adopter, saisissez-le avant de choisir un plan."
              />
              <CardBody>
                <div className="adminSub__promoRow">
                  <Input
                    label="Code promo"
                    placeholder="Code promo"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    disabled={anyLoading}
                  />
                </div>

                <div className="adminSub__mutedLine">
                  Le code sera appliqué si l’offre est valide au moment du
                  démarrage de l’abonnement.
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Changer de plan"
                subtitle={
                  plan === "free"
                    ? "Choisissez un plan payant pour débloquer plus de fonctionnalités et soutenir Eventflow."
                    : plan === "starter"
                      ? "Vous pouvez upgrader vers Pro."
                      : "Vous êtes sur le plan Pro."
                }
              />
              <CardBody>
                <div className={isPaidPlan ? "adminSub__plan2Col" : ""}>
                  <div
                    className={
                      plan === "free"
                        ? "adminSub__plansWrap isFlex"
                        : "adminSub__plansWrap"
                    }
                  >
                    {upgradeTiles.map((target) => (
                      <PlanTile
                        key={target}
                        title={PLAN_DEFS[target].title}
                        price={PLAN_DEFS[target].price}
                        points={PLAN_DEFS[target].points}
                        highlight={PLAN_DEFS[target].highlight}
                        kind="up"
                        currentPlan={plan}
                        targetPlan={target}
                        loading={anyLoading}
                        onAction={() => onChoosePlan(target)}
                        badgeLabel={target === "pro" ? "Recommandé" : "Upgrade"}
                        actionLabelOverride={PLAN_DEFS[target].ctaLabel}
                        helperOverride={
                          target === "pro"
                            ? "Le meilleur choix si vous faites des événements payants régulièrement."
                            : undefined
                        }
                        buttonVariant={
                          target === "starter" ? "secondary" : undefined
                        }
                      />
                    ))}
                  </div>

                  {isPaidPlan ? (
                    <div className="adminSub__cancelCol">
                      <div className="adminSub__dangerBox">
                        <div className="adminSub__dangerTitle">
                          {isInternalSubscription
                            ? "Facturation par virement"
                            : sub?.provider === "mollie"
                              ? "Abonnement Mollie historique"
                              : "Abonnement historique"}
                        </div>

                        <div className="adminSub__dangerText">
                          {isInternalSubscription ? (
                            <>
                              Chaque facture Eventflow est payable par virement
                              dans les 14 jours. Les coordonnées bancaires et la
                              communication figurent sur le PDF.
                            </>
                          ) : (
                            <>
                              Ce mode de facturation n’est plus actif. Démarrez
                              la facturation interne pour conserver votre plan.
                            </>
                          )}
                        </div>

                        <div className="adminSub__dangerAction">
                          <Button
                            variant="primary"
                            className="adminSub__fullWidthBtn"
                            disabled={anyLoading}
                            onClick={() => {
                              if (isInternalSubscription) {
                                setTabAndUrl("invoices");
                              } else if (plan === "starter" || plan === "pro") {
                                void onChoosePlan(plan);
                              }
                            }}
                          >
                            {isInternalSubscription
                              ? "Voir mes factures"
                              : startLoading
                                ? "Ouverture…"
                                : "Activer la facturation interne"}
                          </Button>
                          {isInternalSubscription ? (
                            <Button
                              variant="danger"
                              className="adminSub__fullWidthBtn"
                              disabled={anyLoading}
                              onClick={() => {
                                cancellation.reset();
                                setCancelOrgId(orgId);
                              }}
                            >
                              Résilier l’abonnement
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="adminSub__footNote">
                  {plan === "free" && (
                    <>
                      Passez à Starter ou Pro avec une facture payable sous 14
                      jours.
                    </>
                  )}
                  {plan === "starter" && (
                    <>Passez à Pro ou gérez votre abonnement existant.</>
                  )}
                  {plan === "pro" && isInternalSubscription && (
                    <>
                      Vous pouvez gérer ou résilier votre abonnement à tout
                      moment.
                    </>
                  )}
                </div>
              </CardBody>
            </Card>
          </>
        )}

        {tab === "invoices" && (
          <>
            {pendingInvoiceForCurrentPlan && pendingInvoiceProcessing ? (
              <Card>
                <CardHeader title="Traitement de votre facture" />
                <CardBody>
                  <MessageBox variant="info">
                    Votre abonnement est actif. La facture{" "}
                    {pendingInvoiceProcessing.invoice.invoiceNumber} nécessite
                    encore une tentative de traitement.
                  </MessageBox>
                  <Button
                    variant="secondary"
                    disabled={anyLoading}
                    onClick={retryInvoiceProcessing}
                  >
                    {startLoading
                      ? "Traitement…"
                      : "Réessayer le traitement de la facture"}
                  </Button>
                </CardBody>
              </Card>
            ) : null}
            <InvoicesTab orgId={orgId} />
          </>
        )}

        {tab === "billing" && (
          <BillingTab
            key={`${orgId}:${billingKey}`}
            mode={pendingPlan ? "required" : "edit"}
            orgId={orgId}
            initial={billingGet.billing ?? null}
            loading={billingGet.loading || billingUpsert.loading}
            error={billingGet.error || billingUpsert.error}
            onSave={async (patch) => {
              if (!isCurrentBillingScope()) return;
              const updated =
                await billingUpsert.upsertOrganizationBilling(patch);
              if (!updated || !isCurrentBillingScope()) return;

              const refreshed = await billingGet.fetchBilling(orgId);
              if (!refreshed || !isCurrentBillingScope()) return;
              setBillingKey((k) => k + 1);

              const planToContinue = pendingPlan;
              setPendingPlan(null);

              if (planToContinue && canStartSubscription(planToContinue)) {
                const res = await requestSubscription(planToContinue);
                if (!isCurrentBillingScope()) return;

                if (!res) {
                  showToast({
                    title: "Impossible de démarrer l’abonnement",
                    description: "Réessayez dans quelques instants.",
                    variant: "error",
                    duration: 6000,
                  });
                  return;
                }

                await refetch();
                if (!isCurrentBillingScope()) return;
                setTabAndUrl("invoices");
                return;
              }

              showToast({
                title: "Facturation enregistrée",
                description:
                  "Vos informations de facturation ont été mises à jour.",
                variant: "success",
                duration: 4500,
              });
            }}
          />
        )}
      </div>
    </Container>
  );
}

/* ------------------------------------------------------------------ */
/* UI helpers                                                         */
/* ------------------------------------------------------------------ */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="adminSub__limitRow">
      <div className="adminSub__limitLabel">{label}</div>
      <div className="adminSub__limitValue">{value}</div>
    </div>
  );
}

function PlanTile({
  title,
  price,
  points,
  highlight,
  kind,
  currentPlan,
  targetPlan,
  onAction,
  loading,
  badgeLabel,
  actionLabelOverride,
  helperOverride,
  buttonVariant,
}: {
  title: string;
  price: string;
  points: string[];
  highlight?: boolean;
  kind: "up" | "down";
  currentPlan: PlanKey;
  targetPlan: PlanKey;
  onAction?: () => void;
  loading?: boolean;
  badgeLabel?: string;
  actionLabelOverride?: string;
  helperOverride?: string;
  buttonVariant?: "primary" | "secondary" | "danger";
}) {
  const defaultActionLabel =
    kind === "up" ? `Passer à ${title}` : `Redescendre à ${title}`;
  const actionLabel = actionLabelOverride ?? defaultActionLabel;

  const helper =
    helperOverride ??
    (kind === "up"
      ? "Vous garderez l’accès immédiatement après confirmation."
      : "Attention : baisse des limites et fonctionnalités.");

  const isEnabled = Boolean(onAction) && !loading;

  return (
    <div
      className={
        highlight ? "adminSub__planTile isHighlight" : "adminSub__planTile"
      }
    >
      <div className="adminSub__planTop">
        <div className="adminSub__planLeft">
          <div className="adminSub__planTitle">{title}</div>
          <div className="adminSub__planShort">
            {PLAN_DEFS[targetPlan].short}
          </div>
        </div>

        <div className="adminSub__planRight">
          <div className="adminSub__planPrice">{price}</div>
          <Badge>
            {badgeLabel ?? (kind === "up" ? "Upgrade" : "Downgrade")}
          </Badge>
        </div>
      </div>

      <ul className="adminSub__planPoints">
        {points.map((p) => (
          <li key={p} className="adminSub__planPoint">
            {p}
          </li>
        ))}
      </ul>

      <div className="adminSub__planHelper">{helper}</div>

      <div className="adminSub__planAction">
        <Button
          variant={buttonVariant}
          disabled={!isEnabled}
          className="adminSub__fullWidthBtn"
          onClick={onAction}
        >
          {loading && isEnabled ? "Ouverture…" : actionLabel}
        </Button>
      </div>

      <div className="adminSub__planCurrent">
        Plan actuel : {PLAN_DEFS[currentPlan].title}
      </div>
    </div>
  );
}

function TabButton(props: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { active, onClick, children } = props;
  return (
    <button
      onClick={onClick}
      className={active ? "adminEventTab isActive" : "adminEventTab"}
      type="button"
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* BillingTab                                                         */
/* ------------------------------------------------------------------ */

function BillingTab(props: {
  mode: "required" | "edit";
  orgId: string;
  initial: OrganizationBilling | null;
  loading: boolean;
  error: string | null;
  onSave: (patch: OrganizationBillingPatch) => Promise<void>;
}) {
  const { mode, orgId, initial, loading, error, onSave } = props;

  function makeInitialForm(initial: OrganizationBilling | null) {
    return {
      legalName: initial?.legalName ?? "",
      vatCountryLabel: countryCodeToLabel(initial?.vatCountryCode),
      vatNumber: initial?.vatNumber ?? "",

      addressLine1: initial?.addressLine1 ?? "",
      addressLine2: initial?.addressLine2 ?? "",
      postalCode: initial?.postalCode ?? "",
      city: initial?.city ?? "",
      countryLabel: countryCodeToLabel(initial?.countryCode) || "Belgique",

      billingEmail: initial?.billingEmail ?? "",
      invoiceReference: initial?.invoiceReference ?? "",
    };
  }

  const [form, setForm] = useState(() => makeInitialForm(initial));
  const [isVatSubject, setIsVatSubject] = useState(() =>
    Boolean(initial?.vatCountryCode || initial?.vatNumber),
  );

  // ✅ évite d’écraser le form si l’utilisateur a déjà commencé à modifier
  const [isDirty, setIsDirty] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setIsDirty(true);
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // ✅ resync quand `initial` arrive / change (fetch async) sans warning “cascading renders”
  const lastInitRef = useRef<string>("");

  useEffect(() => {
    if (!initial) return;
    if (isDirty) return;

    const sig = JSON.stringify({
      legalName: initial.legalName ?? "",
      vatCountryCode: initial.vatCountryCode ?? "",
      vatNumber: initial.vatNumber ?? "",
      addressLine1: initial.addressLine1 ?? "",
      addressLine2: initial.addressLine2 ?? "",
      postalCode: initial.postalCode ?? "",
      city: initial.city ?? "",
      countryCode: initial.countryCode ?? "",
      billingEmail: initial.billingEmail ?? "",
      invoiceReference: initial.invoiceReference ?? "",
    });

    if (sig === lastInitRef.current) return;
    lastInitRef.current = sig;

    // microtask => évite le warning React (setState sync dans effect)
    queueMicrotask(() => {
      setForm(makeInitialForm(initial));
      setIsVatSubject(Boolean(initial.vatCountryCode || initial.vatNumber));
      setIsDirty(false);
    });
  }, [initial, isDirty]);

  const vatCountryCode = useMemo(() => {
    const c = inferCountryCode(form.vatCountryLabel);
    return c ? String(c) : null;
  }, [form.vatCountryLabel]);

  const needsVat = isVatSubject;

  const title =
    mode === "required"
      ? "Infos de facturation requises"
      : "Infos de facturation";
  const subtitle =
    mode === "required"
      ? "Avant de souscrire, on a besoin de ces informations pour générer vos factures."
      : "Consultez et modifiez les informations utilisées sur vos factures.";

  const canSave = useMemo(() => {
    const baseOk =
      t(form.legalName).length >= 2 &&
      t(form.addressLine1).length >= 2 &&
      t(form.postalCode).length >= 2 &&
      t(form.city).length >= 2;

    const vatOk =
      !needsVat ||
      (t(form.vatCountryLabel).length >= 2 && t(form.vatNumber).length >= 6);

    return baseOk && vatOk;
  }, [
    form.legalName,
    form.addressLine1,
    form.postalCode,
    form.city,
    form.vatCountryLabel,
    form.vatNumber,
    needsVat,
  ]);

  async function submit() {
    if (!canSave) return;

    const patch: OrganizationBillingPatch = {
      orgId,
      legalName: t(form.legalName),

      vatCountryCode: needsVat ? vatCountryCode : null,
      vatNumber: needsVat ? toNullIfEmpty(form.vatNumber) : null,

      addressLine1: t(form.addressLine1),
      addressLine2: toNullIfEmpty(form.addressLine2),

      postalCode: t(form.postalCode),
      city: t(form.city),

      countryCode: inferCountryCode(form.countryLabel),

      billingEmail: toNullIfEmpty(form.billingEmail),
      invoiceReference: toNullIfEmpty(form.invoiceReference),
    };

    await onSave(patch);

    // ✅ après save ok, on considère “propre”
    setIsDirty(false);
  }

  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <CardBody>
        {error ? (
          <div className="adminSub__alert adminSub__alert--error billingTab__error">
            {error}
          </div>
        ) : null}

        <div className="billingTabGrid">
          <div className="billingTabSpan2">
            <Input
              label="Raison sociale"
              value={form.legalName}
              onChange={(e) => set("legalName", e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="billingTabSpan2">
            <label className="billingTabCheckbox">
              <input
                type="checkbox"
                checked={isVatSubject}
                onChange={(e) => {
                  const next = e.target.checked;
                  setIsVatSubject(next);
                  setIsDirty(true);

                  if (!next) {
                    setForm((prev) => ({
                      ...prev,
                      vatCountryLabel: "",
                      vatNumber: "",
                    }));
                  }
                }}
                disabled={loading}
              />
              <span>Assujetti à la TVA</span>
            </label>
          </div>

          {isVatSubject ? (
            <>
              <div>
                <CountrySelect
                  label="Pays TVA"
                  value={form.vatCountryLabel}
                  onChange={(v) => set("vatCountryLabel", v || "")}
                  required
                />
              </div>

              <div>
                <Input
                  label="Numéro TVA"
                  placeholder="Ex: BE0123456789"
                  value={form.vatNumber}
                  onChange={(e) => set("vatNumber", e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
            </>
          ) : null}

          <div className="billingTabSpan2">
            <Input
              label="Adresse"
              placeholder="Rue, numéro"
              value={form.addressLine1}
              onChange={(e) => set("addressLine1", e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="billingTabSpan2">
            <Input
              label="Complément d'adresse (optionnel)"
              placeholder="Boîte, étage…"
              value={form.addressLine2}
              onChange={(e) => set("addressLine2", e.target.value)}
              disabled={loading}
            />
          </div>

          <div>
            <Input
              label="Code postal"
              placeholder="Ex: 5000"
              value={form.postalCode}
              onChange={(e) => set("postalCode", e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div>
            <Input
              label="Ville"
              placeholder="Ex: Namur"
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div>
            <CountrySelect
              label="Pays"
              value={form.countryLabel}
              onChange={(v) => set("countryLabel", v || "")}
              required
            />
          </div>

          <div>
            <Input
              label="Email de facturation (optionnel)"
              placeholder="facturation@…"
              value={form.billingEmail}
              onChange={(e) => set("billingEmail", e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="billingTabSpan2">
            <Input
              label="Référence facture (optionnel)"
              placeholder="Ex: Projet / PO / référence interne…"
              value={form.invoiceReference}
              onChange={(e) => set("invoiceReference", e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

        <div className="billingTabActions">
          <Button
            variant="primary"
            disabled={loading || !canSave}
            onClick={submit}
          >
            {loading ? "Enregistrement…" : "Enregistrer"}
          </Button>

          {mode === "required" ? (
            <div className="billingTabHint">
              Ces infos seront utilisées pour vos factures EventFlow.
            </div>
          ) : null}
        </div>

        <div className="billingTabFoot">
          Vous pourrez modifier ces informations à tout moment.
        </div>
      </CardBody>
    </Card>
  );
}
