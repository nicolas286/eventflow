import type { RefObject, Dispatch, SetStateAction } from "react";

import { Button, Input } from "@ui/components";
import { localDateTimeMinNow } from "@helpers/dateTime";

import type { UpdateEventFullPatch } from "../../schemas/admin.updateEventFullPatch.schema";
import { MarkdownRichTextarea } from "@shared/ui/components/inputs/MarkdownRichTextArea";
import { MessageBox } from "@shared/ui/components/message/MessageBox";

type FieldErrors = Partial<Record<keyof UpdateEventFullPatch, string>>;

export type EventDetailsDraft = {
  title: string;
  location: string;
  description: string;
  charterText: string;
  startsAtLocal: string;
  endsAtLocal: string;
  registrationDeadlineLocal: string;
  bannerUrlRaw: string;
  depositEurosRaw: string;
  maxAttendeesRaw: string;
};

type Props = {
  draft: EventDetailsDraft;
  setDraft: Dispatch<SetStateAction<EventDetailsDraft>>;
  fieldErrors: FieldErrors;

  bannerPreviewUrl: string | null;
  bannerFile: File | null;
  hasCustomBannerNow: boolean;

  fileInputRef: RefObject<HTMLInputElement | null>;
  openBannerPicker: () => void;
  onBannerPicked: (file: File) => void;
  clearBanner: () => void;
};

export function EventDetailsFields(props: Props) {
  const {
    draft,
    setDraft,
    fieldErrors,
    bannerPreviewUrl,
    bannerFile,
    hasCustomBannerNow,
    fileInputRef,
    openBannerPicker,
    onBannerPicked,
    clearBanner,
  } = props;

  return (
    <>
    <div className="adminEventDetails">
      <div className="adminEventFormGrid">
        <div className="adminEventField">
          <div className="adminEventLabel">Titre</div>
          <input
            className="adminEventInput"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
          {fieldErrors.title ? <MessageBox variant="error">{fieldErrors.title}</MessageBox> : null}
        </div>

        <div className="adminEventField">
          <div className="adminEventLabel">Lieu</div>
          <input
            className="adminEventInput"
            value={draft.location}
            onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
          />
          {fieldErrors.location ? <MessageBox variant="error">{fieldErrors.location}</MessageBox> : null}
        </div>

        <div className="adminEventField adminEventFieldSpan2">
  <details className="adminEventDropdown" open={Boolean(draft.description.trim())}>
            <summary className="adminEventDropdownSummary">
              <span>Description</span>
              {draft.description.trim() ? <small>Renseignée</small> : <small>Vide</small>}
            </summary>

            <div className="adminEventDropdownBody">
              <MarkdownRichTextarea
                value={draft.description}
                onChange={(next) => setDraft((d) => ({ ...d, description: next }))}
                error={fieldErrors.description ?? null}
              />
            </div>
          </details>
        </div>

        <div className="adminEventField adminEventFieldSpan2">
          <details className="adminEventDropdown" open={Boolean(draft.charterText.trim())}>
            <summary className="adminEventDropdownSummary">
              <span>Charte / règlement de l’événement</span>
              {draft.charterText.trim() ? <small>Renseignée</small> : <small>Vide</small>}
            </summary>

            <div className="adminEventDropdownBody">
              <MarkdownRichTextarea
                value={draft.charterText}
                onChange={(next) => setDraft((d) => ({ ...d, charterText: next }))}
                error={fieldErrors.charterText ?? null}
              />

              <div className="adminEventHint">
                Si une charte est renseignée, les participants devront la lire et l’accepter avant l’inscription.
              </div>
            </div>
          </details>
        </div>

        <div className="adminEventField adminEventLeftCol">
          <div className="adminEventLabel">Début</div>
          <input
            type="datetime-local"
            className="adminEventInput"
            min={localDateTimeMinNow()}
            value={draft.startsAtLocal}
            onChange={(e) => setDraft((d) => ({ ...d, startsAtLocal: e.target.value }))}
          />
          {fieldErrors.startsAt ? <MessageBox variant="error">{fieldErrors.startsAt}</MessageBox> : null}
        </div>

        <div className="adminEventField adminEventLeftCol">
          <div className="adminEventLabel">Fin (optionnel)</div>
          <input
            type="datetime-local"
            min={localDateTimeMinNow()}
            className="adminEventInput"
            value={draft.endsAtLocal}
            onChange={(e) => setDraft((d) => ({ ...d, endsAtLocal: e.target.value }))}
          />
          {fieldErrors.endsAt ? <MessageBox variant="error">{fieldErrors.endsAt}</MessageBox> : null}
        </div>

        <div className="adminEventField adminEventLeftCol">
          <div className="adminEventLabel">Clôture des inscriptions (optionnel)</div>
          <input
            type="datetime-local"
            min={localDateTimeMinNow()}
            className="adminEventInput"
            value={draft.registrationDeadlineLocal}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                registrationDeadlineLocal: e.target.value,
              }))
            }
          />
          {fieldErrors.registrationDeadline ? (
            <MessageBox variant="error">{fieldErrors.registrationDeadline}</MessageBox>
          ) : null}
          <div className="adminEventHint">
            Exemple : clôturer les inscriptions quelques jours avant l’événement.
          </div>
        </div>

        <div className="adminEventField adminEventLeftCol">
          <div className="adminEventLabel">Acompte (€)</div>
          <Input
            format="price"
            priceLocale="fr"
            placeholder="0,00"
            value={draft.depositEurosRaw}
            onValueChange={(v) => {
              if (v.kind === "priceDraft") {
                setDraft((d) => ({ ...d, depositEurosRaw: v.raw }));
                return;
              }
              if (v.kind === "priceCommit") {
                const formatted = (v.cents / 100).toFixed(2).replace(".", ",");
                setDraft((d) => ({ ...d, depositEurosRaw: formatted }));
                return;
              }
            }}
          />
          {fieldErrors.depositCents ? <MessageBox variant="error">{fieldErrors.depositCents}</MessageBox> : null}
          <div className="adminEventHint">0 = pas d’acompte.</div>
        </div>

        <div className="adminEventField adminEventLeftCol">
          <div className="adminEventLabel">Participants max</div>
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            className="adminEventInput"
            placeholder="0"
            value={draft.maxAttendeesRaw}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                maxAttendeesRaw: e.target.value,
              }))
            }
          />
          {fieldErrors.maxAttendees ? (
            <MessageBox variant="error">{fieldErrors.maxAttendees}</MessageBox>
          ) : null}
          <div className="adminEventHint">0 = participants non limités.</div>
        </div>

        <div className="adminEventField adminEventFieldSpan2">
          <div className="adminEventLabel">Bannière</div>

          {bannerPreviewUrl ? (
            <img className="adminEventBannerPreviewMini" src={bannerPreviewUrl} alt="Bannière" />
          ) : (
            <div className="adminEventEmpty">Aucune bannière</div>
          )}

          <div className="adminEventBannerActionsBelow">
            <Button variant="secondary" onClick={openBannerPicker}>
              {hasCustomBannerNow || bannerFile ? "Remplacer" : "Choisir un fichier"}
            </Button>

            {hasCustomBannerNow || bannerFile ? (
              <Button variant="secondary" onClick={clearBanner}>
                Retirer
              </Button>
            ) : null}
          </div>

          {bannerFile ? (
            <div className="adminEventHint" style={{ margin: 0 }}>
              Fichier prêt : <strong>{bannerFile.name}</strong>
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              onBannerPicked(file);
            }}
          />
        </div>
      </div>
</div>

<style>
  {`
    .adminEventDropdown {
    border: 1px solid var(--color-border, #ddd);
    border-radius: 14px;
    background: #fff;
    overflow: hidden;
  }

  .adminEventDropdownSummary {
    cursor: pointer;
    list-style: none;
    padding: 14px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-weight: 800;
  }

  .adminEventDropdownSummary::-webkit-details-marker {
    display: none;
  }

  .adminEventDropdownSummary::after {
    content: "▾";
    font-size: 14px;
    opacity: 0.65;
    transition: transform 0.18s ease;
  }

  .adminEventDropdown[open] .adminEventDropdownSummary::after {
    transform: rotate(180deg);
  }

  .adminEventDropdownSummary small {
    margin-left: auto;
    font-size: 12px;
    font-weight: 700;
    opacity: 0.55;
  }

  .adminEventDropdownBody {
    padding: 0 16px 16px;
  }
  `}
  
</style></>
  );
}

