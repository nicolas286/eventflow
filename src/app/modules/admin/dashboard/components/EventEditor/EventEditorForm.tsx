import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  updateEventPatchSchema,
  type UpdateEventPatch,
} from "@app/modules/admin/singleEvent/schemas/admin.updateEventPatch.schema";
import type { AdminEventDetailEvent } from "@app/modules/admin/singleEvent/schemas/admin.eventDetail.schema";
import { Button } from "@shared/ui/components";
import { Input } from "@shared/ui/components";
import { MessageBox } from "@shared/ui/components/message/MessageBox";
import {
  isoToLocalInput,
  localDateTimeMinNow,
  localInputToIso,
} from "@helpers/dateTime";
import { useLiveForm } from "@shared/hooks/useLiveZodForm";
import type { EditableEventFields } from "./EventEditor";

type Props = {
  event: Partial<AdminEventDetailEvent>;
  onConfirm: (patch: EditableEventFields) => void;
};

const FORM_KEYS: Array<keyof UpdateEventPatch> = [
  "title",
  "location",
  "startsAt",
  "isPublished",
];

function buildInitialDraft(
  event: Partial<AdminEventDetailEvent>,
): UpdateEventPatch {
  return {
    title: event.title,
    location: event.location ?? null,
    startsAt: event.startsAt ?? null,
    isPublished: event.isPublished,
  };
}

function makePatch(
  parsed: UpdateEventPatch,
  event: Partial<AdminEventDetailEvent>,
) {
  const patch: UpdateEventPatch = {};

  if (parsed.title !== event.title) patch.title = parsed.title;

  if ((parsed.location ?? null) !== (event.location ?? null)) {
    patch.location = parsed.location ?? null;
  }

  if ((parsed.startsAt ?? null) !== (event.startsAt ?? null)) {
    patch.startsAt = parsed.startsAt ?? null;
  }

  if (parsed.isPublished !== event.isPublished) {
    patch.isPublished = parsed.isPublished;
  }

  return patch;
}

export default function EventEditorForm({ event, onConfirm }: Props) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const initialDraft = useMemo(() => buildInitialDraft(event), [event]);

  const live = useLiveForm<UpdateEventPatch>(
    updateEventPatchSchema,
    initialDraft,
  );

  useEffect(() => {
    live.reset(initialDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraft, live.reset]);

  const draft = live.form;

  async function submit() {
    setSubmitError(null);
    setSuccessMsg(null);

    live.touchAll(FORM_KEYS);

    const res = live.validateAll();
    if (!res.ok) {
      setSubmitError("Veuillez corriger les champs en erreur.");
      return;
    }

    const parsed = updateEventPatchSchema.parse(res.data);

    const patch = makePatch(parsed, event);
    if (Object.keys(patch).length === 0) {
      setSubmitError("Aucune modification détectée.");
      return;
    }

    try {
      const result = await onConfirm(patch);

      const failed = result === null;

      if (!failed) setSuccessMsg("Modifications enregistrées avec succès.");
      else setSubmitError("Impossible d’enregistrer l’événement.");
    } catch {
      setSubmitError("Impossible d’enregistrer l’événement.");
    }
  }

  const showErr = <K extends keyof UpdateEventPatch>(key: K) =>
    live.shouldShowFieldError(key, { hideUntilTouched: true }) &&
    !!live.fieldErrors[key];

  const minLocal = localDateTimeMinNow();

  return (
    <div className="eventEditor">
      <Link
        className="eventEditor__fullLink"
        to={`/admin/events/${event.slug}`}
        onClick={(e) => e.stopPropagation()}
        title="Voir et modifier les détails de l'événement"
      >
        <span>
          <strong>Ouvrir l’éditeur complet</strong>
          <small>Billets, formulaire, commandes et réglages avancés</small>
        </span>
        <span className="eventEditor__fullLinkArrow" aria-hidden="true">
          →
        </span>
      </Link>

      {(submitError || successMsg) && (
        <div className="eventEditor__feedback" aria-live="polite">
          {submitError ? (
            <MessageBox variant="error">{submitError}</MessageBox>
          ) : null}
          {successMsg ? (
            <MessageBox variant="success">{successMsg}</MessageBox>
          ) : null}
        </div>
      )}

      <div className="eventEditor__section">
        <div className="eventEditor__sectionTitle">Informations générales</div>

        <Input
          value={draft.title ?? ""}
          onChange={(e) => live.handleChange("title", e.target.value)}
          onBlur={() => live.handleBlur("title")}
          placeholder="Nom de l'événement"
          label="Nom de l'événement"
        />
        {showErr("title") && (
          <MessageBox variant="error">{live.fieldErrors.title}</MessageBox>
        )}

        <Input
          value={draft.location ?? ""}
          onChange={(e) =>
            live.handleChange("location", e.target.value || null)
          }
          onBlur={() => live.handleBlur("location")}
          placeholder="Lieu de l'événement"
          label="Lieu de l'événement"
        />
        {showErr("location") && (
          <MessageBox variant="error">{live.fieldErrors.location}</MessageBox>
        )}

        <Input
          type="datetime-local"
          value={isoToLocalInput(draft.startsAt ?? null)}
          min={minLocal}
          onChange={(e) =>
            live.handleChange("startsAt", localInputToIso(e.target.value))
          }
          onBlur={() => live.handleBlur("startsAt")}
          label="Date et heure de début"
        />
        {showErr("startsAt") && (
          <div className="eventEditor__error">{live.fieldErrors.startsAt}</div>
        )}
      </div>

      <div className="eventEditor__section eventEditor__section--publication">
        <div>
          <div className="eventEditor__sectionTitle">Publication</div>
          <div className="eventEditor__sectionHint">
            Un événement publié est visible sur votre page publique.
          </div>
        </div>
        <select
          className="eventEditor__select"
          value={draft.isPublished ? "published" : "draft"}
          onChange={(e) =>
            live.handleChange("isPublished", e.target.value === "published")
          }
          onBlur={() => live.handleBlur("isPublished")}
        >
          <option value="draft">Brouillon</option>
          <option value="published">Publié</option>
        </select>
      </div>

      <div className="eventEditor__footer">
        <span>
          Les autres réglages restent disponibles dans l’éditeur complet.
        </span>
        <Button
          label="Enregistrer les modifications"
          variant="primary"
          onClick={submit}
        />
      </div>
    </div>
  );
}
