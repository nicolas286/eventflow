import { EVENTFLOW_BUYER_TERMS_VERSION } from "../../../../../../shared/legal/documents";
import { SellerIdentity } from "../../register/components/SellerIdentity";
import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";

import { supabase } from "@gateways/supabase/supabaseClient";
import { usePublicEventDetail } from "../../events/hooks/usePublicEventDetail";
import { useWidgetTheme } from "../hooks/useWidgetTheme";

import { Button } from "@shared/ui/components";
import { Turnstile, type TurnstileRef } from "@ui/components/Turnstile";
import { MessageBox } from "@ui/components/message/MessageBox";
import { useWidgetAutoResize } from "../hooks/useWidgetAutoResize";
import { WidgetHeader } from "../components/WidgetHeader/WidgetHeader";

import {
  clearDraft,
  formatMoney,
  loadDraft,
  saveDraft,
  type CheckoutDraft,
} from "../../register/helpers/checkoutStore";

import { useRegister } from "../../register/hooks/useRegister";

import "./WidgetPaymentPage.css";
import { WidgetFooter } from "../components/WidgetFooter/WidgetFooter";
import { WidgetRoot } from "../components/WidgetRoot/WidgetRoot";
import { PublicCharterModal } from "../../register/components/PublicCharterModal/PublicCharterModal";

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

export function WidgetPaymentPage() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const theme = useWidgetTheme();
  useWidgetAutoResize();

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

  const widgetReturnUrl = useMemo(() => {
    if (!orgSlug || !eventSlug) return null;
    return `${window.location.origin}/widget/o/${orgSlug}/e/${eventSlug}/confirmation${search}`;
  }, [orgSlug, eventSlug, search]);

  const [tick, setTick] = useState(0);

  const draft = useMemo(() => {
    if (!orgSlug || !eventSlug) return null;
    void tick;
    return ensureDraft(orgSlug, eventSlug);
  }, [orgSlug, eventSlug, tick]);

  const [buyerEmail, setBuyerEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const [pendingPay, setPendingPay] = useState(false);
  const [salesTermsOpen, setSalesTermsOpen] = useState(false);
  const termsKey = `${orgSlug}:${eventSlug}:${data?.org.salesTermsVersion ?? ""}:${EVENTFLOW_BUYER_TERMS_VERSION}`;
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
    return <div className="widgetRoot">Chargement…</div>;
  }

  if (error) {
    return <div className="widgetRoot">Erreur : {error}</div>;
  }

  if (!data?.event) {
    return <div className="widgetRoot">Événement introuvable.</div>;
  }

  if (!draft) {
    return <div className="widgetRoot">Draft introuvable.</div>;
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

  function setAccepted(next: boolean) {
    if (!orgSlug || !eventSlug) return;
    const current = ensureDraft(orgSlug, eventSlug);
    setAcceptedTermsKey(next ? termsKey : null);
    persistDraft({ ...current, acceptedTerms: next });
  }

  function goBack() {
    navigate(`/widget/o/${orgSlug}/e/${eventSlug}/participants${search}`);
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

    const payload = {
      eventId: event.id,
      items,
      attendees: buildAttendeesPayload(),
      buyerEmail: buyerEmail.trim(),
      turnstileToken: withToken,
      widgetReturnUrl: widgetReturnUrl ?? undefined,
      checkoutSource: "widget" as const,
      termsAccepted: true as const,
      organizerSalesTermsVersion: requiresOrganizerTerms ? org.salesTermsVersion : null,
      platformTermsVersion: EVENTFLOW_BUYER_TERMS_VERSION,
    };

    return register(payload);
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

    if (!turnstileToken) {
      if (!turnstileSiteKey) {
        setTurnstileError("Turnstile non configuré.");
        return;
      }
      setPendingPay(true);
      turnstileRef.current?.execute();
      return;
    }

    let r: Awaited<ReturnType<typeof doRegister>>;
    try {
      r = await doRegister(turnstileToken);
    } catch {
      return;
    } finally {
      setPendingPay(false);
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
      const confirmationKey = `eventflow:widget:confirmation:${orgSlug}:${eventSlug}`;

      const confirmationData = {
        orderId,
        buyerEmail: buyerEmail.trim(),
        totalCents,
        currency,
        totalTickets: picked.reduce((acc, x) => acc + x.qty, 0),
        eventTitle: event.title,
        bookingToken,
        status,
        items: picked.map(({ p, qty }) => ({
          name: p.name,
          quantity: qty,
          totalCents: qty * p.priceCents,
          currency: p.currency ?? currency,
        })),
      };

      sessionStorage.setItem(confirmationKey, JSON.stringify(confirmationData));

      clearDraft(orgSlug, eventSlug);
      navigate(`/widget/o/${orgSlug}/e/${eventSlug}/confirmation${search}`);
      return;
    }

    if (r?.ok === true && r.status === "awaiting_payment") {
      const checkoutUrl = "checkoutUrl" in r ? r.checkoutUrl : null;

      clearDraft(orgSlug, eventSlug);

      if (r?.paymentMethod === "bank_transfer" && orderId) {
        const confirmationKey = `eventflow:widget:confirmation:${orgSlug}:${eventSlug}`;
        sessionStorage.setItem(
          confirmationKey,
          JSON.stringify({
            orderId,
            buyerEmail: buyerEmail.trim(),
            totalCents,
            currency,
            totalTickets: picked.reduce((acc, x) => acc + x.qty, 0),
            eventTitle: event.title,
            bookingToken,
            status,
            paymentMethod: "bank_transfer",
            bankTransfer: r.bankTransfer,
            items: picked.map(({ p, qty }) => ({
              name: p.name,
              quantity: qty,
              totalCents: qty * p.priceCents,
              currency: p.currency ?? currency,
            })),
          }),
        );
        const confirmationSearch = new URLSearchParams(search);
        for (const key of ["orderId", "token", "bookingToken"])
          confirmationSearch.delete(key);
        if (bookingToken) {
          confirmationSearch.set("orderId", orderId);
          confirmationSearch.set("token", bookingToken);
        }
        const query = confirmationSearch.toString();
        navigate(
          `/widget/o/${orgSlug}/e/${eventSlug}/confirmation${query ? `?${query}` : ""}`,
        );
        return;
      }

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

  async function onTurnstileToken(token: string) {
    setTurnstileToken(token);
    if (pendingPay) {
      await pay();
    }
  }

  const canPay =
    picked.length > 0 &&
    (!requiresOrganizerTerms || paidSalesAvailable) &&
    accepted &&
    (!requiresOrganizerTerms || (org.salesTermsAccepted && salesTermsRead)) &&
    !registering &&
    !pendingPay &&
    !attendeesMismatch &&
    buyerEmail.trim().length > 0;

  return (
    <WidgetRoot theme={theme}>
      <WidgetHeader
        left={
          <Button
            className="widgetButton"
            variant="ghost"
            label="← Retour"
            onClick={goBack}
          />
        }
        title={event.title}
      />

      {picked.length === 0 ? (
        <div className="widgetEmpty">
          Aucun billet sélectionné. Reviens à l’étape billets.
        </div>
      ) : (
        <div className="widgetPaymentLayout">
          <div className="widgetPaymentCard">
            <div className="widgetSectionTitle">Récap</div>

            <div className="widgetPaymentRows">
              {picked.map(({ p, qty }) => (
                <div key={p.id} className="widgetPaymentRow">
                  <div>
                    <div className="widgetPaymentRowTitle">
                      {p.name} × {qty}
                    </div>
                    <div className="widgetPaymentRowSub">
                      {p.createsAttendees
                        ? `${p.attendeesPerUnit} participant(s) / billet`
                        : "Pas de participant créé"}
                    </div>
                  </div>
                  <div className="widgetPaymentAmount">
                    {formatMoney(qty * p.priceCents, p.currency ?? "EUR")}
                  </div>
                </div>
              ))}
            </div>

            <div className="widgetDivider" />

            <div className="widgetPaymentTotalRow">
              <div>{hasDeposit ? "À payer maintenant" : "Total"}</div>
              <div>{formatMoney(dueNowCentsUi, currency)}</div>
            </div>

            {hasDeposit ? (
              <div className="widgetPaymentInfos">
                <div>Total commande : {formatMoney(totalCents, currency)}</div>
                <div>
                  Le solde sera à régler plus tard selon les modalités de
                  l’organisateur.
                </div>
              </div>
            ) : null}

            <div className="widgetPaymentInfos">
              Participants à renseigner : {attendeesCount}
            </div>

            {attendeesMismatch ? (
              <MessageBox variant="error">
                Oups : le nombre de participants ne correspond pas aux billets
                sélectionnés. Reviens à l’étape participants.
              </MessageBox>
            ) : null}
          </div>

          {requiresOrganizerTerms ? (
            <div className="widgetPaymentCard">
              <div className="widgetSectionTitle">Vendeur et conditions</div>
              {!paidSalesAvailable ? (
                <MessageBox variant="error">
                  Les paiements sont temporairement indisponibles pour cet organisateur.
                </MessageBox>
              ) : null}
              <div className="widgetPaymentInfos">
                Billets vendus par <strong>{org.displayName}</strong>. Paiement
                encaissé directement sur son compte Stripe. Eventflow n’est pas
                le vendeur.
              </div>
              <div className="widgetPaymentInfos">
                <SellerIdentity org={org} />
                Contact :{" "}
                {org.publicEmail ? (
                  <a href={`mailto:${org.publicEmail}`}>{org.publicEmail}</a>
                ) : (
                  "à compléter par l’organisateur"
                )}
              </div>
              <Button
                className="widgetButton"
                variant="secondary"
                label={
                  salesTermsRead
                    ? "Relire les conditions"
                    : "Lire les conditions"
                }
                onClick={() => setSalesTermsOpen(true)}
                disabled={registering || pendingPay || !org.salesTermsAccepted}
              />
              {!org.salesTermsAccepted && requiresOrganizerTerms ? (
                <MessageBox variant="error">
                  Paiement temporairement indisponible : l’organisateur doit
                  valider ses conditions et son contact public.
                </MessageBox>
              ) : !salesTermsRead && requiresOrganizerTerms ? (
                <MessageBox variant="info">
                  Lisez les conditions de l’organisateur avant de confirmer.
                </MessageBox>
              ) : null}
            </div>
          ) : null}

          <div className="widgetPaymentCard">
            <div className="widgetSectionTitle">Contact & validation</div>

            <div className="widgetPaymentForm">
              <div className="widgetFieldBlock">
                <div className="widgetFieldLabel">Email acheteur</div>
                <input
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                  placeholder="ex: moi@email.com"
                  className="widgetFieldControl"
                  disabled={registering || pendingPay}
                />
              </div>

              {turnstileSiteKey ? (
                <div className="widgetFieldBlock">
                  <div className="widgetFieldLabel">Validation anti-bot</div>
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
                      setTurnstileError("Validation expirée. Réessaie.");
                    }}
                  />
                  {turnstileError ? (
                    <MessageBox variant="error">{turnstileError}</MessageBox>
                  ) : null}
                </div>
              ) : (
                <MessageBox variant="error">
                  Turnstile non configuré.
                </MessageBox>
              )}

              <label className="widgetCheckboxRow">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  disabled={
                    registering ||
                    pendingPay ||
                    (requiresOrganizerTerms &&
                      (!org.salesTermsAccepted || !salesTermsRead))
                  }
                />
                <span>
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
                <MessageBox variant="error">
                  Erreur : {registerError}
                </MessageBox>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <div className="widgetRecap widgetRecapActions">
        <Button
          className="widgetButton"
          variant="secondary"
          label="Retour"
          onClick={goBack}
          disabled={registering || pendingPay}
        />
        <Button
          className="widgetButton"
          label={
            totalCents === 0
              ? registering || pendingPay
                ? "Validation…"
                : "Confirmer"
              : registering || pendingPay
                ? "Paiement…"
                : `Payer ${formatMoney(dueNowCentsUi, currency)}`
          }
          onClick={pay}
          disabled={!canPay}
        />
      </div>

      <WidgetFooter />
      {salesTermsOpen && org.salesTermsAccepted ? (
        <PublicCharterModal
          open={salesTermsOpen}
          markdown={org.salesTerms}
          title={`Conditions de ${org.displayName}`}
          confirmLabel="J’ai lu les conditions"
          onClose={() => setSalesTermsOpen(false)}
          onConfirmRead={() => {
            setSalesTermsRead(true);
            setSalesTermsOpen(false);
          }}
        />
      ) : null}
    </WidgetRoot>
  );
}

export default WidgetPaymentPage;
