import { useState } from "react";
import { Button, Input, Select } from "@ui/components";
import type { OrganizationProfile } from "@shared/models/db/db.organizationProfile.schema";
import type { SellerIdentityInput } from "../../data/sellerComplianceRepo";

export function SellerIdentityForm({ profile, loading, onSave, onDirtyChange }: {
  profile: OrganizationProfile | null;
  loading: boolean;
  onSave: (identity: SellerIdentityInput) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [identity, setIdentity] = useState<SellerIdentityInput>(() => ({
    legalName: profile?.sellerLegalName ?? "",
    address: profile?.sellerAddress ?? "",
    businessNumber: profile?.sellerBusinessNumber ?? "",
    sellerType: profile?.sellerType ?? "",
    phone: profile?.phone ?? "",
  }));
  const [saved, setSaved] = useState(false);
  function change<K extends keyof SellerIdentityInput>(key: K, value: SellerIdentityInput[K]) {
    setSaved(false);
    onDirtyChange(true);
    setIdentity((current) => ({ ...current, [key]: value }));
  }
  const valid = identity.legalName.trim().length >= 2 && identity.address.trim().length >= 8 &&
    identity.phone.trim().length >= 6 && Boolean(identity.sellerType);
  return <div className="structurePanel__field">
    <div className="structurePanel__help">Ces informations identifient le vendeur auprès des acheteurs et figurent dans leur confirmation. Pour une association de fait, indiquez l’identité du vendeur et du représentant qui l’engage.</div>
    <Input label="Nom légal du vendeur" value={identity.legalName} maxLength={200}
      onChange={(event) => change("legalName", event.target.value)} />
    <Input label="Adresse complète (rue, numéro, code postal, ville, pays)" value={identity.address} maxLength={500}
      onChange={(event) => change("address", event.target.value)} />
    <Input label="Téléphone public" value={identity.phone} maxLength={32}
      onChange={(event) => change("phone", event.target.value)} />
    <label htmlFor="seller-type">Qualité du vendeur</label>
    <Select id="seller-type" value={identity.sellerType} onChange={(event) => {
      const value = event.target.value;
      if (value === "professional" || value === "non_professional" || value === "") change("sellerType", value);
    }}>
      <option value="">Choisir votre situation</option>
      <option value="professional">Professionnel</option>
      <option value="non_professional">Non professionnel</option>
    </Select>
    <div className="structurePanel__help">Une association peut agir à titre professionnel. Choisissez selon votre activité réelle, et non votre seule forme juridique.</div>
    <Input label="Numéro d’entreprise / TVA (à renseigner si applicable)"
      value={identity.businessNumber} maxLength={100} onChange={(event) => change("businessNumber", event.target.value)} />
    <Button label={loading ? "Enregistrement…" : "Enregistrer l’identité du vendeur"} disabled={loading || !valid}
      onClick={async () => {
        const success = await onSave(identity);
        setSaved(success);
        if (success) onDirtyChange(false);
      }} />
    {saved ? <div className="structurePanel__success" role="status">Identité du vendeur enregistrée.</div> : null}
  </div>;
}
