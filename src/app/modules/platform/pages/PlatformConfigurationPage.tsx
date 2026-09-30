import { useState, type FormEvent } from "react";
import { Helmet } from "react-helmet-async";
import { normalizeError } from "@errors/errors";
import { AsyncState, Badge, PageHeader, Panel } from "../components/PlatformUi";
import { formatDate } from "../components/platformFormat";
import { platformAdminRepo } from "../data/platformAdminRepo";
import { usePlatformQuery } from "../hooks/usePlatformQuery";
import { usePlatformSecurity } from "../security/PlatformSecurityContext";

export function PlatformConfigurationPage() {
  const query = usePlatformQuery(platformAdminRepo.configuration);
  const { runCritical } = usePlatformSecurity();
  const [registrationDraft, setRegistrationDraft] = useState<boolean | null>(
    null,
  );
  const [messageDraft, setMessageDraft] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const registrationsOpen =
    registrationDraft ?? query.data?.registrationsOpen ?? false;
  const publicMessage =
    messageDraft ?? query.data?.registrationPublicMessage ?? "";

  const saveRegistration = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await runCritical(
        "settings.registrations.set",
        "global",
        `${registrationsOpen ? "Ouvrir" : "Fermer"} les inscriptions sur toute la plateforme ?`,
        (token) =>
          platformAdminRepo.setRegistrationState(
            {
              registrationsOpen,
              registrationPublicMessage: publicMessage,
              reason,
            },
            token,
          ),
      );
      setNotice("État global mis à jour et ajouté au journal d’audit.");
      setReason("");
      await query.reload();
    } catch (cause) {
      if ((cause as Error).message !== "Action annulée")
        setError(normalizeError(cause, "Mise à jour impossible.").message);
    }
  };

  return (
    <>
      <Helmet>
        <title>Configuration · Eventflow Platform</title>
      </Helmet>
      <PageHeader
        eyebrow="Contrôles globaux"
        title="Configuration plateforme"
        description="Pilotez les fonctions transversales qui influencent l’accès à la plateforme."
      >
        <Badge tone={query.data?.registrationsOpen ? "good" : "warning"}>
          {query.data?.registrationsOpen
            ? "Inscriptions ouvertes"
            : "Inscriptions fermées"}
        </Badge>
      </PageHeader>
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
      <AsyncState loading={query.loading} error={query.error}>
        <div className="platformGrid">
          <Panel
            eyebrow="Accès public"
            title="Inscriptions globales"
            description="Ce coupe-circuit bloque ou réouvre la création de nouveaux comptes. La connexion des comptes existants reste disponible."
            className="platformPanel--seven"
          >
            <form
              onSubmit={(event) => void saveRegistration(event)}
              className="platformFormGrid"
            >
              <fieldset className="platformChoiceGroup">
                <legend>État des inscriptions</legend>
                <label
                  className={
                    registrationsOpen
                      ? "platformChoice platformChoice--active"
                      : "platformChoice"
                  }
                >
                  <input
                    type="radio"
                    name="registration-state"
                    checked={registrationsOpen}
                    onChange={() => setRegistrationDraft(true)}
                  />
                  <span>
                    <strong>Ouvertes</strong>
                    <small>Les visiteurs peuvent créer un compte.</small>
                  </span>
                </label>
                <label
                  className={
                    !registrationsOpen
                      ? "platformChoice platformChoice--active"
                      : "platformChoice"
                  }
                >
                  <input
                    type="radio"
                    name="registration-state"
                    checked={!registrationsOpen}
                    onChange={() => setRegistrationDraft(false)}
                  />
                  <span>
                    <strong>Fermées</strong>
                    <small>
                      La page explique que les inscriptions sont suspendues.
                    </small>
                  </span>
                </label>
              </fieldset>
              <label>
                Message public
                <textarea
                  required
                  minLength={1}
                  maxLength={500}
                  value={publicMessage}
                  onChange={(event) => setMessageDraft(event.target.value)}
                />
              </label>
              <label>
                Motif interne
                <textarea
                  required
                  minLength={3}
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Pourquoi ce changement est-il nécessaire ?"
                />
              </label>
              <div className="platformCriticalBar">
                <div>
                  <strong>Action à portée globale</strong>
                  <span>Une nouvelle validation TOTP sera demandée.</span>
                </div>
                <button className="platformButton platformButton--danger">
                  Réauthentifier et appliquer
                </button>
              </div>
            </form>
          </Panel>
          <Panel
            eyebrow="Aperçu"
            title="Message côté visiteur"
            description="Le texte est rendu sans HTML arbitraire."
            className="platformPanel--five platformPreviewPanel"
          >
            <div className="platformPublicPreview">
              <span className="platformPublicPreview__mark">EF</span>
              <p className="platformEyebrow">Création de compte</p>
              <h3>
                {registrationsOpen
                  ? "Bienvenue sur Eventflow"
                  : "Inscriptions temporairement fermées"}
              </h3>
              <p>{publicMessage || "Votre message s’affichera ici."}</p>
              <button type="button" disabled>
                {registrationsOpen ? "Créer mon compte" : "Indisponible"}
              </button>
            </div>
            <p className="platformMuted">
              Dernière mise à jour : {formatDate(query.data?.updatedAt ?? null)}
            </p>
          </Panel>
        </div>
      </AsyncState>
    </>
  );
}
