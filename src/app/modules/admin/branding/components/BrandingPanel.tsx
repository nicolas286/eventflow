import "./BrandingPanel.desktop.css";
import "./BrandingPanel.desktop.css";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@shared/ui/components";
import { Input } from "@shared/ui/components";
import { Badge } from "@shared/ui/components";

import { MessageBox } from "@shared/ui/components/message/MessageBox";
import { useLiveForm } from "@shared/hooks/useLiveZodForm";

import { applyOrgTheme } from "@shared/ui/components/theme/applyOrgTheme";
import { supabase } from "@shared/gateways/supabase/supabaseClient";
import { useSaveOrgBranding } from "../hooks/useSaveOrgBranding";
import {
  orgBrandingFormSchema,
  type OrgBrandingUI,
  type OrgBrandingForm,
} from "../schemas/admin.orgBranding.schema";
import { handleSaveBranding } from "./handleSaveBranding";

import { AssetUploader } from "@shared/ui/components/inputs/AssetUploader";
import { normalizeError } from "@errors/errors";

type BrandingPanelProps = {
  orgId: string;
  org: OrgBrandingUI;
  orgPlan: "free" | "starter" | "pro" | undefined;
  setOrg: React.Dispatch<React.SetStateAction<OrgBrandingUI>>;
  onSaved: () => Promise<void>;
};

export default function BrandingPanel({
  orgId,
  org,
  orgPlan,
  setOrg,
  onSaved,
}: BrandingPanelProps) {
  const isFree = orgPlan === "free";

  const { loading, error, updated, previewLogoUrl, previewBannerUrl, saveOrgBranding, reset } =
    useSaveOrgBranding({ supabase });

  const live = useLiveForm<OrgBrandingForm>(orgBrandingFormSchema, {
    displayName: org.displayName ?? "",
    primaryColor: org.primaryColor ?? "",
    logoUrl: org.logoUrl ?? null,
    defaultEventBannerUrl: org.defaultEventBannerUrl ?? null,
  });

  const { form, fieldErrors, handleChange, handleBlur, shouldShowFieldError } = live;

  const [assetError, setAssetError] = useState<string | null>(null);

  useEffect(() => {
    applyOrgTheme(org.primaryColor || "#2563eb");
  }, [org.primaryColor]);

  useEffect(() => {
    handleChange("displayName", org.displayName ?? "");
    handleChange("primaryColor", org.primaryColor ?? "");
    handleChange("logoUrl", org.logoUrl ?? null);
    handleChange("defaultEventBannerUrl", org.defaultEventBannerUrl ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.displayName, org.primaryColor, org.logoUrl, org.defaultEventBannerUrl]);

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [localLogoPreview, setLocalLogoPreview] = useState<string | null>(null);
  const [localBannerPreview, setLocalBannerPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (localLogoPreview) URL.revokeObjectURL(localLogoPreview);
      if (localBannerPreview) URL.revokeObjectURL(localBannerPreview);
    };
  }, [localLogoPreview, localBannerPreview]);

  const effectiveLogoPreview = useMemo(() => {
    return previewLogoUrl ?? localLogoPreview ?? org.logoUrl ?? "";
  }, [previewLogoUrl, localLogoPreview, org.logoUrl]);

  const effectiveBannerPreview = useMemo(() => {
    return previewBannerUrl ?? localBannerPreview ?? org.defaultEventBannerUrl ?? "";
  }, [previewBannerUrl, localBannerPreview, org.defaultEventBannerUrl]);

  async function handleSave() {
    setAssetError(null);

    // 👇 si free: on empêche d’essayer de Enregistrer un branding “premium”
    if (isFree) {
      return;
    }

    live.touchAll(["displayName", "primaryColor"]);

    const parsed = live.validateAll();
    if (!parsed.ok) return;

    try {
      await handleSaveBranding({
        orgId,
        form: {
          displayName: parsed.data.displayName,
          primaryColor: parsed.data.primaryColor,
          logoUrl: parsed.data.logoUrl ?? null,
          defaultEventBannerUrl: parsed.data.defaultEventBannerUrl ?? null,
        },
        logoFile,
        bannerFile,
        saveOrgBranding,
        onSaved,
        reset,
        clearLogo: () => {
          setLogoFile(null);
          if (localLogoPreview) {
            URL.revokeObjectURL(localLogoPreview);
            setLocalLogoPreview(null);
          }
        },
        clearBanner: () => {
          setBannerFile(null);
          if (localBannerPreview) {
            URL.revokeObjectURL(localBannerPreview);
            setLocalBannerPreview(null);
          }
        },
      });
    } catch (e) {
      const err = normalizeError(e, "Erreur inconnue.");
      setAssetError(err.message);
    }
  }

  return (
    <div className="brandingPanel">
      {/* Ligne 1 : Couleur (gauche) + Aperçu (droite) */}
      <div className="brandingPanel__grid2 brandingPanel__topRow">
        {/* LEFT: Primary color (better UI) */}
        <div className={isFree ? "brandingPanel__locked" : undefined}>
          <div className="brandingPanel__labelRow">
            <div>
              <div className="brandingPanel__label">Couleur principale</div>
              <div className="brandingPanel__help">Elle personnalise les boutons, badges et accents.</div>
            </div>

            <div className="brandingPanel__miniActions">
              <Button
                variant="ghost"
                label="Réinitialiser"
                disabled={isFree}
                onClick={() => {
                  const v = "#2563eb";
                  setAssetError(null);
                  handleChange("primaryColor", v);
                  setOrg((o) => ({ ...o, primaryColor: v }));
                }}
              />
            </div>
          </div>

          <div className="brandingPanel__colorCard">
            <label className="brandingPanel__colorPick">
              {/* input color transparent mais cliquable sur toute la zone */}
              <Input
                type="color"
                value={form.primaryColor ?? ""}
                onChange={(e) => {
                  setAssetError(null);
                  handleChange("primaryColor", e.target.value);
                  setOrg((o) => ({ ...o, primaryColor: e.target.value }));
                }}
                onBlur={() => handleBlur("primaryColor")}
                className="brandingPanel__colorNative"
                aria-label="Choisir une couleur"
                disabled={isFree}
              />

              <span className="brandingPanel__swatch" aria-hidden="true">
                <span className="brandingPanel__swatchInner" />
              </span>

              <span className="brandingPanel__colorText">
                <span className="brandingPanel__colorTitle">Choisir une couleur</span>
                <span className="brandingPanel__colorSub">
                  Clique sur le carré pour ouvrir le sélecteur.
                </span>
              </span>
            </label>

            {shouldShowFieldError("primaryColor") && fieldErrors.primaryColor ? (
              <MessageBox variant="error">{fieldErrors.primaryColor}</MessageBox>
            ) : null}
          </div>
        </div>

        {/* RIGHT: Preview card */}
        <div className="brandingPanel__previewCard">
          <div className="brandingPanel__labelRow">
            <div className="brandingPanel__label">Aperçu</div>
            <Badge tone="info" label="Live" />
          </div>

          <div className="brandingPanel__preview">
            <Button variant="primary" label="Action primaire" />
            <Button variant="secondary" label="Secondaire" />
            <Button variant="ghost" label="Ghost" />
          </div>
        </div>
      </div>


      {/* Assets (lock en free) */}
      <div className={`brandingPanel__grid2 ${isFree ? "brandingPanel__locked" : ""}`}>
        <AssetUploader
          label="Logo"
          hint="PNG/JPG/WebP · max 2MB"
          valueUrl={org.logoUrl ?? ""}
          previewUrl={effectiveLogoPreview}
          accept="image/png,image/jpeg,image/webp,image/gif"
          maxBytes={2 * 1024 * 1024}
          maxLabel="2MB"
          variant="logo"
          onError={(msg) => setAssetError(msg)}
          onPickFile={(file) => {
            setAssetError(null);
            setLogoFile(file);

            if (localLogoPreview) URL.revokeObjectURL(localLogoPreview);
            setLocalLogoPreview(URL.createObjectURL(file));
          }}
          onClear={() => {
            setAssetError(null);
            setLogoFile(null);
            if (localLogoPreview) URL.revokeObjectURL(localLogoPreview);
            setLocalLogoPreview(null);

            handleChange("logoUrl", null);
            setOrg((o) => ({ ...o, logoUrl: "" }));
          }}
        />

        <AssetUploader
          label="Bannière par défaut"
          hint="Recommandé: large (ex: 1600×600) · max 4MB"
          valueUrl={org.defaultEventBannerUrl ?? ""}
          previewUrl={effectiveBannerPreview}
          accept="image/png,image/jpeg,image/webp,image/gif"
          maxBytes={4 * 1024 * 1024}
          maxLabel="4MB"
          variant="banner"
          onError={(msg) => setAssetError(msg)}
          onPickFile={(file) => {
            setAssetError(null);
            setBannerFile(file);

            if (localBannerPreview) URL.revokeObjectURL(localBannerPreview);
            setLocalBannerPreview(URL.createObjectURL(file));
          }}
          onClear={() => {
            setAssetError(null);
            setBannerFile(null);
            if (localBannerPreview) URL.revokeObjectURL(localBannerPreview);
            setLocalBannerPreview(null);

            handleChange("defaultEventBannerUrl", null);
            setOrg((o) => ({ ...o, defaultEventBannerUrl: "" }));
          }}
        />
      </div>

      {/* Status */}
      {(assetError || error) && (
        <div className="brandingPanel__status">
          {assetError ? <MessageBox variant="error">{assetError}</MessageBox> : null}
          {error ? <MessageBox variant="error">{error}</MessageBox> : null}
        </div>
      )}

      {updated ? (
        <div className="brandingPanel__status">
          <MessageBox variant="success">Branding sauvegardé</MessageBox>
        </div>
      ) : null}

      {/* Actions */}
      <div className="brandingPanel__actionsBar">
        <div className="brandingPanel__actions">
          <Button
            variant="primary"
            label={isFree ? "Disponible en Starter" : loading ? "Enregistrement…" : "Enregistrer"}
            onClick={handleSave}
            disabled={loading || isFree}
          />
        </div>
      </div>
    </div>
  );
}
