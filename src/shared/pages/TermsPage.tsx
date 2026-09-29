import { useNavigate } from "react-router-dom";

import { Container } from "@ui/components";
import Card, { CardBody, CardHeader } from "@ui/components/card/Card";
import Button from "@ui/components/button/Button";

import "./legalPage.desktop.css";
import "./legalPage.mobile.css";

export default function TermsPage() {
  const navigate = useNavigate();

  return (
    <Container>
      <div className="legalPage">
        <Card>
          <CardHeader title="Conditions générales d’utilisation d’Eventflow" />

          <CardBody>
            <section className="legalSection">
              <p>
                Les présentes conditions générales d’utilisation (« CGU »)
                encadrent l’accès et l’utilisation de la plateforme Eventflow.
              </p>
              <p>
                Toute création de compte ou utilisation des fonctionnalités
                nécessitant un compte implique l’acceptation des présentes CGU.
              </p>
            </section>

            <section className="legalSection">
              <h2>1. Objet du service</h2>
              <p>
                Eventflow est une plateforme logicielle permettant notamment aux
                organisateurs :
              </p>
              <ul>
                <li>de créer et gérer des événements ;</li>
                <li>de publier des pages événementielles ;</li>
                <li>de gérer les réservations et participants ;</li>
                <li>de proposer des billets ou inscriptions payantes ;</li>
                <li>
                  d’utiliser des solutions de paiement intégrées proposées par
                  des prestataires de paiement tiers.
                </li>
              </ul>
              <p>Eventflow fournit une infrastructure technique.</p>
              <p>
                Sauf indication expresse contraire, Eventflow n’est ni
                l’organisateur de l’événement, ni le vendeur des billets ou
                prestations proposées par l’organisateur.
              </p>
              <p>
                Le contrat relatif à la participation à un événement est conclu
                directement entre l’organisateur et le participant.
              </p>
            </section>

            <section className="legalSection">
              <h2>2. Création et utilisation du compte</h2>
              <p>
                L’utilisateur s’engage à fournir des informations exactes,
                complètes et à jour.
              </p>
              <p>
                Il est responsable de la confidentialité de ses identifiants et
                des actions réalisées depuis son compte.
              </p>
              <p>
                L’utilisateur doit informer Eventflow dans les meilleurs délais
                en cas d’accès non autorisé ou de suspicion de compromission de
                son compte.
              </p>
              <p>
                Lorsqu’un compte est créé pour le compte d’une société, d’une
                association, d’une association de fait ou de toute autre
                organisation, la personne qui procède à l’inscription déclare
                disposer de l’autorité nécessaire pour agir pour le compte de
                celle-ci.
              </p>
            </section>

            <section className="legalSection">
              <h2>3. Responsabilité de l’organisateur</h2>
              <p>Chaque organisateur reste seul responsable notamment :</p>
              <ul>
                <li>
                  de l’existence, du contenu et du bon déroulement de ses
                  événements ;
                </li>
                <li>de l’exactitude des informations publiées ;</li>
                <li>
                  des prix, conditions de réservation, politiques d’annulation
                  et de remboursement ;
                </li>
                <li>
                  du respect de ses obligations légales, administratives,
                  comptables et fiscales ;
                </li>
                <li>
                  des autorisations éventuellement nécessaires à l’organisation
                  de l’événement ;
                </li>
                <li>de la relation avec ses participants ;</li>
                <li>
                  du traitement des demandes de remboursement et réclamations
                  liées à ses événements ;
                </li>
                <li>
                  du respect de la législation applicable en matière de
                  protection des consommateurs lorsque celle-ci s’applique ;
                </li>
                <li>
                  du traitement des données personnelles dont il détermine les
                  finalités et moyens.
                </li>
              </ul>
              <p>
                Eventflow n’est pas partie aux éventuels litiges opposant un
                organisateur à un participant concernant l’événement lui-même.
              </p>
            </section>

            <section className="legalSection">
              <h2>4. Paiements des participants</h2>

              <h3>4.1 Prestataires de paiement tiers</h3>
              <p>
                Les paiements électroniques proposés sur Eventflow sont exécutés
                par un ou plusieurs prestataires de services de paiement tiers.
              </p>
              <p>
                Selon les fonctionnalités utilisées, l’organisateur peut être
                tenu de créer ou connecter un compte auprès de ce prestataire et
                de satisfaire à ses procédures d’identification, de vérification
                ou de conformité (« KYC/KYB »).
              </p>
              <p>
                L’utilisation des services de paiement est également soumise aux
                conditions contractuelles du prestataire concerné.
              </p>

              <h3>4.2 Relation avec le prestataire de paiement</h3>
              <p>
                Le prestataire de paiement reste seul responsable de
                l’acceptation, de la vérification et du maintien du compte de
                paiement de l’organisateur.
              </p>
              <p>Il peut notamment :</p>
              <ul>
                <li>
                  demander des informations ou documents supplémentaires ;
                </li>
                <li>limiter certaines fonctionnalités ;</li>
                <li>retarder ou suspendre des versements ;</li>
                <li>imposer des réserves ;</li>
                <li>refuser certaines transactions ;</li>
                <li>
                  suspendre ou clôturer un compte conformément à ses propres
                  conditions et obligations réglementaires.
                </li>
              </ul>
              <p>
                Eventflow ne peut garantir qu’un organisateur sera accepté ou
                maintenu par un prestataire de paiement donné.
              </p>

              <h3>4.3 Flux financiers</h3>
              <p>
                Lorsque les paiements sont effectués au bénéfice d’un
                organisateur par l’intermédiaire d’un compte de paiement
                connecté, les sommes correspondant aux ventes de l’organisateur
                ne constituent pas des fonds appartenant à Eventflow.
              </p>
              <p>
                Eventflow fournit l’intégration technique permettant la création
                et le suivi des transactions.
              </p>
              <p>
                Les commissions ou abonnements éventuellement dus à Eventflow
                constituent des flux distincts.
              </p>

              <h3>4.4 Litiges, remboursements et chargebacks</h3>
              <p>
                L’organisateur reste responsable des remboursements,
                contestations, litiges et chargebacks relatifs aux paiements
                liés à ses événements, dans les limites et selon les règles
                applicables du prestataire de paiement concerné.
              </p>
              <p>
                L’organisateur s’engage à traiter dans les délais requis toute
                demande de renseignements ou de justificatifs relative à une
                transaction.
              </p>
              <p>
                Eventflow peut suspendre temporairement la possibilité
                d’accepter de nouveaux paiements lorsqu’un compte de paiement
                présente un problème de conformité, un solde négatif, des
                informations manquantes ou toute autre situation empêchant le
                traitement normal des transactions.
              </p>

              <h3>4.5 Changement de prestataire de paiement</h3>
              <p>
                Eventflow peut être amené à ajouter, remplacer ou retirer un
                prestataire de paiement, notamment pour des raisons techniques,
                commerciales, réglementaires, de sécurité ou de continuité du
                service.
              </p>
              <p>
                Un tel changement peut nécessiter que l’organisateur effectue
                une nouvelle procédure d’activation ou de vérification auprès du
                nouveau prestataire.
              </p>
              <p>
                Lorsqu’il est raisonnablement possible de le faire, Eventflow
                informe préalablement les utilisateurs concernés.
              </p>
              <p>
                En cas d’interruption soudaine d’un prestataire, d’incident de
                sécurité, de contrainte réglementaire ou de toute autre
                situation nécessitant une intervention urgente, la modification
                peut être mise en œuvre sans préavis afin de préserver la
                continuité ou la sécurité du service.
              </p>

              <h3>4.6 Moyens de paiement alternatifs</h3>
              <p>
                Eventflow peut proposer des moyens de paiement ne passant pas
                par son prestataire de paiement intégré, notamment le virement
                bancaire direct vers l’organisateur.
              </p>
              <p>
                Dans ce cas, les délais de confirmation et les modalités de
                validation de la réservation peuvent différer d’un paiement
                électronique instantanément confirmé.
              </p>
            </section>

            <section className="legalSection">
              <h2>5. Réservations, billets et remboursements</h2>
              <p>
                Une réservation n’est considérée comme définitivement confirmée
                que lorsque les conditions définies par l’organisateur et
                Eventflow sont remplies, notamment lorsque le paiement requis a
                été confirmé.
              </p>
              <p>
                Pour certains moyens de paiement non instantanés, une
                réservation peut rester temporairement en attente de paiement.
              </p>
              <p>
                Les règles relatives à l’annulation d’un événement, au
                remboursement d’un participant ou à la modification d’une
                réservation sont déterminées par l’organisateur, sous réserve
                des dispositions légales impératives applicables.
              </p>
              <p>
                Eventflow fournit les outils techniques permettant de gérer ces
                opérations mais n’est pas responsable de la décision de
                l’organisateur d’accepter ou de refuser un remboursement.
              </p>
            </section>

            <section className="legalSection">
              <h2>6. Abonnements et facturation Eventflow</h2>
              <p>
                Certaines fonctionnalités d’Eventflow peuvent être soumises à un
                abonnement ou à des frais.
              </p>
              <p>
                Les prix et modalités applicables sont indiqués lors de la
                souscription.
              </p>
              <p>
                Les frais dus à Eventflow sont distincts des recettes encaissées
                par les organisateurs dans le cadre de leurs événements.
              </p>
              <p>
                En cas de défaut de paiement d’une facture Eventflow arrivée à
                échéance, Eventflow peut, après rappel lorsque celui-ci est
                approprié, limiter ou suspendre l’accès aux fonctionnalités
                payantes jusqu’à régularisation.
              </p>
            </section>

            <section className="legalSection">
              <h2>7. Utilisations interdites</h2>
              <p>L’utilisateur s’interdit notamment d’utiliser Eventflow :</p>
              <ul>
                <li>pour organiser ou promouvoir une activité illégale ;</li>
                <li>pour effectuer des transactions frauduleuses ;</li>
                <li>
                  pour fournir volontairement de fausses informations à
                  Eventflow ou à un prestataire de paiement ;
                </li>
                <li>
                  pour contourner les procédures de vérification d’identité ou
                  de conformité ;
                </li>
                <li>pour porter atteinte aux droits de tiers ;</li>
                <li>
                  pour introduire volontairement du contenu ou du code
                  susceptible de compromettre la sécurité de la plateforme.
                </li>
              </ul>
              <p>
                Eventflow peut suspendre immédiatement les fonctionnalités
                concernées lorsqu’une intervention est nécessaire pour des
                raisons de sécurité, de fraude ou de conformité réglementaire.
              </p>
            </section>

            <section className="legalSection">
              <h2>8. Disponibilité du service</h2>
              <p>
                Eventflow met en œuvre des moyens raisonnables afin d’assurer la
                disponibilité et le bon fonctionnement de la plateforme.
              </p>
              <p>
                Toutefois, le service peut connaître des interruptions notamment
                en raison :
              </p>
              <ul>
                <li>d’opérations de maintenance ;</li>
                <li>de mises à jour ;</li>
                <li>d’incidents techniques ;</li>
                <li>
                  de défaillances de fournisseurs d’hébergement ou
                  d’infrastructure ;
                </li>
                <li>d’indisponibilités d’un prestataire de paiement ;</li>
                <li>de réseaux bancaires ou de télécommunication ;</li>
                <li>
                  de mesures nécessaires pour assurer la sécurité ou la
                  conformité du service.
                </li>
              </ul>
              <p>
                Eventflow ne garantit donc pas une disponibilité continue et
                sans interruption.
              </p>
              <p>
                Lorsque cela est raisonnablement possible, Eventflow s’efforce
                de limiter la durée et l’impact de ces interruptions.
              </p>
            </section>

            <section className="legalSection">
              <h2>9. Services de tiers</h2>
              <p>
                Certaines fonctionnalités d’Eventflow reposent sur des services
                fournis par des tiers.
              </p>
              <p>
                L’utilisation de ces services peut être soumise aux conditions
                propres de ces fournisseurs.
              </p>
              <p>
                Eventflow ne peut garantir la disponibilité permanente d’un
                service tiers indépendant de son contrôle mais peut, lorsque
                cela est techniquement et économiquement raisonnable, adapter ou
                remplacer une intégration devenue indisponible.
              </p>
            </section>

            <section className="legalSection">
              <h2>10. Protection des données</h2>
              <p>
                Le traitement des données personnelles réalisé par Eventflow est
                décrit dans sa politique de confidentialité.
              </p>
              <p>
                Selon les opérations concernées, Eventflow et l’organisateur
                peuvent agir en qualité de responsables du traitement distincts
                ou dans le cadre d’une relation de sous-traitance conformément
                au RGPD.
              </p>
              <p>
                L’organisateur reste responsable des traitements de données
                personnelles qu’il détermine dans le cadre de l’organisation de
                ses événements.
              </p>
            </section>

            <section className="legalSection">
              <h2>11. Propriété intellectuelle</h2>
              <p>
                La plateforme Eventflow, son code, son architecture, son
                interface, son design, ses marques et ses éléments graphiques
                sont protégés par les droits de propriété intellectuelle
                applicables.
              </p>
              <p>
                Aucune disposition des présentes CGU n’entraîne le transfert de
                ces droits aux utilisateurs.
              </p>
              <p>
                L’utilisateur reste propriétaire des contenus qu’il fournit à
                Eventflow et accorde à Eventflow les droits strictement
                nécessaires à leur hébergement, reproduction et affichage dans
                le cadre du fonctionnement du service.
              </p>
            </section>

            <section className="legalSection">
              <h2>12. Responsabilité d’Eventflow</h2>
              <p>
                Eventflow est responsable de l’exécution de ses propres
                obligations dans les limites prévues par la loi.
              </p>
              <p>
                Eventflow ne peut être tenu responsable des actes, omissions ou
                manquements :
              </p>
              <ul>
                <li>d’un organisateur ;</li>
                <li>d’un participant ;</li>
                <li>d’un prestataire de paiement ;</li>
                <li>d’un établissement bancaire ;</li>
                <li>ou d’un autre prestataire tiers indépendant,</li>
              </ul>
              <p>lorsque ceux-ci échappent raisonnablement à son contrôle.</p>
              <p>
                Eventflow ne saurait notamment être considéré comme garant de la
                bonne exécution d’un événement ou de la solvabilité d’un
                organisateur.
              </p>
              <p>
                Aucune disposition des présentes CGU n’a pour objet d’exclure
                une responsabilité qui ne pourrait légalement être exclue ou
                limitée.
              </p>
            </section>

            <section className="legalSection">
              <h2>13. Suspension et résiliation</h2>
              <p>
                L’utilisateur peut cesser d’utiliser le service et demander la
                fermeture de son compte conformément aux modalités disponibles
                sur la plateforme.
              </p>
              <p>
                Eventflow peut suspendre tout ou partie d’un compte notamment :
              </p>
              <ul>
                <li>en cas de violation des présentes CGU ;</li>
                <li>en cas de fraude ou suspicion sérieuse de fraude ;</li>
                <li>
                  lorsqu’une obligation légale ou réglementaire l’impose ;
                </li>
                <li>
                  lorsqu’un prestataire de paiement suspend les capacités
                  nécessaires au fonctionnement du compte ;
                </li>
                <li>
                  lorsque la sécurité de la plateforme ou de ses utilisateurs
                  est menacée.
                </li>
              </ul>
              <p>
                Sauf urgence, fraude, obligation réglementaire ou risque de
                sécurité, Eventflow s’efforce d’informer l’utilisateur du motif
                de la suspension et de lui permettre de régulariser la situation
                lorsque cela est raisonnablement possible.
              </p>
            </section>

            <section className="legalSection">
              <h2>14. Modification des CGU</h2>
              <p>
                Eventflow peut modifier les présentes CGU notamment afin de
                tenir compte :
              </p>
              <ul>
                <li>de l’évolution du service ;</li>
                <li>de nouvelles fonctionnalités ;</li>
                <li>d’évolutions réglementaires ;</li>
                <li>
                  de modifications apportées par ses fournisseurs essentiels ;
                </li>
                <li>de nouvelles exigences de sécurité ou de conformité.</li>
              </ul>
              <p>
                Les modifications substantielles sont communiquées aux
                utilisateurs dans un délai raisonnable avant leur entrée en
                vigueur lorsque les circonstances le permettent.
              </p>
              <p>
                Les modifications urgentes rendues nécessaires par une
                obligation légale, une menace de sécurité ou l’interruption d’un
                fournisseur essentiel peuvent prendre effet immédiatement.
              </p>
            </section>

            <section className="legalSection">
              <h2>15. Droit applicable et litiges</h2>
              <p>Les présentes CGU sont soumises au droit belge.</p>
              <p>
                Les parties privilégient, lorsque cela est possible, la
                recherche d’une solution amiable avant toute procédure
                judiciaire.
              </p>
              <p>
                Lorsque l’utilisateur agit dans le cadre de son activité
                professionnelle, les tribunaux du ressort du siège de l’éditeur
                sont compétents, sous réserve des dispositions impératives
                applicables.
              </p>
              <p>
                Lorsqu’une règle impérative de protection du consommateur est
                applicable, les présentes CGU ne portent pas atteinte aux droits
                qui lui sont reconnus par cette réglementation.
              </p>
            </section>

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
