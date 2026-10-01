import { useState } from "react";
import { Button } from "@ui/components";
import { supabase } from "@shared/gateways/supabase/supabaseClient";
import { useSellerCompliance } from "../hooks/useSellerCompliance";

export function PlatformAgreementsPanel({ orgId, current, onSaved }: {
  orgId: string;
  current: boolean;
  onSaved: () => Promise<void>;
}) {
  const compliance = useSellerCompliance(supabase);
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [connect, setConnect] = useState(false);
  const [dpa, setDpa] = useState(false);
  const confirmed = terms && privacy && connect && dpa;
  async function accept() {
    if (!confirmed || compliance.loading) return;
    if (await compliance.acceptAgreements(orgId)) await onSaved();
  }
  return <section id="platform-agreements" className="structurePanel__block" aria-labelledby="platform-agreements-title">
    <h2 id="platform-agreements-title" className="structurePanel__label">Vos accords avec Eventflow</h2>
    <div className="structurePanel__help">Ces documents encadrent l’utilisation du service par votre organisation. Versions du 1er octobre 2026.</div>
    {current ? <div className="structurePanel__success">
      <a href="/cgu" target="_blank" rel="noreferrer">CGU Eventflow</a>, <a href="/conditions-connect" target="_blank" rel="noreferrer">annexe Connect</a> et <a href="/accord-traitement-donnees" target="_blank" rel="noreferrer">accord de traitement des données</a> acceptés ; prise de connaissance de la <a href="/politique-confidentialite" target="_blank" rel="noreferrer">politique de confidentialité</a> confirmée.
    </div> : <>
      <div className="structurePanel__help">En validant, vous confirmez être autorisé à engager l’organisation. L’annexe Connect s’applique lorsque vous activez les paiements.</div>
      <label className="structurePanel__termsConfirmation"><input type="checkbox" checked={terms} disabled={compliance.loading} onChange={(event) => setTerms(event.target.checked)} />
        <span>Au nom de l’organisation, j’accepte les <a href="/cgu" target="_blank" rel="noreferrer">conditions générales d’utilisation Eventflow</a>.</span></label>
      <label className="structurePanel__termsConfirmation"><input type="checkbox" checked={privacy} disabled={compliance.loading} onChange={(event) => setPrivacy(event.target.checked)} />
        <span>Je confirme avoir pris connaissance de la <a href="/politique-confidentialite" target="_blank" rel="noreferrer">politique de confidentialité Eventflow</a>.</span></label>
      <label className="structurePanel__termsConfirmation"><input type="checkbox" checked={connect} disabled={compliance.loading} onChange={(event) => setConnect(event.target.checked)} />
        <span>Au nom de l’organisation, j’accepte l’<a href="/conditions-connect" target="_blank" rel="noreferrer">annexe Stripe Connect</a>, notamment les opérations de paiement et de remboursement autorisées.</span></label>
      <label className="structurePanel__termsConfirmation"><input type="checkbox" checked={dpa} disabled={compliance.loading} onChange={(event) => setDpa(event.target.checked)} />
        <span>Au nom de l’organisation, j’accepte l’<a href="/accord-traitement-donnees" target="_blank" rel="noreferrer">accord de traitement des données</a>.</span></label>
      <Button label={compliance.loading ? "Enregistrement…" : "Valider les accords Eventflow"} disabled={!confirmed || compliance.loading} onClick={accept} />
    </>}
    {compliance.error ? <div className="structurePanel__error" role="alert">{compliance.error}</div> : null}
  </section>;
}
