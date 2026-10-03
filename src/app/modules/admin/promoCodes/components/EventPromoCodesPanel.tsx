import { useEffect, useRef, useState, type SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import Button from "@ui/components/button/Button";
import { useToast } from "@shared/ui/components/toast/useToast";

import { useAdminPromoCodes } from "../hooks/useAdminPromoCodes";
import type { AdminEventDetailEvent } from "../../singleEvent/schemas/admin.eventDetail.schema";
import type { DbPromoCode } from "@shared/models/db/db.promoCode.schema";

type DiscountType = "percent" | "fixed";

type Draft = {
  code: string;
  discountType: DiscountType;
  discountPercent: string;
  discountEuros: string;
  maxUses: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
};

const EMPTY_DRAFT: Draft = {
  code: "",
  discountType: "percent",
  discountPercent: "10",
  discountEuros: "",
  maxUses: "",
  startsAt: "",
  endsAt: "",
  isActive: true,
};

export function EventPromoCodesPanel(props: {
  supabase: SupabaseClient;
  orgId: string | null;
  event: AdminEventDetailEvent;
  onChanged: () => Promise<void>;
}) {
  const { supabase, orgId, event, onChanged } = props;

  const promoCodes = useAdminPromoCodes({ supabase, orgId, eventId: event.id });
  const { loadPromoCodes, isCurrentScope, getError, getGeneration } = promoCodes;
  const draftRevisionRef = useRef(0);

  const [draft, setDraftState] = useState<Draft>(EMPTY_DRAFT);
  function setDraft(next: SetStateAction<Draft>) {
    draftRevisionRef.current++;
    setDraftState(next);
  }

  const { showToast } = useToast();

  useEffect(() => {
    if (!event.id || !isCurrentScope()) return;
    const pending = loadPromoCodes({ eventId: event.id });
    const request = getGeneration();
    void pending.then(() => {
      if (!isCurrentScope() || request !== getGeneration()) return;
      const error = getError();
      if (error) showToast({ title: "Erreur", description: error, variant: "error", duration: 6000 });
    });
  }, [event.id, loadPromoCodes, isCurrentScope, getError, getGeneration, showToast]);

  function showCurrentError() {
    const error = getError();
    if (error) showToast({ title: "Erreur", description: error, variant: "error", duration: 6000 });
  }

  async function handleCreate() {
    if (!isCurrentScope() || promoCodes.loading || promoCodes.saving || promoCodes.deleting) return;
    const revision = draftRevisionRef.current;
    if (!orgId) {
      showToast({
        title: "Organisation introuvable",
        description: "Impossible de créer un code promo sans organisation.",
        variant: "error",
        duration: 6000,
      });
      return;
    }

    const discountPercent =
      draft.discountType === "percent" ? toNullableInt(draft.discountPercent) : null;

    const discountCents =
      draft.discountType === "fixed" ? eurosToCents(draft.discountEuros) : null;

    const pending = promoCodes.createPromoCode({
      orgId,
      eventId: event.id,
      code: draft.code,
      discountPercent,
      discountCents,
      maxUses: toNullableInt(draft.maxUses),
      startsAt: dateTimeLocalToIsoOrNull(draft.startsAt),
      endsAt: dateTimeLocalToIsoOrNull(draft.endsAt),
      isActive: draft.isActive,
    });

    const request = getGeneration();
    const created = await pending;
    if (!isCurrentScope() || request !== getGeneration() || revision !== draftRevisionRef.current) return;
    if (!created) { showCurrentError(); return; }

    setDraft(EMPTY_DRAFT);

    showToast({
      title: "Code promo créé",
      description: `Le code ${created.code} est maintenant disponible.`,
      variant: "success",
      duration: 3500,
    });

    await onChanged();
    if (!isCurrentScope()) return;
  }

  async function handleToggleActive(code: DbPromoCode) {
    if (!isCurrentScope() || promoCodes.saving || promoCodes.deleting) return;
    const pending = promoCodes.updatePromoCode({
      promoCodeId: code.id,
      patch: {
        isActive: !code.isActive,
      },
    });

    const request = getGeneration();
    const updated = await pending;
    if (!isCurrentScope() || request !== getGeneration()) return;
    if (!updated) { showCurrentError(); return; }

    showToast({
      title: updated.isActive ? "Code promo activé" : "Code promo désactivé",
      description: `Le code ${updated.code} a été mis à jour.`,
      variant: "success",
      duration: 3500,
    });

    await onChanged();
    if (!isCurrentScope()) return;
  }

  async function handleDelete(code: DbPromoCode) {
    if (!isCurrentScope() || promoCodes.saving || promoCodes.deleting) return;
    if (code.usedCount > 0) {
      showToast({
        title: "Suppression impossible",
        description: "Ce code a déjà été utilisé. Désactive-le plutôt que de le supprimer.",
        variant: "error",
        duration: 6000,
      });
      return;
    }

    const pending = promoCodes.deletePromoCode({
      id: code.id,
    });

    const request = getGeneration();
    const ok = await pending;
    if (!isCurrentScope() || request !== getGeneration()) return;
    if (!ok) { showCurrentError(); return; }

    showToast({
      title: "Code promo supprimé",
      description: `Le code ${code.code} a été supprimé.`,
      variant: "success",
      duration: 3500,
    });

    await onChanged();
    if (!isCurrentScope()) return;
  }

  return (
    <section className="adminSubSection adminSingleEventPromoCodes">
      <div className="adminSectionHeader">
        <div>
          <h3>Codes promo</h3>
          <p>Crée des réductions applicables lors de l’inscription à cet événement.</p>
        </div>
      </div>


      <div className="adminPromoCreateCard">
        <h4>Nouveau code</h4>

        <div className="adminEventDetails">
            <div className="adminEventFormGrid">
            <div className="adminEventField">
                <div className="adminEventLabel">Code</div>
                <input
                className="adminEventInput"
                value={draft.code}
                maxLength={20}
                placeholder="CLUB10"
                onChange={(e) =>
                    setDraft((d) => ({
                    ...d,
                    code: e.target.value.toUpperCase(),
                    }))
                }
                />
                <div className="adminEventHint">
                20 caractères maximum. Le code sera insensible à la casse.
                </div>
            </div>

            <div className="adminEventField">
                <div className="adminEventLabel">Type de réduction</div>
                <select
                className="adminEventInput"
                value={draft.discountType}
                onChange={(e) =>
                    setDraft((d) => ({
                    ...d,
                    discountType: e.target.value as DiscountType,
                    }))
                }
                >
                <option value="percent">Pourcentage</option>
                <option value="fixed">Montant fixe</option>
                </select>
            </div>

            {draft.discountType === "percent" ? (
                <div className="adminEventField">
                <div className="adminEventLabel">Réduction (%)</div>
                <input
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    inputMode="numeric"
                    className="adminEventInput"
                    value={draft.discountPercent}
                    onChange={(e) =>
                    setDraft((d) => ({
                        ...d,
                        discountPercent: e.target.value,
                    }))
                    }
                />
                <div className="adminEventHint">Entre 1 et 100 %.</div>
                </div>
            ) : (
                <div className="adminEventField">
                <div className="adminEventLabel">Réduction (€)</div>
                <input
                    type="number"
                    min={0.01}
                    max={1000}
                    step={0.01}
                    inputMode="decimal"
                    className="adminEventInput"
                    placeholder="10,00"
                    value={draft.discountEuros}
                    onChange={(e) =>
                    setDraft((d) => ({
                        ...d,
                        discountEuros: e.target.value,
                    }))
                    }
                />
                <div className="adminEventHint">Montant déduit du total de la commande.</div>
                </div>
            )}

            <div className="adminEventField">
                <div className="adminEventLabel">Utilisations max</div>
                <input
                type="number"
                min={1}
                max={99999}
                step={1}
                inputMode="numeric"
                className="adminEventInput"
                placeholder="Illimité"
                value={draft.maxUses}
                onChange={(e) =>
                    setDraft((d) => ({
                    ...d,
                    maxUses: e.target.value,
                    }))
                }
                />
                <div className="adminEventHint">Vide = utilisations illimitées.</div>
            </div>

            <div className="adminEventField">
                <div className="adminEventLabel">Début</div>
                <input
                type="datetime-local"
                className="adminEventInput"
                value={draft.startsAt}
                onChange={(e) =>
                    setDraft((d) => ({
                    ...d,
                    startsAt: e.target.value,
                    }))
                }
                />
                <div className="adminEventHint">Vide = actif immédiatement.</div>
            </div>

            <div className="adminEventField">
                <div className="adminEventLabel">Fin</div>
                <input
                type="datetime-local"
                className="adminEventInput"
                value={draft.endsAt}
                onChange={(e) =>
                    setDraft((d) => ({
                    ...d,
                    endsAt: e.target.value,
                    }))
                }
                />
                <div className="adminEventHint">Vide = pas de date de fin.</div>
            </div>

            <div className="adminEventField adminPromoActiveField">
                <label className="adminRegCheckRow">
                <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(e) =>
                    setDraft((d) => ({
                        ...d,
                        isActive: e.target.checked,
                    }))
                    }
                />
                <span>Actif</span>
                </label>
            </div>
            </div>
        </div>

        <div className="adminPromoCreateActions">
            <Button
            type="button"
            onClick={handleCreate}
            disabled={promoCodes.loading || promoCodes.saving || !canCreatePromoCode(draft, Boolean(orgId))}
            >
            {promoCodes.saving ? "Création…" : "Créer le code"}
            </Button>
        </div>
        </div>

      {promoCodes.loading ? (
        <p>Chargement…</p>
      ) : promoCodes.promoCodes.length === 0 ? (
        <p>Aucun code promo pour cet événement.</p>
      ) : (
        <div className="adminPromoListCard">
              <table className="adminPromoTable">
            <thead>
              <tr>
                <th>Code</th>
                <th>Réduction</th>
                <th>Utilisations</th>
                <th>Validité</th>
                <th>Statut</th>
                <th />
              </tr>
            </thead>

            <tbody>
              {promoCodes.promoCodes.map((code) => (
                <tr key={code.id}>
                  <td>
                    <strong>{code.code}</strong>
                  </td>

                  <td>{formatDiscount(code)}</td>

                  <td>
                    {code.usedCount}
                    {code.maxUses ? ` / ${code.maxUses}` : ""}
                  </td>

                  <td>{formatValidity(code)}</td>

                  <td><span className={`adminPromoPill ${code.isActive ? "isActive" : "isInactive"}`}>
                    {code.isActive ? "Actif" : "Inactif"}
                    </span></td>

                  <td>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <Button
                        type="button"
                        onClick={() => handleToggleActive(code)}
                        disabled={promoCodes.saving}
                      >
                        {code.isActive ? "Désactiver" : "Activer"}
                      </Button>

                      {code.usedCount === 0 && (
                        <Button
                          type="button"
                          onClick={() => handleDelete(code)}
                          disabled={promoCodes.deleting}
                        >
                          Supprimer
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function canCreatePromoCode(draft: Draft, hasOrgId: boolean): boolean {
  if (!hasOrgId) return false;
  if (!draft.code.trim()) return false;

  if (draft.discountType === "percent") {
    const n = Number(draft.discountPercent);
    return Number.isInteger(n) && n >= 1 && n <= 100;
  }

  const cents = eurosToCents(draft.discountEuros);
  return cents !== null && cents >= 1 && cents <= 100_000;
}

function toNullableInt(value: string): number | null {
  const t = value.trim();
  if (!t) return null;

  const n = Number(t);
  if (!Number.isInteger(n)) return null;

  return n;
}

function eurosToCents(value: string): number | null {
  const t = value.trim().replace(",", ".");
  if (!t) return null;

  const n = Number(t);
  if (!Number.isFinite(n)) return null;

  return Math.round(n * 100);
}

function dateTimeLocalToIsoOrNull(value: string): string | null {
  const t = value.trim();
  if (!t) return null;

  const d = new Date(t);
  if (!Number.isFinite(d.getTime())) return null;

  return d.toISOString();
}

function formatDiscount(code: DbPromoCode): string {
  if (typeof code.discountPercent === "number") {
    return `${code.discountPercent} %`;
  }

  if (typeof code.discountCents === "number") {
    return formatMoney(code.discountCents);
  }

  return "—";
}

function formatValidity(code: DbPromoCode): string {
  if (!code.startsAt && !code.endsAt) return "Toujours";

  const start = code.startsAt ? formatDateTime(code.startsAt) : "maintenant";
  const end = code.endsAt ? formatDateTime(code.endsAt) : "sans fin";

  return `${start} → ${end}`;
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("fr-BE", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("fr-BE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}
