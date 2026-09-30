# Back-office interne Eventflow

**Statut : implémenté sur `dev` ; déploiement et recette limités au staging par le workflow de la branche. Aucune promotion production n’est incluse.**

Implémentation préparée le 30 septembre 2026 :

- registre privé `private.platform_admins`, sans administrateur initial créé automatiquement ;
- MFA TOTP obligatoire (`aal2`) et step-up TOTP de moins de 120 secondes ;
- preuves de step-up valables cinq minutes, à usage unique et liées à la session, l’action et la cible ;
- frontière navigateur → Edge Functions uniquement pour toutes les données plateforme ;
- fermeture des privilèges navigateur sur les RPC internes historiques, dont `admin_grant_subscription`, qui permettraient sinon de contourner le step-up du back-office ;
- inscriptions initialisées fermées et contrôlées à nouveau dans les créations de commandes ;
- message global, KPI, organisations, onboarding idempotent, finance, exploitation, audit et gestion des accès internes ;
- actions de paiement live, impersonation et relances techniques non définies laissées hors périmètre pour éviter une mutation dangereuse sans contrat métier.

Ce chantier crée un espace réservé à l’équipe Eventflow pour piloter la plateforme et onboarder des organisations. Il est distinct de l’administration organisateur et de sa refonte visuelle décrite dans [admin-ui-redesign.md](admin-ui-redesign.md).

## Objectif

Créer un back-office interne permettant de :

- suivre les KPI produit, commerciaux, financiers et opérationnels ;
- rechercher et consulter les organisations ;
- onboarder une agence ou un organisateur avec son propriétaire ;
- suivre l’état de configuration, d’abonnement et de paiement ;
- détecter les situations nécessitant une intervention ;
- publier un message d’accueil ou d’information global sur la plateforme ;
- ouvrir ou couper globalement les nouvelles inscriptions ;
- effectuer quelques actions contrôlées, tracées et réversibles lorsque possible.

Ce back-office ne doit pas devenir un accès direct et illimité aux tables. Toutes ses lectures et mutations métier passent par des Edge Functions dédiées, avec un contrat, une autorisation serveur et une trace adaptée. Le navigateur n’accède directement ni aux tables, ni aux vues, ni aux RPC métier du back-office plateforme.

## État observé

- `public.user_profile` ne contient actuellement aucun champ `is_admin` ou équivalent.
- `organization_members.role` accepte `owner` et `admin`, mais ces rôles sont limités à une organisation. Ils ne représentent pas un administrateur Eventflow.
- `organizations` contient déjà `status`, `plan`, les dates du plan et plusieurs états de configuration de paiement.
- L’onboarding actuel appelle `create_organization(jsonb)`. Cette RPC crée une organisation pour l’utilisateur connecté et le rend `owner`.
- Le bootstrap organisateur sélectionne la première organisation de l’utilisateur. Il n’est pas conçu pour naviguer dans l’ensemble des organisations de la plateforme.
- La table `user_profile` autorise actuellement un utilisateur authentifié à mettre à jour sa propre ligne. Ajouter simplement un booléen administrateur à cette table sans protection permettrait une élévation de privilèges.
- Les nouvelles inscriptions sont actuellement désactivées volontairement pendant la refonte. La future configuration plateforme doit reprendre cet état sans réactivation automatique lors de sa migration ou de son déploiement.

## Décision d’autorisation recommandée

### Option privilégiée : registre privé d’administrateurs plateforme

Créer une table non exposée au navigateur, par exemple :

```text
private.platform_admins
  user_id uuid primary key
  granted_at timestamptz
  granted_by uuid nullable
  revoked_at timestamptz nullable
  note text nullable
```

Avantages :

- séparation nette avec les profils et rôles d’organisation ;
- aucun risque qu’un formulaire de profil modifie le privilège ;
- révocation et historique plus faciles à tracer ;
- possibilité d’étendre plus tard vers plusieurs rôles internes sans modifier les profils publics.

Ajouter un helper serveur `private.is_platform_admin(user_id)` ou équivalent, avec `search_path` maîtrisé et sans droit d’exécution direct inutile.

### Option minimale : champ sur `user_profile`

Si un champ est préféré, utiliser le nom explicite `is_platform_admin` plutôt que `is_admin`, déjà ambigu avec `organization_members.role = 'admin'`.

Cette option impose au minimum :

- `boolean not null default false` dans une nouvelle migration ;
- interdiction effective de modifier cette colonne avec le client authentifié ;
- remplacement de la mise à jour libre du profil par une RPC à champs autorisés, ou trigger de protection équivalent ;
- absence du champ dans les payloads de mise à jour de profil ;
- tests prouvant qu’un utilisateur ne peut pas s’auto-promouvoir ;
- attribution initiale uniquement par migration contrôlée ou opération serveur privilégiée.

Copier directement le booléen utilisé dans Nexora ou Immochat ne serait pas sûr dans Eventflow tant que ses grants et policies actuels restent différents.

## Authentification renforcée

L’accès à `/platform` impose une authentification multifacteur pour tous les administrateurs plateforme :

- un administrateur sans facteur vérifié est dirigé vers l’enrôlement MFA et ne peut consulter aucune donnée plateforme ;
- chaque session autorisée doit présenter un niveau d’assurance `aal2`, vérifié par les Edge Functions et pas seulement par la garde frontend ;
- le premier facteur et le second facteur restent distincts ; le TOTP via une application d’authentification est le facteur privilégié pour le premier lot ;
- la perte ou le remplacement d’un facteur suit une procédure de récupération contrôlée, auditée et sans contournement manuel informel ;
- la révocation d’un accès administrateur doit invalider ou refuser les sessions encore actives, y compris si leur JWT n’a pas encore expiré.

Une réauthentification récente est en plus obligatoire avant toute action critique. La présence de `aal2` dans une session ancienne ne suffit pas. Le parcours de step-up doit :

1. demander une nouvelle validation du second facteur immédiatement avant l’action ;
2. produire une preuve courte, à usage unique, liée à l’administrateur, à la session, au type d’action et si possible à la cible ;
3. faire consommer cette preuve par l’Edge Function qui exécute l’action, dans une fenêtre temporelle courte à définir ;
4. invalider la preuve après succès ou expiration et journaliser le résultat sans conserver le code MFA.

Sont notamment critiques : ajouter ou retirer un administrateur plateforme, changer un propriétaire, suspendre ou réactiver une organisation, changer un plan, ouvrir ou couper les inscriptions, publier ou retirer un message global, déclencher une reprise technique avec effet externe et toute future action financière. La liste exacte, la durée de validité et la stratégie de récupération doivent être arrêtées dans le lot 0. Une simple modale de confirmation, un timestamp conservé dans le navigateur ou le seul `iat` du JWT ne constituent pas une réauthentification suffisante.

## Principe d’architecture

### Frontend

- Espace dédié sous `/platform`, et non sous les routes organisateur `/admin`.
- Shell et navigation propres, avec identité Eventflow plutôt que couleurs d’une organisation.
- Garde de route pour l’expérience utilisateur, mais jamais considérée comme une autorisation suffisante.
- Contrats Zod dédiés dans `shared/schemas` pour les réponses et mutations de la plateforme.
- Flux unique `page → hook → repository → Edge Function` pour toutes les fonctionnalités plateforme.
- Aucun appel navigateur direct à `supabase.from(...)`, `supabase.rpc(...)` ou au Storage pour lire ou modifier des données plateforme. Les appels à Supabase Auth restent limités à la session, à l’enrôlement MFA et aux challenges d’authentification.
- Écrans explicites pour l’enrôlement MFA, le challenge à la connexion, le step-up avant action critique et la récupération contrôlée.

### Backend

- Toute Edge Function vérifie la session active, le niveau `aal2` puis le statut d’administrateur plateforme côté serveur.
- Toutes les lectures et mutations plateforme sont exposées uniquement par des Edge Functions dédiées, paginées et limitées au strict nécessaire. Les éventuelles RPC ou vues privées sont des détails internes appelés par ces fonctions et ne reçoivent aucun droit d’exécution ou de lecture depuis le navigateur.
- Les tables, vues et helpers plateforme restent dans des schémas non exposés lorsque possible. Les droits `anon` et `authenticated` sont révoqués sur ces objets ; la RLS reste une défense en profondeur et non l’API publique du back-office.
- Les opérations nécessitant une clé secrète ou `service_role`, notamment Auth Admin, restent dans une Edge Function. Le contournement de la RLS impose des contrôles explicites d’identité, de privilège, de MFA, de périmètre et de payload avant toute requête privilégiée.
- Les actions critiques vérifient et consomment côté serveur une preuve de réauthentification récente, à usage unique et liée à l’action.
- Les réponses masquent secrets, tokens, identifiants prestataire inutiles, coordonnées bancaires complètes et données personnelles non nécessaires.
- Les mutations sensibles sont journalisées avec acteur, cible, action, horodatage, résultat et métadonnées non sensibles.
- Les accès inter-organisations sont explicitement testés ; ils ne doivent jamais dépendre d’une simple route masquée.

## Navigation proposée

| Section         | Contenu principal                                                  |
| --------------- | ------------------------------------------------------------------ |
| Vue d’ensemble  | KPI, tendances, alertes et activité récente                        |
| Organisations   | Recherche, filtres, statut, plan, configuration et fiche détaillée |
| Onboarding      | Création/invitation contrôlée d’une nouvelle organisation          |
| Abonnements     | Plans, états, échéances, factures et anomalies de renouvellement   |
| Paiements       | État Mollie/Stripe/virement, conformité et incidents agrégés       |
| Configuration   | Message global et disponibilité des nouvelles inscriptions         |
| Exploitation    | Échecs de livraison, traitements en attente et santé des parcours  |
| Journal         | Historique des actions internes sensibles                          |
| Administrateurs | Gestion restreinte des accès internes avec step-up et audit         |

Le MVP peut commencer avec Vue d’ensemble, Organisations et Onboarding. Les autres sections ne doivent être ajoutées que lorsqu’une action opérationnelle concrète les justifie.

## Vue d’ensemble et KPI

### Organisations

- nombre total d’organisations ;
- nouvelles organisations sur 7, 30 et 90 jours ;
- répartition `trial`, `active`, `suspended` ;
- répartition par plan `free`, `starter`, `pro` ;
- onboarding incomplet : profil public, abonnement ou paiement non configuré.

### Activité produit

- événements créés, publiés et à venir ;
- organisations actives sur une période définie ;
- commandes et participants sur la période ;
- taux d’organisations ayant publié au moins un événement ;
- utilisation des capacités importantes : widget, codes promo, exports, scanner, lorsque des événements de mesure fiables existent.

### Revenus

Séparer explicitement :

- **revenu Eventflow** : abonnements et éventuels frais réellement acquis ;
- **GMV organisateurs** : volume de billets vendu pour le compte des organisations ;
- montants payés, remboursés, échoués ou en attente ;
- MRR/ARR uniquement après définition des statuts inclus, périodes, annulations, essais et changements de plan.

Les centimes restent l’unité de stockage. Les agrégations doivent éviter les doubles comptes liés aux retries, webhooks et remboursements.

### Santé opérationnelle

- comptes de paiement non connectés, incomplets ou révoqués ;
- commandes payantes en attente anormalement longue ;
- paiements échoués et remboursements tardifs ;
- e-mails, billets, factures ou transmissions Billit en échec ou à retenter ;
- webhooks ou renouvellements OAuth nécessitant une intervention ;
- alertes avec lien vers la ressource concernée et procédure attendue.

Chaque carte de KPI doit préciser sa période, sa définition et sa date de mise à jour. Les graphiques doivent servir une comparaison temporelle, pas uniquement décorer la page.

## Configuration globale de la plateforme

### Message d’accueil ou d’information

Le back-office permet de préparer, prévisualiser, publier, planifier et retirer un message global :

- titre court, contenu en texte enrichi limité et assaini, niveau visuel `information`, `warning` ou `maintenance` ;
- statut brouillon/publié et dates facultatives de début et de fin ;
- audience explicite : espace organisateur, parcours public ou les deux ;
- aperçu desktop/mobile avant publication ;
- historique des versions, auteur, dates de publication et retrait ;
- rendu accessible, sans HTML arbitraire, script, iframe ni lien dangereux.

L’édition d’un brouillon n’a aucun effet externe. La publication, le remplacement ou le retrait d’un message global exige une confirmation, un step-up récent et une entrée d’audit. Le frontend récupère le message actif via une Edge Function avec un contrat public minimal ; les brouillons et métadonnées internes ne sont jamais exposés.

### Campagnes e-mail aux organisations

Le même espace de communication permet d’envoyer un message à une organisation précise ou à toutes les organisations. Les destinataires sont reconstruits côté serveur à partir des propriétaires confirmés, dédupliqués et limités à 100 par campagne. Le navigateur ne fournit jamais une liste libre d’adresses.

Chaque campagne exige un objet, un message en texte, un motif interne et une clé d’idempotence. L’envoi est une action critique liée à sa cible, avec step-up TOTP à usage unique. La campagne et chaque livraison sont conservées dans des tables privées avec auteur, cible, compteurs et statut, sans exposer les adresses dans les réponses d’historique. Sur staging, les e-mails restent obligatoirement capturés dans `mail-previews` et aucun prestataire live n’est appelé.

### Ouverture et coupure des inscriptions

Un contrôle global permet d’autoriser ou de refuser la création de nouvelles inscriptions et commandes sur l’ensemble de la plateforme :

- état explicite `open` ou `closed`, accompagné d’un motif interne obligatoire et d’un message public configurable ;
- affichage permanent de l’état courant, de l’auteur et de la date du dernier changement dans le back-office ;
- possibilité de consulter les organisations, événements, commandes et participants existants lorsque les inscriptions sont coupées ;
- refus serveur de toute nouvelle inscription ou commande, y compris en appelant directement son endpoint ou avec une page publique déjà ouverte ;
- conservation des brouillons déjà présents selon une règle métier à définir, sans validation possible tant que l’état reste `closed` ;
- réouverture uniquement par une action explicite, jamais automatiquement après un déploiement, une migration ou une date implicite.

L’ouverture comme la coupure sont des actions critiques : confirmation claire de l’impact global, réauthentification récente, mise à jour atomique et audit obligatoire. L’état initial lors de l’introduction de cette fonctionnalité reste `closed` afin de préserver la désactivation voulue pendant la refonte.

## Liste et fiche organisation

### Liste

- recherche par nom, slug ou e-mail du propriétaire ;
- filtres par statut, plan, prestataire et état de paiement ;
- tri par création, activité récente ou prochaine échéance ;
- pagination serveur ;
- colonnes compactes : organisation, propriétaire, plan, statut, événements, paiements, création ;
- badges de statut cohérents et actions de ligne limitées.

### Fiche

- identité et profil public ;
- propriétaire et membres, avec données personnelles minimales ;
- plan, abonnement, factures et échéances ;
- état du prestataire de paiement sans exposer de secret ;
- événements récents et agrégats de commandes ;
- alertes et historique des actions internes ;
- raccourcis vers les outils de diagnostic autorisés.

Éviter au départ un mode « impersonation ». S’il devient nécessaire, il devra avoir une durée courte, une indication visuelle permanente, une MFA, un audit complet et aucune possibilité d’effectuer silencieusement des actions financières.

## Onboarding d’une agence

### Données minimales

- nom de l’organisation ;
- type compatible avec le modèle actuel (`association` ou `person`) ou décision métier d’ajouter un type `company`/`agency` ;
- prénom, nom et e-mail du propriétaire ;
- plan initial et durée d’essai éventuelle ;
- statut initial ;
- langue de l’invitation si cette notion est ajoutée ;
- note interne facultative, non exposée au client.

Le terme « agence » n’existe pas encore dans l’enum actuel. Il faut décider s’il s’agit seulement d’un libellé métier ou d’un nouveau type avant de modifier le schéma.

### Flux recommandé

1. L’administrateur saisit et confirme les informations.
2. Une Edge Function vérifie la session, l’accès plateforme, le payload et une clé d’idempotence.
3. Le serveur détecte si l’e-mail correspond déjà à un utilisateur.
4. Pour un utilisateur existant, il crée l’organisation, son profil et le membership `owner` via une opération SQL dédiée.
5. Pour un nouvel utilisateur, il crée ou invite le compte via l’API Auth Admin, puis rattache l’organisation de façon idempotente.
6. Le résultat distingue clairement compte existant, invitation envoyée, invitation en attente et échec partiel.
7. Une entrée d’audit est enregistrée.

La RPC publique `create_organization` ne doit pas être réutilisée telle quelle : elle ferait de l’administrateur Eventflow connecté le propriétaire de l’organisation.

La création Auth et la transaction SQL ne sont pas atomiques. Il faut donc prévoir un identifiant d’opération, des contraintes uniques et une reprise sûre pour éviter comptes ou organisations orphelins après un échec intermédiaire.

### Actions complémentaires, par lots ultérieurs

- renvoyer une invitation ;
- changer le propriétaire avec confirmation forte ;
- suspendre/réactiver une organisation ;
- changer un plan avec règles de facturation explicites ;
- déclencher une reprise technique ciblée ;
- ajouter ou retirer un administrateur plateforme.

Chaque mutation doit avoir une confirmation adaptée, un motif lorsque pertinent et un audit. Les actions financières ou irréversibles ne doivent pas être livrées dans le premier lot.

## Modifications techniques envisagées

### Base de données

- nouvelle migration pour le registre `private.platform_admins` ou le champ protégé `is_platform_admin` ;
- helper d’autorisation serveur ;
- stockage privé des preuves de step-up à durée courte, à usage unique et liées à une session/action, si le mécanisme retenu en a besoin ;
- configuration globale versionnée pour le message publié et l’état d’ouverture des inscriptions, initialisé à `closed` ;
- table d’audit interne ;
- RPC de lecture paginée/agrégée ou vues privées dédiées ;
- fonction transactionnelle d’onboarding d’une organisation pour un propriétaire donné ;
- index sur les filtres réellement utilisés ;
- révocation des droits `anon` et `authenticated` sur tous les objets internes du back-office plateforme ;
- aucune modification rétroactive d’une migration appliquée.

### Edge Functions

- domaine `/platform-admin` ou routes équivalentes ;
- middleware commun d’authentification, de contrôle de session active, de `aal2` et d’autorisation plateforme, sans masquer les permissions métier ;
- middleware de step-up pour les actions critiques, avec preuve récente liée à l’action et consommation atomique ;
- endpoint d’onboarding utilisant Auth Admin ;
- endpoints read-only pour overview et organisations ;
- endpoints de lecture et de mutation de la configuration globale ;
- contrôle autoritatif de l’état `open` dans l’Edge Function qui crée une inscription ou une commande, dans la même frontière transactionnelle que la création métier ;
- limites de débit, validation Zod et réponses d’erreur stables ;
- logs sans secrets ni payloads personnels complets.

### Frontend

- `PlatformAdminRoute` et shell dédié ;
- modules `overview`, `organizations`, `onboarding` et `audit` ;
- repository et hooks distincts du bootstrap organisateur ;
- tableaux paginés, filtres dans l’URL et états 401/403/429 explicites ;
- métadonnées `noindex, nofollow` ;
- aucun accès direct aux tables, vues, RPC ou fichiers plateforme depuis le navigateur ; seuls Supabase Auth et les Edge Functions dédiées sont appelés.

## Déroulement proposé

### Lot 0 — Définitions et modèle d’accès

- Valider le terme agence/organisation et les KPI exacts.
- Choisir registre privé ou champ protégé.
- Définir les rôles internes et la procédure d’attribution initiale.
- Rendre la MFA obligatoire, définir l’enrôlement et la récupération, puis fixer la liste des actions critiques, le mécanisme de step-up et sa durée de validité.
- Définir et tester la frontière d’API Edge Functions-only ainsi que les révocations de droits sur les objets privés.
- Inventorier les données nécessaires et celles qui doivent rester masquées.

### Lot 1 — Socle sécurisé et lecture seule

- Ajouter l’autorisation plateforme et ses tests négatifs.
- Ajouter l’enrôlement MFA, le challenge de connexion et l’exigence serveur `aal2`.
- Créer le shell `/platform`.
- Livrer une liste paginée des organisations et une fiche read-only.
- Ajouter le journal d’audit avant les premières mutations.

### Lot 2 — Onboarding

- Créer le contrat d’onboarding et l’Edge Function.
- Gérer utilisateur existant, nouvel utilisateur, retry et échec partiel.
- Tester l’e-mail uniquement sur staging/capture prévue, jamais vers un client réel.
- Ajouter une page de résultat et les actions de reprise sûres.

### Lot 2 bis — Communication et contrôle des inscriptions

- Exposer l’état courant et le message actif via des Edge Functions à contrats minimaux.
- Ajouter l’éditeur, l’aperçu et la publication du message global.
- Ajouter les campagnes e-mail ciblées ou globales avec destinataires serveur, idempotence, capture staging et historique privé.
- Ajouter le contrôle global des inscriptions en conservant `closed` comme état initial.
- Faire appliquer la fermeture par le serveur au point de création des inscriptions et commandes, sans dépendre de l’interface.
- Protéger publication, retrait, ouverture et coupure par confirmation, step-up et audit.

### Lot 3 — KPI et exploitation

- Ajouter les agrégations définies et testées.
- Mettre en place périodes, comparaison et rafraîchissement.
- Ajouter les alertes opérationnelles avec critères documentés.
- Vérifier les performances sur volumes représentatifs.

### Lot 4 — Mutations avancées

- Suspendre/réactiver, gérer les plans ou relancer certains traitements seulement après définition métier.
- Ajouter confirmation forte, step-up récent, audit et tests d’autorisation pour chaque action.
- Conserver hors périmètre les opérations de paiement live non testables sans risque.

## Tests indispensables

- utilisateur non connecté : refus ;
- administrateur plateforme authentifié sans facteur MFA vérifié ou avec une session `aal1` : refus de toute Edge Function plateforme ;
- utilisateur organisateur `owner` ou `admin` : refus de l’espace plateforme ;
- utilisateur standard modifiant son profil : impossible de s’attribuer le rôle plateforme ;
- administrateur plateforme : accès aux seules routes prévues ;
- appel direct Data API, RPC ou Storage avec un JWT administrateur : aucune donnée ni mutation plateforme accessible ;
- action critique sans step-up, avec preuve expirée, rejouée, liée à une autre action, session ou cible : refus ;
- révocation d’un administrateur avec session encore valide : accès refusé dès la vérification serveur suivante ;
- inscriptions fermées : toute création est refusée côté serveur, y compris par appel direct, tandis que les données existantes restent consultables ;
- déploiement ou migration de la configuration : les inscriptions restent fermées jusqu’à une réouverture explicite ;
- message global : brouillon invisible publiquement, contenu assaini, dates et audiences respectées, publication/retrait audités ;
- campagne e-mail : destinataires imposés par le serveur, limite respectée, preuve de step-up obligatoire, contenu HTML échappé, reprise idempotente et capture staging sans envoi live ;
- deux organisations synthétiques : aucune fuite via les routes organisateur ;
- pagination, filtres, limites et payloads invalides ;
- onboarding répété avec la même clé : pas de doublon ;
- e-mail déjà connu, e-mail nouveau et échec Auth intermédiaire ;
- audit créé pour chaque mutation, sans secret ;
- reconstruction SQL jetable, tests Edge simulés, build frontend et recette staging.

## Critères d’acceptation du MVP

- Le privilège plateforme est distinct des rôles d’organisation et impossible à s’auto-attribuer.
- Tout administrateur plateforme doit avoir un facteur MFA vérifié et chaque Edge Function exige une session `aal2`.
- Un non-administrateur reçoit un refus serveur, même en appelant directement l’API.
- Le navigateur ne peut obtenir aucune donnée plateforme par accès direct aux tables, vues, RPC ou fichiers ; toutes les fonctionnalités passent par les Edge Functions prévues.
- Toute action critique exige une réauthentification récente vérifiée côté serveur et sa preuve ne peut être ni rejouée ni utilisée pour une autre action.
- Un administrateur peut publier ou retirer un message global, avec aperçu, audience, planification et historique audité.
- Un administrateur peut envoyer un e-mail à une organisation ou à toutes les organisations, avec ciblage serveur, step-up, idempotence et historique de livraison.
- Un administrateur peut ouvrir ou couper les inscriptions globalement ; la fermeture est appliquée côté serveur et l’état initial reste fermé pendant la refonte.
- La liste des organisations est paginée, filtrable et ne révèle pas de données inutiles.
- L’onboarding crée ou invite le propriétaire attendu et ne rattache jamais l’administrateur Eventflow comme owner.
- Une répétition de la requête d’onboarding ne crée pas de doublon.
- Les actions internes sont auditées.
- Les KPI affichés ont une définition, une période et une source vérifiables.
- Les tests utilisent des fixtures locales/staging et aucun e-mail, paiement ou compte client réel.

## Questions à trancher avant implémentation

- Une « agence » est-elle un nouveau type d’organisation ou seulement un vocabulaire d’interface ?
- Le propriétaire doit-il toujours être invité immédiatement ?
- Quel plan et quelle durée d’essai appliquer par défaut ?
- Quelles actions sont classées critiques et quelle durée maximale accorder à leur preuve de step-up ?
- Quelle procédure de récupération MFA permet de traiter la perte d’un facteur sans créer de contournement du contrôle à deux facteurs ?
- Quelles audiences doivent être disponibles pour le message global au MVP : organisateurs, parcours public ou les deux ?
- Que deviennent les brouillons de commande commencés avant une coupure globale des inscriptions ?
- Quelles actions de support sont réellement nécessaires au MVP ?
- Quelle définition exacte retenir pour organisation active, MRR, GMV et revenu Eventflow ?
- Quelle durée de conservation appliquer au journal d’audit ?
