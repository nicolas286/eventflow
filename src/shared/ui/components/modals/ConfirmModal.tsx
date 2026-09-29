import { useId, type ReactNode } from "react";
import Button from "../button/Button";
import { useDialogFocus } from "./useDialogFocus";

import "./modal.css";

type ConfirmIntent = "primary" | "danger";

type ConfirmModalProps = {
  isOpen: boolean;

  title: ReactNode;
  children: ReactNode;

  confirmLabel?: ReactNode;
  confirmLoadingLabel?: ReactNode;
  cancelLabel?: ReactNode;

  intent?: ConfirmIntent;

  loading?: boolean;
  error?: ReactNode;

  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export function ConfirmModal({
  isOpen,
  title,
  children,

  confirmLabel = "Confirmer",
  confirmLoadingLabel = "Confirmation…",
  cancelLabel = "Annuler",

  intent = "primary",
  loading = false,
  error = null,

  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useDialogFocus({
    open: isOpen,
    onClose: onCancel,
    closeDisabled: loading,
  });

  if (!isOpen) return null;

  const confirmVariant = intent === "danger" ? "danger" : "primary";

  return (
    <div
      className="uiModalBackdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className={`uiModalPanel${intent === "danger" ? " uiModalPanel--danger" : ""}`}
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
          {children}
        </div>

        {error ? <div className="uiModalError">{error}</div> : null}

        <div className="uiModalActions">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>

          <Button
            variant={confirmVariant}
            onClick={() => void onConfirm()}
            disabled={loading}
          >
            {loading ? confirmLoadingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
