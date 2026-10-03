import { useState, type FormEvent } from "react";
import { Helmet } from "react-helmet-async";
import { normalizeError } from "@errors/errors";
import { platformAdminRepo } from "../data/platformAdminRepo";
import { usePlatformSecurity } from "../security/PlatformSecurityContext";
import { PageHeader, Panel } from "../components/PlatformUi";

export function PlatformOnboardingPage() {
  const { runCritical } = usePlatformSecurity();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(null); setSuccess(false);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ownerEmail = String(form.get("ownerEmail")).trim().toLowerCase();
    const payload = {
      ownerEmail,
      ownerFirstName: String(form.get("ownerFirstName")),
      ownerLastName: String(form.get("ownerLastName")),
      organizationName: String(form.get("organizationName")),
      organizationType: String(form.get("organizationType")),
      plan: String(form.get("plan")),
      status: String(form.get("status")),
      trialDays: Number(form.get("trialDays")),
      note: String(form.get("note")),
      reason: String(form.get("reason")),
      idempotencyKey,
    };
    setLoading(true);
    try {
      await runCritical("organizations.onboard", ownerEmail, `Créer l’organisation « ${payload.organizationName} » et attribuer ${ownerEmail} comme propriétaire ? Une invitation peut être envoyée.`, (token) => platformAdminRepo.onboard(payload, token));
      setSuccess(true); setIdempotencyKey(crypto.randomUUID()); formElement.reset();
    } catch (cause) {
      if ((cause instanceof Error ? cause.message : null) !== "Action annulée") setError(normalizeError(cause, "Onboarding impossible.").message);
    } finally { setLoading(false); }
  };

  return <>
    <Helmet><title>Onboarding · Eventflow Platform</title></Helmet>
    <PageHeader eyebrow="Activation client" title="Onboarder une organisation" />
    <Panel><p className="platformMuted">L’opération est idempotente, auditée et attribue le rôle owner au compte indiqué — jamais à l’administrateur plateforme.</p>
      <form onSubmit={(event) => void submit(event)} className="platformFormGrid">
        <label>Nom de l’organisation<input name="organizationName" required minLength={3} maxLength={120} /></label>
        <label>Type<select name="organizationType"><option value="association">Association</option><option value="person">Personne</option></select></label>
        <label>Prénom propriétaire<input name="ownerFirstName" required /></label><label>Nom propriétaire<input name="ownerLastName" required /></label>
        <label>E-mail propriétaire<input name="ownerEmail" type="email" required /></label>
        <label>Plan<select name="plan"><option value="free">Free</option><option value="starter">Starter</option><option value="pro">Pro</option></select></label>
        <label>Statut<select name="status"><option value="trial">Essai</option><option value="active">Actif</option><option value="suspended">Suspendu</option></select></label>
        <label>Durée d’essai (jours)<input name="trialDays" type="number" min={1} max={365} defaultValue={30} required /></label>
        <label>Note interne<textarea name="note" maxLength={1000} /></label><label>Motif d’onboarding<textarea name="reason" minLength={3} maxLength={1000} required /></label>
        <div className="platformActions"><button className="platformButton platformButton--danger" disabled={loading}>{loading ? "Traitement…" : "Vérifier et créer"}</button></div>
      </form>
      {success ? <p><strong>Organisation créée avec succès.</strong> Vérifiez le journal et la fiche organisation.</p> : null}{error ? <p className="platformError">{error}</p> : null}
    </Panel>
  </>;
}
