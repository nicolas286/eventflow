import { SellerIdentity } from "../components/SellerIdentity";
import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { supabase } from "@gateways/supabase/supabaseClient";
import { usePublicEventDetail } from "../../events/hooks/usePublicEventDetail";
import Container from "@ui/components/container/Container";
import Card, { CardBody, CardHeader } from "@ui/components/card/Card";
import Button from "@ui/components/button/Button";
import { PublicCharterModal } from "../components/PublicCharterModal/PublicCharterModal";

import { Turnstile, type TurnstileRef } from "@ui/components/Turnstile";

import { PublicEventHeader } from "../components/PublicEventHeader";
import { PublicCheckoutStepper } from "../components/PublicCheckoutStepper/PublicCheckoutStepper";
import { PublicStickyCheckoutBar } from "../components/PublicStickyCheckoutBar/PublicStickyCheckoutBar";
import {
  clearDraft,
  formatMoney,
  loadDraft,
  saveDraft,
  type CheckoutDraft,
} from "../helpers/checkoutStore";

import "@app/layouts/publicCheckoutBase.desktop.css";
import "./EventPaymentPage.desktop.css";

import { useRegister } from "../hooks/useRegister";

function ensureDraft(orgSlug: string, eventSlug: string): CheckoutDraft {
  const d = loadDraft(orgSlug, eventSlug) as CheckoutDraft;
  return {
    orgSlug: d.orgSlug,
    eventSlug: d.eventSlug,
    quantities: d.quantities ?? {},
    attendees: d.attendees ?? [],
    acceptedTerms: d.acceptedTerms ?? false,
  };
}

export function EventPaymentPage() {
  const navigate = useNavigate();
  const { orgSlug: orgSlugParam, eventSlug: eventSlugParam } = useParams<{
    orgSlug: string;
    eventSlug: string;
  }>();

  const orgSlug = orgSlugParam ?? null;
  const eventSlug = eventSlugParam ?? null;

  const { loading, error, data } = usePublicEventDetail({
    supabase,
    orgSlug,
    eventSlug,
  });

  const [tick, setTick] = useState(0);

  const draft = useMemo(() => {
    if (!orgSlug || !eventSlug) return null;
    void tick;
    return ensureDraft(orgSlug, eventSlug);
  }, [orgSlug, eventSlug, tick]);

  const [buyerEmail, setBuyerEmail] = useState("");
  const [promoCode, setPromoCode] = useState("");

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const [pendingPay, setPendingPay] = useState(false);

  const [charterOpen, setCharterOpen] = useState(false);
  const [charterRead, setCharterRead] = useState(false);
  const [salesTermsOpen, setSalesTermsOpen] = useState(false);
  const termsKey = `${orgSlug}:${eventSlug}:${data?.org.salesTermsVersion ?? ""}:2026-10-01`;
  const [readTermsKey, setReadTermsKey] = useState<string | null>(null);
  const [acceptedTermsKey, setAcceptedTermsKey] = useState<string | null>(null);
  const salesTermsRead = readTermsKey === termsKey;
  function setSalesTermsRead(read: boolean) { setReadTermsKey(read ? termsKey : null); }

  const turnstileRef = useRef<TurnstileRef | null>(null);
  const turnstileSiteKey =
    (import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined)?.trim() ??
    "";

  const {
    register,
    loading: registering,
    error: registerError,
  } = useRegister({ supabase });

  function persistDraft(next: CheckoutDraft) {
    saveDraft(next);
    setTick((t) => t + 1);
  }

  if (loading || !orgSlug || !eventSlug) {
    return (
      <div className="publicPage">
        <Container>Chargement…</Container>
      </div>
    );
  }

  if (error) {
    return (
      <div className="publicPage">
        <Container>Erreur : {error}</Container>
      </div>
    );
  }

  if (!data?.event) {
    return (
      <div className="publicPage">
        <Container>Événement introuvable.</Container>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="publicPage">
        <Container>Draft introuvable.</Container>
      </div>
    );
  }

  const { org, event, products, formFields } = data;

  const quantities = draft.quantities;
  const accepted = acceptedTermsKey === termsKey;

  const picked = products
    .map((p) => ({ p, qty: quantities[p.id] ?? 0 }))
    .filter((x) => x.qty > 0);

  const totalCents = picked.reduce((acc, x) => acc + x.qty * x.p.priceCents, 0);
  const currency = picked[0]?.p.currency ?? "EUR";

  const depositCents =
    typeof event?.depositCents === "number" ? event.depositCents : 0;

  const dueNowCentsUi =
    totalCents <= 0
      ? 0
      : depositCents > 0
        ? Math.min(totalCents, depositCents)
        : totalCents;

  const hasDeposit = depositCents > 0 && totalCents > 0;
  const requiresOrganizerTerms = totalCents > 0;
  const paidSalesAvailable = org.paidSalesAvailable === true;

  const attendeesCount = picked.reduce((acc, x) => {
    if (!x.p.createsAttendees) return acc;
    return acc + x.qty * (x.p.attendeesPerUnit ?? 0);
  }, 0);

  const attendeesMismatch = attendeesCount !== (draft.attendees?.length ?? 0);

  const hasPromoCode = promoCode.trim().length > 0;

  const stickyCtaLabel =
    totalCents === 0
      ? registering || pendingPay
        ? "Validation…"
        : "Confirmer la réservation"
      : registering || pendingPay
        ? "Validation du paiement…"
        : hasPromoCode
          ? "Valider le code et continuer"
          : `Payer ${formatMoney(dueNowCentsUi, currency)}`;

  function setAccepted(next: boolean) {
    if (!orgSlug || !eventSlug) return;
    const current = ensureDraft(orgSlug, eventSlug);
    setAcceptedTermsKey(next ? termsKey : null);
    persistDraft({ ...current, acceptedTerms: next });
  }

  function goBack() {
    navigate(`/o/${orgSlug}/e/${eventSlug}/participants`);
  }

  function buildAttendeesPayload(): Array<{
    eventProductId: string;
    answers?: Array<{ eventFormFieldId: string; value?: unknown }>;
  }> {
    const fieldIdByKey = new Map<string, string>();
    for (const f of formFields ?? []) {
      if (f?.fieldKey && f?.id)
        fieldIdByKey.set(String(f.fieldKey), String(f.id));
    }

    const expandedProductIds: string[] = [];
    for (const { p, qty } of picked) {
      if (!p.createsAttendees) continue;
      const perUnit = p.attendeesPerUnit ?? 0;
      const count = qty * perUnit;
      for (let i = 0; i < count; i++) expandedProductIds.push(p.id);
    }

    return (draft?.attendees ?? []).map((answersByKey, idx) => {
      const eventProductId = expandedProductIds[idx];
      const obj = (answersByKey ?? {}) as Record<string, unknown>;

      const answers = Object.entries(obj)
        .map(([key, value]) => {
          const id = fieldIdByKey.get(key);
          if (!id) return null;
          return { eventFormFieldId: id, value };
        })
        .filter(Boolean) as Array<{
        eventFormFieldId: string;
        value?: unknown;
      }>;

      return {
        eventProductId,
        answers: answers.length ? answers : undefined,
      };
    });
  }

  async function doRegister(withToken: string) {
    const items = picked.map(({ p, qty }) => ({
      eventProductId: p.id,
      quantity: qty,
    }));

    const normalizedPromoCode = promoCode.trim();

    const payload = {
      eventId: event.id,
      items,
      attendees: buildAttendeesPayload(),
      buyerEmail: buyerEmail.trim(),
      promoCode: normalizedPromoCode ? normalizedPromoCode : null,
      turnstileToken: withToken,
      checkoutSource: "public",
      termsAccepted: true as const,
      organizerSalesTermsVersion: requiresOrganizerTerms ? org.salesTermsVersion : null,
      platformTermsVersion: "2026-10-01",
    };

    return register(payload as any);
  }

  async function pay() {
    if (!orgSlug || !eventSlug) return;
    if (picked.length === 0) return;
    if (requiresOrganizerTerms && !paidSalesAvailable) return;
    if (!accepted) return;
    if (requiresOrganizerTerms && (!org.salesTermsAccepted || !salesTermsRead))
      return;
    if (attendeesMismatch) return;

    const email = buyerEmail.trim();
    if (!email) return;

    setTurnstileError(null);

    // Si pas de token, on exécute Turnstile et on attend le callback
    if (!turnstileToken) {
      if (!turnstileSiteKey) {
        setTurnstileError("Turnstile non configuré.");
        return;
      }
      setPendingPay(true);
      turnstileRef.current?.execute();
      return;
    }

    let r: any;
    try {
      r = await doRegister(turnstileToken);
    } catch {
      return;
    } finally {
      setPendingPay(false);
      // token one-shot : on le reset pour éviter réutilisation/expiry
      setTurnstileToken(null);
      turnstileRef.current?.reset();
    }

    if (r && typeof r === "object" && "error" in r) {
      return;
    }

    const orderId = typeof r?.orderId === "string" ? r.orderId : null;
    const status = typeof r?.status === "string" ? r.status : null;

    const bookingToken =
      typeof r?.bookingToken === "string" && r.bookingToken.trim()
        ? r.bookingToken.trim()
        : null;

    if (r?.ok === true && status === "paid" && orderId) {
      clearDraft(orgSlug, eventSlug);

      const url = bookingToken
        ? `/order/${orderId}?token=${encodeURIComponent(bookingToken)}&org=${encodeURIComponent(
            orgSlug,
          )}&event=${encodeURIComponent(eventSlug)}`
        : `/order/${orderId}?org=${encodeURIComponent(orgSlug)}&event=${encodeURIComponent(eventSlug)}`;

      navigate(url);
      return;
    }

    if (r?.ok === true && status === "awaiting_payment") {
      const checkoutUrl = r?.checkoutUrl;

      clearDraft(orgSlug, eventSlug);

      if (typeof checkoutUrl === "string" && checkoutUrl.startsWith("http")) {
        window.location.assign(checkoutUrl);
        return;
      }

      if (orderId) {
        navigate(
          `/order/${orderId}?token=${encodeURIComponent(bookingToken ?? "")}&org=${encodeURIComponent(
            orgSlug,
          )}&event=${encodeURIComponent(eventSlug)}`,
        );
      }
      return;
    }

    if (orderId) {
      clearDraft(orgSlug, eventSlug);
      navigate(
        `/order/${orderId}?token=${encodeURIComponent(bookingToken ?? "")}&org=${encodeURIComponent(
          orgSlug,
        )}&event=${encodeURIComponent(eventSlug)}`,
      );
    }
  }

  // Quand on reçoit un token, si l'utilisateur avait cliqué Payer, on relance pay()
  async function onTurnstileToken(token: string) {
    setTurnstileToken(token);
    if (pendingPay) {
      // relance immédiatement le flow
      await pay();
    }
  }

  const charterText =
    typeof event.charterText === "string" ? event.charterText.trim() : "";

  const hasCharter = charterText.length > 0;
  const organizerSalesTerms = org.salesTerms.trim();

  const canPay =
    picked.length > 0 &&
    (!requiresOrganizerTerms || paidSalesAvailable) &&
    accepted &&
    (!requiresOrganizerTerms || (org.salesTermsAccepted && salesTermsRead)) &&
    (!hasCharter || charterRead) &&
    !registering &&
    !pendingPay &&
    !attendeesMismatch &&
    buyerEmail.trim().length > 0;

  return (
    <div className="publicPage">
      <Container>
        <div className="publicSurface">
          <PublicEventHeader
            orgSlug={orgSlug}
            org={org}
            event={event}
            compact
          />

          <PublicCheckoutStepper
            currentStep={3}
            orgSlug={orgSlug}
            eventSlug={eventSlug}
          />

          <div className="publicDivider" />
          <div className="publicSectionHeading">
            <div>
              <div className="publicEyebrow">Dernière étape</div>
              <h2 className="publicSectionTitle">
                {totalCents > 0
                  ? "Vérifiez et payez"
                  : "Confirmez votre réservation"}
              </h2>
            </div>
            <p>Vos billets ne seront réservés qu’après cette validation.</p>
          </div>

          {picked.length === 0 ? (
            <div className="publicEmpty">
              Aucun billet sélectionné. Reviens à l’étape “Billets”.
            </div>
          ) : (
            <div className="publicGutter">
              <div className="publicList publicPaymentList">
                <Card>
                  <CardHeader title="Récap" />
                  <CardBody>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      {picked.map(({ p, qty }) => (
                        <div
                          key={p.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 800 }}>
                              {p.name} × {qty}
                            </div>
                            <div className="publicSubtitle">
                              {p.createsAttendees
                                ? `${p.attendeesPerUnit} participant(s) / billet`
                                : "Pas de participant créé"}
                            </div>
                          </div>
                          <div style={{ fontWeight: 800 }}>
                            {formatMoney(
                              qty * p.priceCents,
                              p.currency ?? "EUR",
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="publicDivider" />

                    <div>
                      <div style={{ fontWeight: 800, marginBottom: 6 }}>
                        Code promo
                      </div>

                      <input
                        value={promoCode}
                        onChange={(e) =>
                          setPromoCode(e.target.value.toUpperCase())
                        }
                        placeholder="ex: CLUB10"
                        maxLength={20}
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          borderRadius: 12,
                          border: "1px solid rgba(0,0,0,0.10)",
                          outline: "none",
                          textTransform: "uppercase",
                        }}
                        disabled={registering || pendingPay}
                      />

                      <div className="publicSubtitle" style={{ marginTop: 6 }}>
                        Si le code est valide, la réduction sera appliquée à la
                        validation.
                      </div>
                    </div>

                    <div className="publicDivider" />

                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <div style={{ fontWeight: 800 }}>
                        {hasDeposit ? "À payer maintenant" : "Total"}
                      </div>
                      <div style={{ fontWeight: 800 }}>
                        {formatMoney(dueNowCentsUi, currency)}
                      </div>
                    </div>

                    {hasDeposit ? (
                      <>
                        <div
                          className="publicSubtitle"
                          style={{ marginTop: 6 }}
                        >
                          Total commande : {formatMoney(totalCents, currency)}
                        </div>
                        <div
                          className="publicSubtitle"
                          style={{ marginTop: 2 }}
                        >
                          Le solde sera à régler plus tard (selon les modalités
                          de l’organisateur).
                        </div>
                      </>
                    ) : null}

                    <div className="publicSubtitle" style={{ marginTop: 6 }}>
                      Participants à renseigner : {attendeesCount}
                    </div>

                    {attendeesMismatch ? (
                      <div className="publicEmpty" style={{ marginTop: 12 }}>
                        Oups : le nombre de participants ne correspond pas aux
                        billets sélectionnés. Reviens à l’étape “Participants”.
                      </div>
                    ) : null}
                  </CardBody>
                </Card>

                {hasCharter ? (
                  <Card>
                    <CardHeader title="Charte de l’événement" />
                    <CardBody>
                      <div
                        className="publicSubtitle"
                        style={{ marginBottom: 12 }}
                      >
                        L’organisateur demande de lire et d’accepter la charte
                        avant de confirmer l’inscription.
                      </div>

                      <Button
                        variant="secondary"
                        label={
                          charterRead ? "Relire la charte" : "Lire la charte"
                        }
                        onClick={() => setCharterOpen(true)}
                        disabled={registering || pendingPay}
                      />

                      {!charterRead ? (
                        <div className="publicEmpty" style={{ marginTop: 12 }}>
                          Vous devez lire la charte avant de pouvoir accepter
                          les conditions.
                        </div>
                      ) : null}
                    </CardBody>
                  </Card>
                ) : null}

                {requiresOrganizerTerms ? (
                  <Card>
                    <CardHeader title="Vendeur et conditions de l’organisateur" />
                    <CardBody>
                      {!paidSalesAvailable ? (
                        <div
                          className="publicEmpty"
                          style={{ marginBottom: 12 }}
                        >
                          Les paiements sont temporairement indisponibles pour
                          cet organisateur.
                        </div>
                      ) : null}
                      <div
                        className="publicSubtitle"
                        style={{ marginBottom: 12 }}
                      >
                        Les billets sont vendus par{" "}
                        <strong>{org.displayName}</strong>. Le paiement est
                        encaissé directement sur son compte Stripe. Eventflow
                        fournit la plateforme technique et n’est pas le vendeur.
                      </div>
                      <div
                        className="publicSubtitle"
                        style={{ marginBottom: 12 }}
                      >
                        <SellerIdentity org={org} />
                        Contact :{" "}
                        {org.publicEmail ? (
                          <a href={`mailto:${org.publicEmail}`}>
                            {org.publicEmail}
                          </a>
                        ) : (
                          "à compléter par l’organisateur"
                        )}
                      </div>
                      <Button
                        variant="secondary"
                        label={
                          salesTermsRead
                            ? "Relire les conditions"
                            : "Lire les conditions"
                        }
                        onClick={() => setSalesTermsOpen(true)}
                        disabled={
                          registering || pendingPay || !org.salesTermsAccepted
                        }
                      />
                      {!org.salesTermsAccepted && requiresOrganizerTerms ? (
                        <div className="publicEmpty" style={{ marginTop: 12 }}>
                          Les paiements sont temporairement indisponibles :
                          l’organisateur doit valider ses conditions de vente et
                          son contact public.
                        </div>
                      ) : !salesTermsRead && requiresOrganizerTerms ? (
                        <div className="publicEmpty" style={{ marginTop: 12 }}>
                          Vous devez lire les conditions de l’organisateur avant
                          de confirmer.
                        </div>
                      ) : null}
                    </CardBody>
                  </Card>
                ) : null}

                <Card>
                  <CardHeader title="Contact & validation" />
                  <CardBody>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 800, marginBottom: 6 }}>
                          Email acheteur
                        </div>
                        <input
                          value={buyerEmail}
                          onChange={(e) => setBuyerEmail(e.target.value)}
                          placeholder="ex: moi@email.com"
                          style={{
                            width: "100%",
                            padding: "10px 12px",
                            borderRadius: 12,
                            border: "1px solid rgba(0,0,0,0.10)",
                            outline: "none",
                          }}
                          disabled={registering || pendingPay}
                        />
                      </div>

                      {turnstileSiteKey ? (
                        <div>
                          <div style={{ fontWeight: 800, marginBottom: 6 }}>
                            Validation anti-bot
                          </div>
                          <Turnstile
                            ref={turnstileRef}
                            siteKey={turnstileSiteKey}
                            onToken={onTurnstileToken}
                            onError={() => {
                              setPendingPay(false);
                              setTurnstileToken(null);
                              setTurnstileError(
                                "Impossible de valider (Turnstile). Réessaie ou recharge la page.",
                              );
                            }}
                            onExpired={() => {
                              setPendingPay(false);
                              setTurnstileToken(null);
                              setTurnstileError(
                                "Validation expirée. Réessaie.",
                              );
                            }}
                          />
                          {turnstileError ? (
                            <div
                              className="publicEmpty"
                              style={{ marginTop: 10 }}
                            >
                              {turnstileError}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="publicEmpty">
                          Turnstile non configuré (VITE_TURNSTILE_SITEKEY
                          manquant).
                        </div>
                      )}

                      <label
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "center",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={accepted}
                          onChange={(e) => setAccepted(e.target.checked)}
                          style={{ width: 18, height: 18 }}
                          disabled={
                            registering ||
                            pendingPay ||
                            (requiresOrganizerTerms &&
                              (!org.salesTermsAccepted || !salesTermsRead)) ||
                            (hasCharter && !charterRead)
                          }
                        />
                        <span style={{ fontWeight: 700 }}>
                          J’accepte{" "}
                          {requiresOrganizerTerms
                            ? "les conditions de " + org.displayName + ", "
                            : ""}
                          les{" "}
                          <a href="/conditions-billetterie" target="_blank" rel="noreferrer">
                            Conditions de billetterie Eventflow
                          </a>{" "}
                          et je prends connaissance de la{" "}
                          <a
                            href="/politique-confidentialite"
                            target="_blank"
                            rel="noreferrer"
                          >
                            politique de confidentialité
                          </a>
                          , et je confirme l’achat.
                        </span>
                      </label>

                      {registerError ? (
                        <div className="publicEmpty">
                          Erreur : {formatRegisterError(registerError)}
                        </div>
                      ) : null}
                    </div>
                  </CardBody>
                </Card>
              </div>
            </div>
          )}

          <div className="publicDivider" />

          <div className="publicBackActions">
            <Button
              variant="secondary"
              label="Retour aux participants"
              onClick={goBack}
              disabled={registering || pendingPay}
            />
          </div>
        </div>
      </Container>
      <PublicStickyCheckoutBar
        amountCents={dueNowCentsUi}
        currency={currency}
        primaryText={hasDeposit ? "À payer maintenant" : "Total"}
        secondaryText={
          hasDeposit
            ? `Total commande : ${formatMoney(totalCents, currency)}`
            : `${picked.reduce((acc, x) => acc + x.qty, 0)} billet(s)`
        }
        onClick={pay}
        disabled={!canPay}
        ctaLabel={stickyCtaLabel}
      />

      {charterOpen ? (
        <PublicCharterModal
          open={charterOpen}
          markdown={charterText}
          onClose={() => setCharterOpen(false)}
          onConfirmRead={() => {
            setCharterRead(true);
            setCharterOpen(false);
          }}
        />
      ) : null}
      {salesTermsOpen && org.salesTermsAccepted ? (
        <PublicCharterModal
          open={salesTermsOpen}
          markdown={organizerSalesTerms}
          title={`Conditions de ${org.displayName}`}
          confirmLabel="J’ai lu les conditions"
          onClose={() => setSalesTermsOpen(false)}
          onConfirmRead={() => {
            setSalesTermsRead(true);
            setSalesTermsOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function formatRegisterError(error: string): string {
  switch (error) {
    case "PROMO_CODE_NOT_FOUND":
      return "Ce code promo n’existe pas pour cet événement.";
    case "PROMO_CODE_INACTIVE":
      return "Ce code promo n’est pas actif.";
    case "PROMO_CODE_NOT_STARTED":
      return "Ce code promo n’est pas encore valable.";
    case "PROMO_CODE_EXPIRED":
      return "Ce code promo a expiré.";
    case "PROMO_CODE_USAGE_LIMIT_REACHED":
      return "Ce code promo a déjà atteint sa limite d’utilisation.";
    case "PROMO_CODE_NOT_APPLICABLE":
      return "Ce code promo ne peut pas être appliqué à cette commande.";
    case "PROMO_CODE_INVALID":
      return "Ce code promo est invalide.";
    default:
      return error;
  }
}
