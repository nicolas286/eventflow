import Button from "@ui/components/button/Button";
import MarkdownText from "@shared/ui/components/markdowntext/MarkdownText";

type Props = {
  open: boolean;
  markdown: string;
  onClose: () => void;
  onConfirmRead: () => void;
  title?: string;
  confirmLabel?: string;
};

export function PublicCharterModal({
  open,
  markdown,
  onClose,
  onConfirmRead,
  title = "Charte de l’événement",
  confirmLabel = "J’ai lu la charte",
}: Props) {
  if (!open) return null;

  return (
    <>
      <div className="publicModalOverlay" role="dialog" aria-modal="true">
        <div className="publicModalCard">
          <div className="publicModalHeader">
            <div style={{ fontWeight: 900, fontSize: 18 }}>{title}</div>
          </div>

          <div className="publicModalBody">
            <MarkdownText
              markdown={markdown}
              className="publicCharterMarkdown"
            />
          </div>

          <div className="publicModalActions">
            <Button variant="secondary" label="Fermer" onClick={onClose} />

            <Button label={confirmLabel} onClick={onConfirmRead} />
          </div>
        </div>
      </div>

      <style>{`
        .publicModalOverlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          background: rgba(15, 23, 42, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .publicModalCard {
          width: min(760px, 100%);
          max-height: min(760px, 90vh);
          background: #fff;
          border-radius: 24px;
          box-shadow: 0 24px 80px rgba(0,0,0,.25);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .publicModalHeader {
          flex: 0 0 auto;
          padding: 20px 22px;
          border-bottom: 1px solid rgba(0,0,0,.08);
        }

        .publicModalBody {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
          padding: 22px;
        }

        .publicModalActions {
          flex: 0 0 auto;
          padding: 16px 22px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          border-top: 1px solid rgba(0,0,0,.08);
        }

        .publicCharterMarkdown {
          line-height: 1.65;
        }

        @media (max-width: 768px) {
          .publicModalCard {
            width: 100%;
            max-height: 100vh;
            border-radius: 18px;
          }

          .publicModalActions {
            flex-direction: column;
          }
        }
      `}</style>
    </>
  );
}
