import { useMemo, useState, type FormEvent } from "react";
import { Helmet } from "react-helmet-async";
import { normalizeError } from "@errors/errors";
import type {
  PlatformConfiguration,
  PlatformEmailCampaignResult,
} from "@contracts/platform-admin";
import { AsyncState, Badge, PageHeader, Panel } from "../components/PlatformUi";
import { formatDate } from "../components/platformFormat";
import { platformAdminRepo } from "../data/platformAdminRepo";
import { usePlatformQuery } from "../hooks/usePlatformQuery";
import { usePlatformSecurity } from "../security/PlatformSecurityContext";

type Announcement = PlatformConfiguration["announcements"][number];

function announcementState(item: Announcement) {
  if (item.status !== "published") return item.status;
  const now = Date.now();
  if (item.startsAt && Date.parse(item.startsAt) > now) return "scheduled";
  if (item.endsAt && Date.parse(item.endsAt) <= now) return "expired";
  return "active";
}

function announcementTone(
  state: string,
): "neutral" | "good" | "warning" | "danger" {
  if (state === "active") return "good";
  if (state === "scheduled") return "warning";
  if (state === "retired" || state === "expired") return "danger";
  return "neutral";
}

export function PlatformCommunicationsPage() {
  const announcements = usePlatformQuery(
    platformAdminRepo.configuration,
    "communications-announcements",
  );
  const campaigns = usePlatformQuery(
    platformAdminRepo.communications,
    "communications-campaigns",
  );
  const organizations = usePlatformQuery(
    () =>
      platformAdminRepo.organizations(new URLSearchParams({ limit: "100" })),
    "communications-organizations",
  );
  const { runCritical } = usePlatformSecurity();
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [emailTarget, setEmailTarget] = useState<"all" | "organization">("all");
  const [organizationId, setOrganizationId] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailReason, setEmailReason] = useState("");
  const [emailIdempotencyKey, setEmailIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedOrganization = useMemo(
    () =>
      organizations.data?.items.find((item) => item.id === organizationId) ??
      null,
    [organizationId, organizations.data?.items],
  );

  const saveDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const startsAt = String(form.get("startsAt"));
    const endsAt = String(form.get("endsAt"));
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await platformAdminRepo.saveAnnouncement({
        id: editing?.id,
        title: String(form.get("title")),
        body: String(form.get("body")),
        level: String(form.get("level")),
        audience: String(form.get("audience")),
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        reason: String(form.get("reason")),
      });
      setNotice(
        "Brouillon enregistré. Il ne sera visible qu’après publication.",
      );
      setEditing(null);
      formElement.reset();
      await announcements.reload();
    } catch (cause) {
      setError(normalizeError(cause, "Enregistrement impossible.").message);
    } finally {
      setBusy(false);
    }
  };

  const changeAnnouncement = async (id: string, kind: "publish" | "retire") => {
    if (actionReason.trim().length < 3) {
      setError(
        "Indiquez un motif interne avant de publier ou retirer un message.",
      );
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await runCritical(
        kind === "publish" ? "announcements.publish" : "announcements.retire",
        id,
        `${kind === "publish" ? "Publier" : "Retirer"} ce message sur les interfaces sélectionnées ?`,
        (token) =>
          kind === "publish"
            ? platformAdminRepo.publishAnnouncement(id, actionReason, token)
            : platformAdminRepo.retireAnnouncement(id, actionReason, token),
      );
      setNotice(
        kind === "publish"
          ? "Message publié selon sa fenêtre de diffusion."
          : "Message retiré immédiatement.",
      );
      setActionReason("");
      await announcements.reload();
    } catch (cause) {
      if ((cause as Error).message !== "Action annulée") {
        setError(normalizeError(cause, "Action impossible.").message);
      }
    }
  };

  const sendCampaign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const targetId =
      emailTarget === "all" ? "all-organizations" : organizationId;
    if (!targetId) {
      setError("Sélectionnez une organisation destinataire.");
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const resultHolder: { value?: PlatformEmailCampaignResult } = {};
      await runCritical(
        "communications.email.send",
        targetId,
        emailTarget === "all"
          ? "Envoyer cet e-mail à tous les propriétaires d’organisation confirmés ?"
          : `Envoyer cet e-mail au propriétaire de ${selectedOrganization?.name ?? "cette organisation"} ?`,
        async (token) => {
          resultHolder.value = await platformAdminRepo.sendEmailCampaign(
            {
              target: emailTarget,
              organizationId:
                emailTarget === "organization" ? organizationId : null,
              subject: emailSubject,
              body: emailBody,
              reason: emailReason,
              idempotencyKey: emailIdempotencyKey,
            },
            token,
          );
        },
      );
      if (resultHolder.value) {
        const completed = resultHolder.value;
        setNotice(
          `Campagne terminée : ${completed.sentCount}/${completed.recipientCount} e-mail(s) envoyé(s), ${completed.failedCount} échec(s).`,
        );
      }
      setEmailSubject("");
      setEmailBody("");
      setEmailReason("");
      setEmailIdempotencyKey(crypto.randomUUID());
      await campaigns.reload();
    } catch (cause) {
      if ((cause as Error).message !== "Action annulée") {
        setError(normalizeError(cause, "Envoi impossible.").message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Communications · Eventflow Platform</title>
      </Helmet>
      <PageHeader
        eyebrow="Diffusion centralisée"
        title="Communications"
        description="Informez les organisateurs dans l’application ou par e-mail, avec planification, double validation et historique."
      >
        <Badge tone="good">Canal sécurisé</Badge>
      </PageHeader>

      <div className="platformTabs" aria-label="Canaux disponibles">
        <a href="#messages">Messages dans l’application</a>
        <a href="#email">Campagnes e-mail</a>
        <a href="#history">Historique</a>
      </div>

      {notice ? (
        <div className="platformNotice platformNotice--success" role="status">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="platformNotice platformNotice--error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="platformGrid">
        <Panel
          id="messages"
          eyebrow="Message in-app"
          title={editing ? "Modifier le message" : "Créer un message"}
          description="Affichage sur l’interface organisateur, le site public, ou les deux. La période est facultative."
          className="platformPanel--seven"
        >
          <form
            key={editing?.id ?? "new"}
            onSubmit={(event) => void saveDraft(event)}
            className="platformFormGrid platformFormGrid--two"
          >
            <label className="platformField--wide">
              Titre
              <input
                name="title"
                required
                maxLength={120}
                defaultValue={editing?.title}
                placeholder="Maintenance planifiée"
              />
            </label>
            <label>
              Niveau
              <select
                name="level"
                defaultValue={editing?.level ?? "information"}
              >
                <option value="information">Information</option>
                <option value="warning">Avertissement</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </label>
            <label>
              Audience
              <select
                name="audience"
                defaultValue={editing?.audience ?? "organizer"}
              >
                <option value="organizer">Interfaces organisateur</option>
                <option value="public">Interfaces publiques</option>
                <option value="both">Toutes les interfaces</option>
              </select>
            </label>
            <label>
              Début de diffusion
              <input
                name="startsAt"
                type="datetime-local"
                defaultValue={editing?.startsAt?.slice(0, 16)}
              />
            </label>
            <label>
              Fin de diffusion
              <input
                name="endsAt"
                type="datetime-local"
                defaultValue={editing?.endsAt?.slice(0, 16)}
              />
            </label>
            <label className="platformField--wide">
              Contenu
              <textarea
                name="body"
                required
                maxLength={2000}
                defaultValue={editing?.body}
                placeholder="Expliquez clairement ce qui change pour les organisateurs…"
              />
            </label>
            <label className="platformField--wide">
              Note interne <span className="platformOptional">facultatif</span>
              <input
                name="reason"
                maxLength={1000}
                placeholder="Contexte pour l’équipe Eventflow"
              />
            </label>
            <div className="platformActions platformField--wide">
              <button className="platformButton" disabled={busy}>
                Enregistrer le brouillon
              </button>
              {editing ? (
                <button
                  type="button"
                  className="platformButton platformButton--secondary"
                  onClick={() => setEditing(null)}
                >
                  Annuler
                </button>
              ) : null}
            </div>
          </form>
        </Panel>

        <Panel
          eyebrow="Aperçu"
          title="Rendu organisateur"
          description="Le contenu est affiché comme texte sécurisé, sans HTML arbitraire."
          className="platformPanel--five platformPreviewPanel"
        >
          <div
            className={`platformAnnouncement platformAnnouncement--${editing?.level ?? "information"}`}
          >
            <span className="platformAnnouncementIcon" aria-hidden="true">
              i
            </span>
            <div>
              <strong>{editing?.title ?? "Information Eventflow"}</strong>
              <p>
                {editing?.body ??
                  "Votre message apparaîtra ici sur l’interface des organisateurs."}
              </p>
            </div>
          </div>
          <div className="platformPreviewMeta">
            <span>
              Audience{" "}
              <strong>
                {editing?.audience === "both"
                  ? "Toutes"
                  : editing?.audience === "public"
                    ? "Public"
                    : "Organisateurs"}
              </strong>
            </span>
            <span>
              Programmation{" "}
              <strong>
                {editing?.startsAt || editing?.endsAt
                  ? "Planifiée"
                  : "Immédiate"}
              </strong>
            </span>
          </div>
        </Panel>

        <Panel
          id="email"
          eyebrow="Campagne e-mail"
          title="Écrire aux organisations"
          description="Un seul e-mail est envoyé par organisation, au propriétaire confirmé. L’envoi exige votre code TOTP."
          className="platformPanel--seven"
        >
          <form
            onSubmit={(event) => void sendCampaign(event)}
            className="platformFormGrid platformFormGrid--two"
          >
            <label>
              Destinataires
              <select
                value={emailTarget}
                onChange={(event) =>
                  setEmailTarget(event.target.value as "all" | "organization")
                }
              >
                <option value="all">Toutes les organisations</option>
                <option value="organization">Une organisation</option>
              </select>
            </label>
            <label>
              Organisation
              <select
                disabled={emailTarget === "all" || organizations.loading}
                required={emailTarget === "organization"}
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
              >
                <option value="">Sélectionner…</option>
                {organizations.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ·{" "}
                    {item.ownerEmail ?? "sans propriétaire confirmé"}
                  </option>
                ))}
              </select>
            </label>
            <label className="platformField--wide">
              Objet
              <input
                required
                maxLength={160}
                value={emailSubject}
                onChange={(event) => setEmailSubject(event.target.value)}
                placeholder="Information importante concernant Eventflow"
              />
            </label>
            <label className="platformField--wide">
              Message
              <textarea
                required
                maxLength={10000}
                value={emailBody}
                onChange={(event) => setEmailBody(event.target.value)}
                placeholder="Bonjour, …"
              />
            </label>
            <label className="platformField--wide">
              Motif interne
              <input
                required
                minLength={3}
                maxLength={1000}
                value={emailReason}
                onChange={(event) => setEmailReason(event.target.value)}
                placeholder="Pourquoi cet envoi est nécessaire"
              />
            </label>
            <div className="platformCriticalBar platformField--wide">
              <div>
                <strong>
                  {emailTarget === "all"
                    ? "Diffusion globale"
                    : (selectedOrganization?.name ?? "Diffusion ciblée")}
                </strong>
                <span>
                  {emailTarget === "all"
                    ? "Tous les propriétaires confirmés, sans doublon"
                    : (selectedOrganization?.ownerEmail ??
                      "Choisissez une organisation")}
                </span>
              </div>
              <button
                className="platformButton platformButton--danger"
                disabled={
                  busy || (emailTarget === "organization" && !organizationId)
                }
              >
                {busy ? "Traitement…" : "Réauthentifier et envoyer"}
              </button>
            </div>
          </form>
        </Panel>

        <Panel
          eyebrow="Sécurité"
          title="Garde-fous d’envoi"
          className="platformPanel--five"
        >
          <ol className="platformGuardrails">
            <li>
              <span>1</span>
              <div>
                <strong>Ciblage vérifié</strong>
                <p>
                  Les destinataires sont reconstruits côté serveur au moment de
                  l’envoi, avec un maximum de 100 par campagne.
                </p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Double validation</strong>
                <p>Session AAL2 et nouveau code TOTP pour chaque campagne.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Traçabilité complète</strong>
                <p>
                  Motif, auteur, cible et résultat restent dans le journal
                  privé.
                </p>
              </div>
            </li>
          </ol>
        </Panel>

        <Panel
          id="history"
          eyebrow="Messages in-app"
          title="Diffusions récentes"
          description="Publier active le message immédiatement ou à la date prévue."
        >
          <AsyncState
            loading={announcements.loading}
            error={announcements.error}
            empty={announcements.data?.announcements.length === 0}
          >
            <label className="platformInlineReason">
              Motif pour la prochaine publication ou suppression
              <input
                value={actionReason}
                onChange={(event) => setActionReason(event.target.value)}
                minLength={3}
                placeholder="Décision validée par…"
              />
            </label>
            <div className="platformCardList">
              {announcements.data?.announcements.map((item) => {
                const state = announcementState(item);
                return (
                  <article className="platformHistoryCard" key={item.id}>
                    <div className="platformHistoryCard__main">
                      <div className="platformHistoryCard__top">
                        <strong>{item.title}</strong>
                        <Badge tone={announcementTone(state)}>{state}</Badge>
                      </div>
                      <p>{item.body}</p>
                      <div className="platformHistoryCard__meta">
                        <span>{item.audience}</span>
                        <span>
                          {formatDate(item.startsAt)} →{" "}
                          {formatDate(item.endsAt)}
                        </span>
                        <span>Mis à jour {formatDate(item.updatedAt)}</span>
                      </div>
                    </div>
                    <div className="platformActions">
                      {item.status === "draft" ? (
                        <button
                          className="platformButton platformButton--secondary"
                          onClick={() => setEditing(item)}
                        >
                          Modifier
                        </button>
                      ) : null}
                      {item.status !== "published" ? (
                        <button
                          className="platformButton"
                          onClick={() =>
                            void changeAnnouncement(item.id, "publish")
                          }
                        >
                          Publier
                        </button>
                      ) : null}
                      {item.status !== "retired" ? (
                        <button
                          className="platformButton platformButton--ghostDanger"
                          onClick={() =>
                            void changeAnnouncement(item.id, "retire")
                          }
                        >
                          Retirer
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </AsyncState>
        </Panel>

        <Panel eyebrow="Campagnes e-mail" title="Historique des envois">
          <AsyncState
            loading={campaigns.loading}
            error={campaigns.error}
            empty={campaigns.data?.items.length === 0}
          >
            <div className="platformTableWrap">
              <table className="platformTable">
                <thead>
                  <tr>
                    <th>Campagne</th>
                    <th>Cible</th>
                    <th>Résultat</th>
                    <th>État</th>
                    <th>Auteur</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.data?.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.subject}</strong>
                        <div className="platformMuted">{item.reason}</div>
                      </td>
                      <td>
                        {item.organizationName ?? "Toutes les organisations"}
                      </td>
                      <td>
                        {item.sentCount}/{item.recipientCount} envoyés
                        {item.failedCount > 0
                          ? ` · ${item.failedCount} échec(s)`
                          : ""}
                      </td>
                      <td>
                        <Badge
                          tone={
                            item.status === "completed"
                              ? "good"
                              : item.status === "sending"
                                ? "warning"
                                : "danger"
                          }
                        >
                          {item.status}
                        </Badge>
                      </td>
                      <td>{item.actorEmail}</td>
                      <td>{formatDate(item.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AsyncState>
        </Panel>
      </div>
    </>
  );
}
