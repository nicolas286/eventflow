/** Published legal texts. Keep each released version immutable in the database archive. */
export const EVENTFLOW_PLATFORM_TERMS_VERSION = "2026-10-01";
export const EVENTFLOW_CONNECT_TERMS_VERSION = "2026-10-01";
export const EVENTFLOW_BUYER_TERMS_VERSION = "2026-10-01";
export const EVENTFLOW_PRIVACY_VERSION = "2026-10-01";
export const CONNECT_TERMS_VERSION = EVENTFLOW_CONNECT_TERMS_VERSION;
export const DPA_VERSION = "2026-10-01";

export const EVENTFLOW_TERMS_TEXT = `Conditions générales d’utilisation d’Eventflow
Version du 1er octobre 2026

1. Éditeur et objet
Eventflow est édité par Nicolas Manns, entrepreneur individuel, Rue Féral 43, 5190 Jemeppe-sur-Sambre, Belgique, numéro d’entreprise et TVA BE0840.386.125. Contact : contact@useeventflow.eu — +32 495 78 67 96.
Eventflow fournit un logiciel de création et gestion d’événements, d’inscriptions, de billetterie et de suivi des participants. Les présentes conditions régissent l’accès au logiciel. Les conditions de vente de chaque organisateur régissent séparément les billets et prestations qu’il propose.

2. Compte et représentation
L’utilisateur fournit des informations exactes, maintient ses coordonnées à jour et protège ses identifiants. Il signale sans délai tout accès non autorisé. La personne qui engage une organisation déclare disposer des pouvoirs nécessaires. Les membres n’accèdent qu’aux organisations et fonctionnalités autorisées ; le responsable de l’organisation gère leurs habilitations.
L’acceptation des conditions est recueillie dans l’interface. La publication d’une nouvelle version ne constitue pas, à elle seule, une acceptation rétroactive.

3. Rôle de l’organisateur
L’organisateur est le vendeur des billets et prestations, responsable de leur légalité, des autorisations nécessaires, de l’exécution de l’événement, de sa capacité d’accueil, de sa fiscalité et des informations données aux participants. Il fournit son identité juridique et ses coordonnées, des descriptions et prix exacts, ainsi que ses conditions de vente, de livraison, d’annulation, de report, de remboursement et de rétractation lorsque applicable. Il traite les réclamations et respecte les droits impératifs des consommateurs.
Eventflow n’est pas l’organisateur de l’événement et ne devient pas le vendeur du billet par la fourniture du logiciel. Cette répartition ne supprime aucune obligation propre à Eventflow.

4. Paiements de billetterie et Stripe Connect
Les paiements en ligne initiés via Eventflow sont traités par Stripe sur le compte connecté de l’organisateur. L’organisateur souscrit aux conditions Stripe applicables et fournit à Stripe les informations nécessaires à sa vérification. Stripe décide de l’activation, du maintien et des restrictions de ses services ; Eventflow conserve ses propres obligations légales et contractuelles.
Le parcours de billetterie Eventflow est destiné aux paiements uniques en euros par Bancontact. L’organisateur ne doit pas modifier sa configuration pour contourner les moyens autorisés par Eventflow. Les fonds des billets ne sont pas centralisés puis redistribués par Eventflow. Les frais, délais et éventuelles réserves Stripe relèvent des conditions applicables au compte de l’organisateur.
L’annexe « Conditions de connexion Stripe Connect », accessible à /conditions-connect, décrit les données consultées et opérations autorisées. Elle doit être acceptée par un représentant habilité avant utilisation des fonctionnalités concernées. Les remboursements restent possibles et leurs conditions doivent être indiquées aux acheteurs.

5. Abonnement au logiciel
L’accès au logiciel peut être gratuit ou payant selon l’offre choisie. Les prix, limites, période de facturation et éventuelles conditions particulières sont présentés avant l’engagement. Les abonnements Eventflow sont facturés séparément de la billetterie et réglés par virement bancaire ; ils ne sont pas prélevés sur les ventes de billets via Stripe.
La durée, le renouvellement et les échéances applicables sont ceux de l’offre expressément acceptée. Une reconduction ou un engagement annuel ne peut être déduit du seul usage du service. Toute demande de résiliation peut être adressée à contact@useeventflow.eu ; Eventflow confirme sa date d’effet et les montants restant dus selon l’offre acceptée. Une résiliation ne prive pas l’utilisateur des droits impératifs qui lui sont applicables. Toute modification tarifaire s’applique à une période future après information préalable, dans le respect de l’engagement en cours.

6. Utilisations interdites et contrôle
Il est interdit d’utiliser Eventflow à des fins illégales, frauduleuses ou trompeuses, de porter atteinte aux droits de tiers, de compromettre la sécurité ou de contourner une restriction de compte. Les ventes doivent également respecter les restrictions Stripe : https://stripe.com/en-be/legal/restricted-businesses. Une activité soumise à autorisation préalable ne peut être activée sans celle-ci.
Eventflow peut demander les informations utiles à la vérification de l’activité et suspendre les fonctionnalités concernées en cas de fraude, risque sérieux, violation contractuelle ou exigence légale ou du prestataire de paiement. L’organisateur coopère au traitement des signalements et conserve les justificatifs de ses ventes et remboursements.

7. Disponibilité et services tiers
Eventflow met en œuvre des moyens raisonnables pour assurer le fonctionnement et la sécurité du service. Des interruptions peuvent résulter de maintenance, incidents, réseaux ou fournisseurs tiers, sans garantie de disponibilité continue. Eventflow s’efforce d’en limiter la durée et les conséquences. Les conditions propres des fournisseurs s’appliquent à leurs services.

8. Données et confidentialité
La politique de confidentialité décrit les traitements propres d’Eventflow. Pour les données de participants traitées pour le compte de l’organisateur, l’accord de traitement des données accessible à /accord-traitement-donnees fait partie de la relation contractuelle. L’organisateur détermine les finalités, les données nécessaires et la durée de conservation, informe les personnes et dispose d’une base juridique appropriée. Il évite de collecter des données sensibles inutiles.

9. Propriété intellectuelle
La plateforme, son code, ses interfaces et éléments graphiques sont protégés. Aucun droit de propriété n’est transféré à l’utilisateur. Celui-ci conserve ses droits sur les contenus fournis et autorise leur hébergement, reproduction et affichage dans la seule mesure nécessaire à la fourniture du service. Il garantit disposer des droits nécessaires.

10. Responsabilité
Eventflow répond de ses propres obligations dans les limites prévues par la loi. Il n’est pas garant de l’exécution d’un événement ni de la solvabilité de l’organisateur. Les actes de tiers qui échappent raisonnablement à son contrôle n’engagent pas automatiquement sa responsabilité. Aucune clause n’exclut ou ne limite une responsabilité qui ne peut légalement l’être, ni les droits impératifs des utilisateurs.

11. Suspension, fermeture et données
L’utilisateur peut demander la fermeture de son compte à contact@useeventflow.eu. Une fermeture n’annule pas les commandes, les remboursements dus ni les obligations de conservation légales. Avant fermeture, l’organisateur doit organiser l’export ou la restitution des données nécessaires ; les modalités de suppression sont précisées dans l’accord de traitement.
Toute restriction ou résiliation décidée par Eventflow est motivée et notifiée sur un support durable, avec possibilité de contacter le support pour obtenir des explications ou contester la mesure, sauf interdiction légale. Les préavis et exceptions impératifs sont respectés ; lorsqu’un préavis de trente jours est légalement requis pour une résiliation, il est appliqué. Une mesure immédiate peut être nécessaire en cas d’obligation légale, fraude ou menace sérieuse pour la sécurité.

12. Modification des conditions
Les modifications sont communiquées sur un support durable avant leur entrée en vigueur avec un préavis d’au moins quinze jours, et plus long si une adaptation technique ou commerciale le nécessite, sous réserve des exceptions légales. L’utilisateur peut résilier avant leur entrée en vigueur. Les changements urgents imposés par la loi ou nécessaires contre un danger imprévu et imminent peuvent être appliqués sans ce préavis dans les limites légales. La version acceptée est conservée comme preuve.

13. Contact, droit et litiges
Les demandes et signalements de contenus ou événements illicites peuvent être envoyés à contact@useeventflow.eu, avec l’URL concernée et les éléments permettant de les examiner. Les parties recherchent une solution amiable. Le droit belge s’applique. Pour les utilisateurs professionnels, les tribunaux du ressort du siège de l’éditeur sont compétents, sous réserve des règles impératives. Les droits et compétences juridictionnelles impératifs des consommateurs sont préservés.`;

export const CONNECT_TERMS_TEXT = `Conditions de connexion Stripe Connect
Version du 1er octobre 2026

1. Parties et portée
Cette annexe complète les CGU Eventflow entre Nicolas Manns, exploitant Eventflow, et l’organisateur qui la valide par un représentant habilité. Elle s’applique aux paiements de billets et prestations de l’organisateur via son compte Stripe Connect Standard. Elle ne remplace pas les accords que l’organisateur conclut directement avec Stripe.

2. Vendeur, vérification et configuration
L’organisateur demeure le vendeur, tient à jour son identité, son compte bancaire, ses justificatifs et ses conditions de vente, et répond aux demandes de Stripe. Il respecte les activités interdites ou restreintes de Stripe et les moyens de paiement autorisés par Eventflow. Les paiements initiés via Eventflow sont destinés à être uniques, en EUR et par Bancontact. L’activation technique ne vaut pas validation juridique des événements proposés.
Les paiements sont créés directement sur le compte connecté ; Eventflow ne centralise ni ne redistribue les recettes. Stripe décide des capacités, versements, réserves et restrictions selon ses accords. Eventflow ne garantit ni l’acceptation ni le maintien d’un compte Stripe.

3. Données et opérations expressément autorisées
L’organisateur autorise Eventflow, dans la mesure nécessaire à la billetterie, à initier la connexion et l’onboarding, consulter l’identifiant, le statut, les capacités, les exigences de vérification et de configuration de son compte, et recevoir les notifications Stripe correspondantes.
Il autorise la création de sessions de paiement à partir des commandes, la transmission des montants, devises, références et données de contact nécessaires, la consultation des identifiants et statuts de paiement et de remboursement, et leur rapprochement avec les commandes et billets.
Il autorise l’exécution des remboursements demandés par un membre habilité de son organisation via les fonctionnalités disponibles. Il autorise également le remboursement automatique d’un paiement reçu après expiration ou annulation de la commande lorsqu’elle ne peut plus être honorée par le parcours Eventflow. Ces opérations sont répercutées sur son compte Stripe ; leur disponibilité, leurs délais et frais éventuels restent régis par Stripe. L’organisateur conserve la responsabilité de fournir les fonds nécessaires et de respecter ses obligations envers l’acheteur.
Cette autorisation ne permet pas à Eventflow de créer un prélèvement d’abonnement SaaS ni d’utiliser les données pour des finalités étrangères au service. Les données sont accessibles aux personnes et prestataires habilités selon la politique de confidentialité et l’accord de traitement des données.

4. Coopération et réclamations
L’organisateur assure la livraison des billets, l’exécution des prestations, les informations de remboursement et le support aux acheteurs. Il répond aux demandes de justificatifs utiles au traitement d’un incident et informe Eventflow d’une utilisation non autorisée. Eventflow assure le support technique de son intégration et reste responsable de ses propres obligations.

5. Retrait de l’autorisation et fin de connexion
L’organisateur peut déconnecter Eventflow depuis Stripe ou demander son assistance à contact@useeventflow.eu. La déconnexion empêche de nouveaux paiements et peut empêcher le suivi ou les remboursements via Eventflow. Elle n’efface pas les ventes passées, les droits des acheteurs ou les obligations légales. L’organisateur doit alors gérer les opérations restantes directement dans Stripe. Les données déjà nécessaires à la preuve, à la comptabilité ou aux litiges sont conservées uniquement pendant la durée justifiée.
Les évolutions de cette annexe sont soumises aux règles de notification des CGU. La version et les confirmations du représentant sont enregistrées lors de l’acceptation.`;

export const EVENTFLOW_PRIVACY_TEXT = `Politique de confidentialité
Version du 1er octobre 2026

1. Responsables et contact
Nicolas Manns, entrepreneur individuel exploitant Eventflow, Rue Féral 43, 5190 Jemeppe-sur-Sambre, Belgique, BE0840.386.125, est responsable des traitements liés à la gestion de ses utilisateurs, de sa relation commerciale et à la sécurité de son service. Contact : contact@useeventflow.eu — +32 495 78 67 96.
L’organisateur est responsable des données des acheteurs et participants traitées pour organiser ses événements. Eventflow intervient pour son compte comme sous-traitant pour l’hébergement, les inscriptions, commandes, billets et communications correspondantes. L’organisateur doit fournir sa propre information de confidentialité, notamment pour les champs qu’il ajoute à ses formulaires. Stripe détermine également certains traitements propres à ses services de paiement et à ses obligations légales : https://stripe.com/fr-be/privacy.

2. Données, finalités et bases juridiques
Les données de compte, coordonnées, organisation, habilitations et échanges de support servent à créer et administrer l’accès et à exécuter le contrat. Les données de facturation, paiement de l’abonnement et pièces comptables servent à gérer la relation commerciale et respecter les obligations légales.
Les journaux techniques, adresses IP et informations de navigateur ou d’appareil peuvent être utilisés pour sécuriser les accès, prévenir les abus et diagnostiquer les incidents, sur la base de l’intérêt légitime à protéger le service et ses utilisateurs. Ils ne sont pas présentés comme systématiquement anonymes.
Les confirmations contractuelles et leurs versions sont conservées pour prouver les accords, gérer les réclamations et défendre les droits, au titre de l’exécution du contrat et de l’intérêt légitime à établir cette preuve.
Pour les événements, les données comprennent les coordonnées de l’acheteur et des participants, réponses aux formulaires, commandes, billets et statuts de paiement. Les données obligatoires sont signalées dans les formulaires ; leur absence peut empêcher l’inscription ou l’achat. L’organisateur détermine la base juridique de ses traitements.
Pour un paiement, Eventflow transmet à Stripe les informations nécessaires telles que montant, devise, référence de commande et adresse e-mail, puis reçoit les identifiants et statuts utiles au suivi. Les informations complètes d’authentification bancaire ne sont pas stockées par Eventflow.

3. Destinataires et prestataires
Les données ne sont pas vendues. Elles sont accessibles aux personnes habilitées d’Eventflow, à l’organisateur concerné et à ses membres autorisés, aux prestataires nécessaires et, lorsque la loi l’impose, aux autorités compétentes.
Les services utilisés comprennent Supabase (base de données, authentification et stockage), Netlify (hébergement et diffusion du site et de l’application), Resend (e-mails transactionnels), Cloudflare Turnstile (protection contre les abus), Stripe (paiements et connexion des organisateurs) et Billit (facturation Eventflow). Les données transmises dépendent du service réellement utilisé ; Billit n’est pas destinataire de toutes les données de participants.

4. Transferts internationaux
Certains prestataires peuvent traiter des données en dehors de l’Espace économique européen. Eventflow doit encadrer ces transferts par un mécanisme applicable, tel qu’une décision d’adéquation ou les clauses contractuelles types et, si nécessaire, des mesures complémentaires. Les informations sur les prestataires, destinations et garanties applicables au traitement concerné peuvent être demandées à contact@useeventflow.eu. Le recours à un fournisseur étranger ne signifie pas que toutes les données sont transférées dans chaque pays où il opère.

5. Conservation
Les données de compte sont conservées pendant la relation de service puis supprimées ou anonymisées lorsqu’elles ne sont plus nécessaires. Les éléments nécessaires aux obligations comptables et fiscales, à la preuve des contrats, au traitement des litiges et à la défense des droits peuvent être conservés séparément pendant les délais légaux ou de prescription applicables.
Les données des événements sont conservées selon les instructions documentées de l’organisateur et les nécessités de la prestation. Celui-ci peut demander une restitution ou suppression à Eventflow ; aucune fonction automatique de paramétrage de durée n’est présumée. Les journaux et sauvegardes sont soumis à des durées proportionnées à leur finalité de sécurité et de reprise ; leur effacement suit leur cycle de rotation. Pour connaître la durée applicable à une catégorie précise ou demander une suppression, contactez Eventflow.

6. Sécurité et stockage navigateur
Eventflow met en œuvre des mesures techniques et organisationnelles adaptées au risque, notamment la gestion des accès et la séparation des organisations. Aucun système ne peut garantir une sécurité absolue.
Les éléments de stockage nécessaires à l’authentification, au fonctionnement et à la sécurité peuvent être utilisés. Les traceurs non nécessaires, lorsqu’ils sont proposés, ne doivent être activés qu’après le consentement requis et doivent pouvoir être refusés ou désactivés. La prise de connaissance de cette politique n’est pas un consentement global à tous les traitements.

7. Droits et réclamations
Selon les conditions légales, vous pouvez demander l’accès, la rectification, l’effacement, la limitation et la portabilité de vos données, et vous opposer aux traitements fondés sur l’intérêt légitime. Lorsqu’un traitement repose sur le consentement, vous pouvez le retirer à tout moment sans affecter la licéité du traitement antérieur.
Adressez vos demandes concernant Eventflow à contact@useeventflow.eu. Pour les données d’un événement, contactez en priorité l’organisateur indiqué lors de l’inscription ; Eventflow peut l’assister et lui transmettre votre demande. Une vérification proportionnée de l’identité peut être nécessaire. Les demandes sont traitées dans les délais du RGPD.
Vous pouvez introduire une réclamation auprès de l’Autorité de protection des données belge : https://www.autoriteprotectiondonnees.be — Rue de la Presse 35, 1000 Bruxelles.

8. Évolution
Cette politique peut être mise à jour pour refléter les traitements. Les changements significatifs sont portés à la connaissance des utilisateurs. La version présentée lors d’une confirmation est conservée comme preuve de l’information fournie.`;

export const DPA_TEXT = `Accord de traitement des données
Version du 1er octobre 2026

1. Parties, objet et durée
Cet accord complète les CGU entre l’organisateur, responsable du traitement, et Nicolas Manns exploitant Eventflow, sous-traitant. Il s’applique pendant la fourniture du service et jusqu’à restitution ou suppression des données traitées pour le compte de l’organisateur. Il ne couvre pas les traitements dont Eventflow ou Stripe déterminent eux-mêmes les finalités pour leurs obligations propres, décrits dans leurs politiques de confidentialité.

2. Traitements confiés
Le service comprend la collecte, l’enregistrement, l’hébergement, la consultation, la mise à jour, l’export, la transmission et la suppression nécessaires aux événements, inscriptions, commandes, billets, contrôles d’accès, notifications et suivi des paiements. Les personnes concernées sont les acheteurs, participants, contacts et membres habilités de l’organisation.
Les données concernées sont les identités et coordonnées, réponses aux formulaires configurés par l’organisateur, références de commande, billets, statuts de paiement et informations techniques nécessaires. L’organisateur limite la collecte aux données utiles ; il ne doit pas demander de données sensibles sans nécessité, base juridique et mesures appropriées préalablement convenues.

3. Instructions et confidentialité
Eventflow traite les données uniquement sur les instructions documentées de l’organisateur, constituées par cet accord, ses réglages et demandes écrites, y compris en matière de transferts internationaux. Si une obligation légale impose un autre traitement, Eventflow en informe préalablement l’organisateur, sauf interdiction légale. Eventflow l’informe immédiatement s’il estime qu’une instruction enfreint le droit de la protection des données.
Les personnes autorisées à traiter les données sont soumises à une obligation de confidentialité et n’y accèdent que dans la mesure nécessaire à leurs fonctions.

4. Sécurité
Eventflow met en œuvre les mesures techniques et organisationnelles appropriées au risque conformément à l’article 32 du RGPD : contrôle des accès et habilitations, séparation des organisations, protection des échanges, gestion des secrets, journalisation utile à la sécurité et procédures de traitement des incidents. Il évalue et adapte ces mesures selon la nature des données et du service. Les informations nécessaires à leur évaluation sont disponibles sur demande, sans divulgation de secrets compromettant la sécurité.

5. Sous-traitants ultérieurs et transferts
L’organisateur autorise généralement le recours aux sous-traitants techniques nécessaires, notamment Supabase (authentification, base et stockage), Netlify (hébergement), Resend (e-mails transactionnels) et Cloudflare (protection contre les abus), dans la mesure où ils traitent ses données. Stripe intervient selon les rôles définis par ses accords de paiement ; Billit sert à la facturation propre d’Eventflow.
Eventflow impose aux sous-traitants ultérieurs des obligations de protection équivalentes à celles du présent accord et demeure responsable de leur exécution envers l’organisateur. Il informe préalablement l’organisateur de tout ajout ou remplacement, lui permettant de présenter une objection motivée relative à la protection des données. Les parties recherchent une solution ; si aucune solution appropriée n’est possible avant le changement, l’organisateur peut mettre fin à la fonctionnalité ou au service concerné et demander la restitution de ses données.
Les transferts hors EEE doivent être encadrés par les garanties requises au chapitre V du RGPD. Eventflow fournit sur demande les informations relatives aux prestataires, localisations et mécanismes applicables.

6. Assistance et violations
Compte tenu de la nature du traitement et des informations dont il dispose, Eventflow aide l’organisateur à répondre aux demandes d’exercice des droits, à assurer la sécurité et à remplir ses obligations concernant les violations, analyses d’impact et consultations préalables. Il lui transmet les demandes reçues concernant ses participants et ne décide pas seul d’y donner suite hors instruction ou obligation légale.
Eventflow notifie à l’organisateur toute violation de données personnelles sans délai indu après en avoir pris connaissance. Il communique les informations disponibles sur la nature, les personnes et données concernées, les conséquences probables et les mesures prises ou proposées, et les complète au fur et à mesure. L’organisateur reste responsable des notifications à l’autorité et aux personnes lorsque requises.

7. Restitution et suppression
À la fin de la prestation, Eventflow restitue ou supprime les données et copies selon le choix documenté de l’organisateur, sauf obligation légale de conservation. L’organisateur formule son choix et organise ses exports avant fermeture ; une demande peut être adressée à contact@useeventflow.eu. Les copies de sauvegarde qui ne peuvent être effacées individuellement restent protégées, sans utilisation active, jusqu’à leur effacement par rotation. En cas de restauration, les instructions de suppression sont réappliquées. Aucune durée de sauvegarde particulière n’est garantie par le présent accord.

8. Documentation et contrôle
Eventflow met à disposition les informations nécessaires pour démontrer le respect de cet accord et permet les audits, y compris inspections, par l’organisateur ou un auditeur indépendant mandaté, et y contribue. Les modalités sont organisées avec un préavis raisonnable, sous confidentialité et sans compromettre les données d’autres clients ; ces modalités ne peuvent faire obstacle aux contrôles nécessaires ni aux pouvoirs des autorités. Les parties coopèrent à la correction des écarts constatés.
L’organisateur reste responsable de la licéité de ses instructions, de l’information des personnes et de ses obligations de responsable du traitement. Les droits impératifs des personnes et les responsabilités fixées par le RGPD restent intégralement préservés.`;

export const EVENTFLOW_BUYER_TERMS_TEXT = `Conditions d’utilisation de la billetterie Eventflow
Version du 1er octobre 2026

Eventflow, service de Nicolas Manns, entrepreneur individuel, Rue Féral 43, 5190 Jemeppe-sur-Sambre, Belgique, BE0840.386.125, fournit l’interface technique de réservation et de billetterie. Contact technique : contact@useeventflow.eu — +32 495 78 67 96.
Le vendeur est l’organisateur identifié avant la commande. Son identité, ses coordonnées et ses conditions de vente sont présentées séparément. Il est responsable de l’événement, des billets, des prix, de la livraison, des annulations, reports, remboursements et réclamations commerciales. Les présentes conditions ne remplacent pas ses conditions de vente ni vos droits légaux.
Vérifiez les dates, quantités, coordonnées et conditions présentées avant de confirmer. Le bouton de paiement indique le montant à payer. Les paiements en ligne sont traités par Stripe sur le compte de l’organisateur. Le parcours Eventflow est destiné aux paiements Bancontact en euros. Une confirmation de commande et les modalités d’accès aux billets sont envoyées aux coordonnées indiquées ; en cas de non-réception, vérifiez les courriers indésirables et contactez l’organisateur.
Un retour à l’interface après paiement ne constitue pas à lui seul une confirmation bancaire. Si un paiement est reçu après expiration ou annulation d’une commande qui ne peut plus être honorée, un remboursement peut être initié automatiquement. Les délais de remboursement dépendent du prestataire et de la banque.
Les règles d’annulation et de rétractation applicables sont celles indiquées par le vendeur avant l’achat, sous réserve de vos droits impératifs. Pour les services de loisirs à une date ou période déterminée relevant de l’exception légale, le droit de rétractation ne s’applique pas ; cette exception ne supprime pas les recours liés à une annulation ou à un manquement du vendeur.
Eventflow traite les informations nécessaires à la réservation pour le compte de l’organisateur. La politique de confidentialité précise les rôles, destinataires et droits. Ne transmettez que les informations nécessaires et n’utilisez pas les billets ou données d’autrui sans autorisation.
Eventflow répond de ses propres obligations ; aucune disposition n’exclut une responsabilité ni un droit qui ne peut légalement l’être. En cas de difficulté commerciale, contactez d’abord le vendeur ; le support Eventflow peut assister sur les incidents techniques. Le droit belge s’applique sous réserve des dispositions impératives et protections du consommateur applicables.`;

export const EVENTFLOW_LEGAL_NOTICE_TEXT = `Mentions légales
Version du 1er octobre 2026

Éditeur du site
Nom commercial : Eventflow
Responsable : Nicolas Manns
Statut : entrepreneur individuel
Siège : Rue Féral 43, 5190 Jemeppe-sur-Sambre, Belgique
E-mail : contact@useeventflow.eu
Téléphone : +32 495 78 67 96
Numéro d’entreprise et TVA : BE0840.386.125

Hébergement du site
Netlify, Inc. — 101 2nd Street, San Francisco, CA 94105, États-Unis.
Site : https://www.netlify.com

Responsabilité
Les informations du site sont fournies avec soin. La responsabilité de l’éditeur en cas d’erreur, omission ou indisponibilité s’apprécie dans les limites prévues par la loi. Les modifications du site ne portent pas atteinte aux engagements contractuels déjà conclus ni aux droits impératifs des utilisateurs.

Propriété intellectuelle
Les textes, images, graphismes, logos, icônes, structure et éléments techniques et visuels sont protégés par les droits de propriété intellectuelle applicables. Toute utilisation sans autorisation est interdite, sauf dans les cas autorisés par la loi et sous réserve des droits des titulaires respectifs.`;
