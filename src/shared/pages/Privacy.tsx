import { useNavigate } from "react-router-dom";

import Container from "@ui/components/container/Container";
import Card, { CardBody, CardHeader } from "@ui/components/card/Card";
import Button from "@ui/components/button/Button";

import "./legalPage.desktop.css";
import "./legalPage.mobile.css";

export default function PrivacyPage() {
  const navigate = useNavigate();

  return (
    <Container>
      <div className="legalPage">
        <Card>
          <CardHeader title="Politique de confidentialité" />

          <CardBody>
            <section className="legalSection">
              <p>
                Conformément au Règlement Général sur la Protection des Données
                (RGPD), cette page explique comment les données personnelles
                sont collectées, utilisées et protégées lors de l’utilisation du
                site Eventflow.
              </p>
              <p>
                Eventflow est une plateforme permettant aux organisateurs de
                gérer leurs événements, inscriptions et réservations en ligne.
                Seules les données strictement nécessaires au fonctionnement du
                service sont collectées.
              </p>
            </section>

            <section className="legalSection">
              <h2>Responsable du traitement</h2>
              <p>
                <strong>Nom commercial :</strong> Eventflow
              </p>
              <p>
                <strong>Responsable :</strong> Nicolas Manns
              </p>
              <p>
                <strong>Adresse :</strong> Rue Féral 43, 5190
                Jemeppe-sur-Sambre, Belgique
              </p>
              <p>
                <strong>Adresse e-mail :</strong>{" "}
                <a href="mailto:contact@useeventflow.eu">
                  contact@useeventflow.eu
                </a>
              </p>
            </section>

            <section className="legalSection">
              <h2>Base juridique du traitement</h2>
              <ul>
                <li>
                  Le traitement des données nécessaires à la création de compte
                  et à l’utilisation de la plateforme repose sur l’exécution du
                  contrat (article 6-1 b du RGPD).
                </li>
                <li>
                  L’analyse statistique anonyme du site repose sur l’intérêt
                  légitime de l’éditeur (article 6-1 f du RGPD).
                </li>
              </ul>
            </section>

            <section className="legalSection">
              <h2>Données collectées</h2>

              <h3>Lors de la navigation</h3>
              <p>
                Des données techniques peuvent être collectées afin d’assurer le
                bon fonctionnement et la sécurité du site (pages consultées,
                type d’appareil, navigateur).
              </p>
              <p>
                Ces données sont utilisées de manière anonymisée et ne
                permettent pas une identification directe des utilisateurs.
              </p>

              <h3>Lors de la création de compte</h3>
              <p>Les données suivantes peuvent être collectées :</p>
              <ul>
                <li>Nom et prénom,</li>
                <li>Adresse e-mail,</li>
                <li>Données nécessaires à la facturation.</li>
              </ul>

              <h3>Lors des réservations d’événements</h3>
              <p>
                Les informations demandées aux participants (nom, e-mail,
                téléphone ou autres informations définies par l’organisateur)
                sont collectées pour le compte de l’organisateur de l’événement.
              </p>

              <h3>Lors d’un paiement</h3>
              <p>
                Les paiements par carte ou Bancontact sont traités par Stripe
                pour le compte de l’organisateur, vendeur des billets. Eventflow
                transmet à Stripe les données nécessaires au paiement et à sa
                sécurisation, notamment le montant, la devise, la référence de
                commande et l’adresse e-mail de l’acheteur. Eventflow ne reçoit
                pas les données complètes de la carte bancaire.
              </p>
              <p>
                Stripe traite ces données selon sa propre politique de
                confidentialité, accessible sur{" "}
                <a
                  href="https://stripe.com/fr-be/privacy"
                  target="_blank"
                  rel="noreferrer"
                >
                  stripe.com/fr-be/privacy
                </a>
                .
              </p>
              <p>
                <strong>
                  Chaque organisateur est responsable du traitement des données
                  liées aux réservations de ses événements.
                </strong>{" "}
                Eventflow agit en qualité de sous-traitant technique pour
                l’hébergement et la gestion de ces données.
              </p>
            </section>

            <section className="legalSection">
              <h2>Durée de conservation</h2>
              <ul>
                <li>
                  Les données liées aux comptes utilisateurs sont conservées
                  pendant la durée d’utilisation du service.
                </li>
                <li>
                  Les données liées aux réservations sont conservées selon les
                  paramètres définis par l’organisateur, dans le respect de la
                  législation applicable.
                </li>
                <li>
                  Les données statistiques anonymisées sont conservées pour une
                  durée maximale de 13 mois.
                </li>
              </ul>
            </section>

            <section className="legalSection">
              <h2>Finalité de l’utilisation des données</h2>
              <p>Les données sont utilisées uniquement pour :</p>
              <ul>
                <li>Assurer le bon fonctionnement de la plateforme,</li>
                <li>
                  Permettre la gestion des événements et des réservations,
                </li>
                <li>Garantir la sécurité du service,</li>
                <li>
                  Répondre aux demandes envoyées via le formulaire de contact,
                </li>
                <li>
                  Créer, sécuriser et rapprocher les paiements via Stripe.
                </li>
              </ul>
              <p>
                Les données ne sont pas vendues. Elles peuvent être communiquées
                aux organisateurs concernés, à Stripe et aux prestataires
                techniques strictement nécessaires au service, ainsi qu’aux
                autorités lorsqu’une obligation légale l’impose.
              </p>
            </section>

            <section className="legalSection">
              <h2>Vos droits</h2>
              <p>Conformément au RGPD, vous disposez des droits suivants :</p>
              <ul>
                <li>Droit d’accès à vos données,</li>
                <li>Droit de rectification,</li>
                <li>Droit à l’effacement,</li>
                <li>
                  Droit d’opposition, dans les limites prévues par la loi.
                </li>
              </ul>
              <p>
                Pour exercer vos droits, vous pouvez contacter :{" "}
                <a href="mailto:contact@useeventflow.eu">
                  contact@useeventflow.eu
                </a>
              </p>
            </section>

            {/* -------- Footer actions -------- */}
            <div className="legalFooter">
              <Button variant="secondary" onClick={() => navigate(-1)}>
                ← Retour
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </Container>
  );
}
