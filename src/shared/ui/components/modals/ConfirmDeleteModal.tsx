import { useId } from "react";
import Button from "../button/Button";
import { useDialogFocus } from "./useDialogFocus";

import "./modal.css";

export function ConfirmDeleteModal(props: {
  open: boolean;
  title: string;
  eventName?: string | null;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { open, title, eventName, busy, error, onCancel, onConfirm } = props;
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useDialogFocus({
    open,
    onClose: onCancel,
    closeDisabled: Boolean(busy),
  });

  if (!open) return null;

  return (
    <div
      className="uiModalBackdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="uiModalPanel uiModalPanel--danger"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="uiModalTitle">
          {title}
        </h2>

        <div id={descriptionId} className="uiModalDescription">
          Vous êtes sur le point de supprimer{" "}
          <strong>{eventName || "cet événement"}</strong>.
          <br />
          Cette action est définitive.
        </div>

        {error ? <div className="uiModalError">{error}</div> : null}

        <div className="uiModalActions">
          <Button
            onClick={onCancel}
            disabled={Boolean(busy)}
            variant="secondary"
          >
            Annuler
          </Button>
          <Button onClick={onConfirm} disabled={Boolean(busy)} variant="danger">
            {busy ? "Suppression…" : "Supprimer"}
          </Button>
        </div>
      </div>
    </div>
  );
}
