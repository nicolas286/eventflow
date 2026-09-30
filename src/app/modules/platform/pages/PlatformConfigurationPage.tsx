import { useState, type FormEvent } from "react";
import { Helmet } from "react-helmet-async";
import { normalizeError } from "@errors/errors";
import { platformAdminRepo } from "../data/platformAdminRepo";
import { usePlatformQuery } from "../hooks/usePlatformQuery";
import { usePlatformSecurity } from "../security/PlatformSecurityContext";
import { AsyncState, Badge, PageHeader, Panel } from "../components/PlatformUi";
import { formatDate } from "../components/platformFormat";
import type { PlatformConfiguration } from "@contracts/platform-admin";

type Announcement = PlatformConfiguration["announcements"][number];

export function PlatformConfigurationPage() {
  const query = usePlatformQuery(platformAdminRepo.configuration); const { runCritical } = usePlatformSecurity();
  const [registrationDraft, setRegistrationDraft] = useState<boolean | null>(null); const [messageDraft, setMessageDraft] = useState<string | null>(null);
  const [reason, setReason] = useState(""); const [actionReason, setActionReason] = useState("");
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const registrationsOpen = registrationDraft ?? query.data?.registrationsOpen ?? false;
  const publicMessage = messageDraft ?? query.data?.registrationPublicMessage ?? "";

  const saveRegistration = async (event: FormEvent) => {
    event.preventDefault(); setError(null); setNotice(null);
    try { await runCritical("settings.registrations.set", "global", `${registrationsOpen ? "Ouvrir" : "Couper"} les inscriptions sur toute la plateforme ?`, (token) => platformAdminRepo.setRegistrationState({ registrationsOpen, registrationPublicMessage: publicMessage, reason }, token)); setNotice("État global mis à jour et audité."); await query.reload(); }
    catch (cause) { if ((cause as Error).message !== "Action annulée") setError(normalizeError(cause, "Mise à jour impossible.").message); }
  };
  const saveDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(null); const form = new FormData(event.currentTarget);
    const startsAt = String(form.get("startsAt")); const endsAt = String(form.get("endsAt"));
    try { await platformAdminRepo.saveAnnouncement({ id: editing?.id, title: String(form.get("title")), body: String(form.get("body")), level: String(form.get("level")), audience: String(form.get("audience")), startsAt: startsAt ? new Date(startsAt).toISOString() : null, endsAt: endsAt ? new Date(endsAt).toISOString() : null, reason: String(form.get("reason")) }); setNotice("Brouillon enregistré, sans effet public."); setEditing(null); await query.reload(); event.currentTarget.reset(); }
    catch (cause) { setError(normalizeError(cause, "Enregistrement impossible.").message); }
  };
  const changeAnnouncement = async (id: string, kind: "publish" | "retire") => {
    if (actionReason.trim().length < 3) { setError("Indiquez un motif de publication ou de retrait."); return; }
    const action = kind === "publish" ? "announcements.publish" : "announcements.retire";
    try { await runCritical(action, id, `${kind === "publish" ? "Publier" : "Retirer"} ce message global ?`, (token) => kind === "publish" ? platformAdminRepo.publishAnnouncement(id, actionReason, token) : platformAdminRepo.retireAnnouncement(id, actionReason, token)); setNotice(kind === "publish" ? "Message publié." : "Message retiré."); await query.reload(); }
    catch (cause) { if ((cause as Error).message !== "Action annulée") setError(normalizeError(cause, "Action impossible.").message); }
  };
  return <><Helmet><title>Configuration · Eventflow Platform</title></Helmet><PageHeader eyebrow="Contrôles globaux" title="Configuration plateforme" />
    <AsyncState loading={query.loading} error={query.error}><div className="platformGrid">
      <Panel title="Inscriptions globales" className="platformPanel--half"><form onSubmit={(event) => void saveRegistration(event)} className="platformFormGrid"><label>État<select value={registrationsOpen ? "open" : "closed"} onChange={(event) => setRegistrationDraft(event.target.value === "open")}><option value="closed">Fermées</option><option value="open">Ouvertes</option></select></label><label>Message public<textarea required minLength={1} maxLength={500} value={publicMessage} onChange={(event) => setMessageDraft(event.target.value)} /></label><label>Motif interne<textarea required minLength={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="platformButton platformButton--danger">Réauthentifier et appliquer</button></form><p><Badge tone={query.data?.registrationsOpen ? "good" : "danger"}>{query.data?.registrationsOpen ? "OUVERTES" : "FERMÉES"}</Badge> · dernière mise à jour {formatDate(query.data?.updatedAt ?? null)}</p></Panel>
      <Panel title="Aperçu du message public" className="platformPanel--half"><div className="platformSplit"><div><p className="platformMuted">Desktop</p><div className="platformAnnouncement platformAnnouncement--maintenance"><strong>Information Eventflow</strong><p>{publicMessage || "Votre message s’affichera ici."}</p></div></div><div><p className="platformMuted">Mobile</p><div className="platformAnnouncement platformAnnouncement--maintenance"><strong>Information Eventflow</strong><p>{publicMessage || "Votre message s’affichera ici."}</p></div></div></div><p className="platformMuted">Le contenu est rendu comme texte, sans HTML arbitraire.</p></Panel>
      <Panel title={editing ? "Modifier le brouillon" : "Nouveau message global"}><form key={editing?.id ?? "new"} onSubmit={(event) => void saveDraft(event)} className="platformFormGrid"><label>Titre<input name="title" required maxLength={120} defaultValue={editing?.title} /></label><label>Niveau<select name="level" defaultValue={editing?.level ?? "information"}><option value="information">Information</option><option value="warning">Avertissement</option><option value="maintenance">Maintenance</option></select></label><label>Audience<select name="audience" defaultValue={editing?.audience ?? "both"}><option value="both">Tout le monde</option><option value="organizer">Organisateurs</option><option value="public">Public</option></select></label><label>Début<input name="startsAt" type="datetime-local" defaultValue={editing?.startsAt?.slice(0, 16)} /></label><label>Fin<input name="endsAt" type="datetime-local" defaultValue={editing?.endsAt?.slice(0, 16)} /></label><label>Contenu<textarea name="body" required maxLength={2000} defaultValue={editing?.body} /></label><label>Note de brouillon<input name="reason" maxLength={1000} /></label><button className="platformButton">Enregistrer le brouillon</button>{editing ? <button type="button" className="platformButton platformButton--secondary" onClick={() => setEditing(null)}>Annuler la modification</button> : null}</form></Panel>
      <Panel title="Historique des messages"><label>Motif pour publication/retrait<input value={actionReason} onChange={(event) => setActionReason(event.target.value)} minLength={3} /></label><ul className="platformList">{query.data?.announcements.map((item) => <li key={item.id}><div className={`platformAnnouncement platformAnnouncement--${item.level}`}><strong>{item.title}</strong> <Badge tone={item.status === "published" ? "good" : item.status === "retired" ? "danger" : "neutral"}>{item.status}</Badge><p>{item.body}</p><div className="platformMuted">{item.audience} · fenêtre {formatDate(item.startsAt)} → {formatDate(item.endsAt)} · mis à jour par {item.updatedBy} le {formatDate(item.updatedAt)}</div></div><div className="platformActions">{item.status === "draft" ? <button className="platformButton platformButton--secondary" onClick={() => setEditing(item)}>Modifier</button> : null}{item.status !== "published" ? <button className="platformButton" onClick={() => void changeAnnouncement(item.id, "publish")}>Publier</button> : null}{item.status !== "retired" ? <button className="platformButton platformButton--danger" onClick={() => void changeAnnouncement(item.id, "retire")}>Retirer</button> : null}</div></li>)}</ul></Panel>
      {notice ? <Panel><p>{notice}</p></Panel> : null}{error ? <Panel><p className="platformError">{error}</p></Panel> : null}
    </div></AsyncState>
  </>;
}
