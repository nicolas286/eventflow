import "./WidgetPanel.desktop.css";

import { useMemo, useState } from "react";
import { getPublicOrigin } from "@shared/helpers/publicOrigin";

import { Badge, Button, Input } from "@shared/ui/components";
import { MessageBox } from "@shared/ui/components/message/MessageBox";

import type { WidgetThemeUI } from "../pages/AdminWidgetPage";

type WidgetPanelProps = {
  org: WidgetThemeUI;
  setOrg: React.Dispatch<React.SetStateAction<WidgetThemeUI>>;
  orgPlan: "free" | "starter" | "pro" | undefined;
};

function enc(v: string) {
  return encodeURIComponent(v);
}

export default function WidgetPanel({
  org,
  setOrg,
  orgPlan,
}: WidgetPanelProps) {
  const isFree = orgPlan === "free";
  const [copied, setCopied] = useState<string | null>(null);

  const bg = org.widgetBg || "#612510";
  const card = org.widgetCard || "#612510";
  const text = org.widgetText || "#FFDE59";
  const button = org.widgetButton || "#D9931A";
  const slug = org.slug || "";
  const publicOrigin = getPublicOrigin();

  const widgetUrl = useMemo(() => {
    if (!slug) return "";

    return `${publicOrigin}/widget/o/${enc(slug)}?bg=${enc(bg)}&card=${enc(card)}&text=${enc(text)}&button=${enc(button)}`;
  }, [slug, bg, card, text, button, publicOrigin]);

const iframeCode = useMemo(() => {
  if (!widgetUrl) return "";

  return `<div
  style="
    border-radius:24px;
    overflow:hidden;
    background:${bg};
    box-shadow:0 20px 50px rgba(0,0,0,0.12);
    border:1px solid rgba(0,0,0,0.08);
  "
>
  <iframe
    id="eventflowWidgetFrame"
    src="${widgetUrl}"
    title="Billetterie Eventflow"
    loading="lazy"
    style="
      display:block;
      width:100%;
      height:700px;
      border:0;
      background:${bg};
      transition:height 0.2s ease;
      transform:translateY(1px);
    "
  ></iframe>
</div>
<script>
  window.addEventListener("message", function (event) {
    if (event.origin !== ${JSON.stringify(publicOrigin)}) return;
    if (!event.data || event.data.type !== "eventflow:widget:resize") return;

    var iframe = document.getElementById("eventflowWidgetFrame");
    if (!iframe) return;
    if (event.source !== iframe.contentWindow) return;

    var nextHeight = Number(event.data.height);
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;

    iframe.style.height = nextHeight + "px";
  });
</script>`;
}, [widgetUrl, bg, publicOrigin]);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied("Erreur de copie");
      window.setTimeout(() => setCopied(null), 1800);
    }
  }

  function resetTheme() {
    setOrg((prev) => ({
      ...prev,
      widgetBg: "#612510",
      widgetCard: "#612510",
      widgetText: "#FFDE59",
      widgetButton: "#D9931A",
    }));
  }

  return (
    <div className="widgetPanel">
      {isFree ? (
        <div className="widgetPanel__status">
          <MessageBox variant="info">
            Le widget d’intégration est disponible à partir du plan Starter.
          </MessageBox>
        </div>
      ) : null}

      <div className="widgetPanel__grid2">
        <div className={isFree ? "widgetPanel__locked" : undefined}>
          <div className="widgetPanel__labelRow">
            <div>
              <div className="widgetPanel__label">Couleurs du widget</div>
              <div className="widgetPanel__help">
                Personnalisez l’apparence de la billetterie intégrée.
              </div>
            </div>

            <div className="widgetPanel__miniActions">
              <Button
                variant="ghost"
                label="Réinitialiser"
                onClick={resetTheme}
                disabled={isFree}
              />
            </div>
          </div>

          <div className="widgetPanel__colorGrid">
            <label className="widgetPanel__colorField">
              <span>Fond</span>
              <Input
                type="color"
                value={bg}
                disabled={isFree}
                onChange={(e) =>
                  setOrg((o) => ({ ...o, widgetBg: e.target.value }))
                }
              />
            </label>

            <label className="widgetPanel__colorField">
              <span>Carte</span>
              <Input
                type="color"
                value={card}
                disabled={isFree}
                onChange={(e) =>
                  setOrg((o) => ({ ...o, widgetCard: e.target.value }))
                }
              />
            </label>

            <label className="widgetPanel__colorField">
              <span>Texte</span>
              <Input
                type="color"
                value={text}
                disabled={isFree}
                onChange={(e) =>
                  setOrg((o) => ({ ...o, widgetText: e.target.value }))
                }
              />
            </label>

            <label className="widgetPanel__colorField">
              <span>Bouton</span>
              <Input
                type="color"
                value={button}
                disabled={isFree}
                onChange={(e) =>
                  setOrg((o) => ({ ...o, widgetButton: e.target.value }))
                }
              />
            </label>
          </div>
        </div>

        <div className="widgetPanel__previewCard">
          <div className="widgetPanel__labelRow">
            <div className="widgetPanel__label">Aperçu</div>
            <Badge tone="info" label="Live" />
          </div>

          <div className="widgetPanel__previewWrap">
            {widgetUrl ? (
              <iframe
                key={widgetUrl}
                src={widgetUrl}
                title="Aperçu widget"
                className="widgetPanel__iframe"
              />
            ) : (
              <div className="widgetPanel__empty">
                Impossible de générer l’aperçu : slug manquant.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="widgetPanel__codeCard">
        <div className="widgetPanel__labelRow">
          <div>
            <div className="widgetPanel__label">Lien direct</div>
            <div className="widgetPanel__help">
              Vous pouvez aussi ouvrir le widget seul dans un onglet.
            </div>
          </div>

          <Button
            variant="secondary"
            label="Copier le lien"
            disabled={!widgetUrl || isFree}
            onClick={() => copy("Lien copié", widgetUrl)}
          />
        </div>

        <textarea
          className="widgetPanel__code"
          readOnly
          value={widgetUrl}
        />
      </div>

      <div className="widgetPanel__codeCard">
        <div className="widgetPanel__labelRow">
          <div>
            <div className="widgetPanel__label">Code d’intégration</div>
            <div className="widgetPanel__help">
              Collez ce code dans votre site pour afficher la billetterie.
            </div>
          </div>

          <Button
            variant="primary"
            label="Copier le code"
            disabled={!iframeCode || isFree}
            onClick={() => copy("Code copié", iframeCode)}
          />
        </div>

        <textarea
          className="widgetPanel__code widgetPanel__code--lg"
          readOnly
          value={iframeCode}
        />
      </div>

      {copied ? (
        <div className="widgetPanel__status">
          <MessageBox variant="success">{copied}</MessageBox>
        </div>
      ) : null}
    </div>
  );
}
