# Back-office interne Eventflow

**Statut : proposition de chantier, sans migration ni implémentation.**

Ce chantier crée un espace réservé à l’équipe Eventflow pour piloter la plateforme et onboarder des organisations. Il est distinct de l’administration organisateur et de sa refonte visuelle décrite dans [admin-ui-redesign.md](admin-ui-redesign.md).

## Objectif

Créer un back-office interne permettant de :

- suivre les KPI produit, commerciaux, financiers et opérationnels ;
- rechercher et consulter les organisations ;
- onboarder une agence ou un organisateur avec son propriétaire ;
- suivre l’état de configuration, d’abonnement et de paiement ;
- détecter les situations nécessitant une intervention ;
- effectuer quelques actions contrôlées, tracées et réversibles lorsque possible.

Ce back-office ne doit pas devenir un accès direct et illimité aux tables. Chaque lecture ou mutation doit avoir un contrat, une autorisation serveur et une trace adaptée.

## État observé

- `public.user_profile` ne contient actuellement aucun champ `is_admin` ou équivalent.
- `organization_members.role` accepte `owner` et `admin`, mais ces rôles sont limités à une organisation. Ils ne représentent pas un administrateur Eventflow.
- `organizations` contient déjà `status`, `plan`, les dates du plan et plusieurs états de configuration de paiement.
- L’onboarding actuel appelle `create_organization(jsonb)`. Cette RPC crée une organisation pour l’utilisateur connecté et le rend `owner`.
- Le bootstrap organisateur sélectionne la première organisation de l’utilisateur. Il n’est pas conçu pour naviguer dans l’ensemble des organisations de la plateforme.
- La table `user_profile` autorise actuellement un utilisateur authentifié à mettre à jour sa propre ligne. Ajouter simplement un booléen administrateur à cette table sans protection permettrait une élévation de privilèges.

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

## Principe d’architecture

### Frontend

- Espace dédié sous `/platform`, et non sous les routes organisateur `/admin`.
- Shell et navigation propres, avec identité Eventflow plutôt que couleurs d’une organisation.
- Garde de route pour l’expérience utilisateur, mais jamais considérée comme une autorisation suffisante.
- Contrats Zod dédiés dans `shared/schemas` pour les réponses et mutations de la plateforme.
- Flux `page → hook → repository → Edge Function/RPC autorisée`.

### Backend

- Toute route vérifie la session puis le statut d’administrateur plateforme côté serveur.
- Les lectures globales passent par des endpoints ou RPC dédiés, paginés et limités au strict nécessaire.
- Les opérations nécessitant `service_role`, notamment Auth Admin, restent dans une Edge Function et ne sont jamais exposées au navigateur.
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
| Exploitation    | Échecs de livraison, traitements en attente et santé des parcours  |
| Journal         | Historique des actions internes sensibles                          |
| Administrateurs | Gestion restreinte des accès internes, dans un lot ultérieur       |

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
- table d’audit interne ;
- RPC de lecture paginée/agrégée ou vues privées dédiées ;
- fonction transactionnelle d’onboarding d’une organisation pour un propriétaire donné ;
- index sur les filtres réellement utilisés ;
- aucune modification rétroactive d’une migration appliquée.

### Edge Functions

- domaine `/platform-admin` ou routes équivalentes ;
- middleware commun d’authentification et d’autorisation, sans masquer les permissions métier ;
- endpoint d’onboarding utilisant Auth Admin ;
- endpoints read-only pour overview et organisations ;
- limites de débit, validation Zod et réponses d’erreur stables ;
- logs sans secrets ni payloads personnels complets.

### Frontend

- `PlatformAdminRoute` et shell dédié ;
- modules `overview`, `organizations`, `onboarding` et `audit` ;
- repository et hooks distincts du bootstrap organisateur ;
- tableaux paginés, filtres dans l’URL et états 401/403/429 explicites ;
- métadonnées `noindex, nofollow` ;
- aucun accès direct global aux tables Supabase depuis les composants.

## Déroulement proposé

### Lot 0 — Définitions et modèle d’accès

- Valider le terme agence/organisation et les KPI exacts.
- Choisir registre privé ou champ protégé.
- Définir les rôles internes, la MFA éventuelle et la procédure d’attribution initiale.
- Inventorier les données nécessaires et celles qui doivent rester masquées.

### Lot 1 — Socle sécurisé et lecture seule

- Ajouter l’autorisation plateforme et ses tests négatifs.
- Créer le shell `/platform`.
- Livrer une liste paginée des organisations et une fiche read-only.
- Ajouter le journal d’audit avant les premières mutations.

### Lot 2 — Onboarding

- Créer le contrat d’onboarding et l’Edge Function.
- Gérer utilisateur existant, nouvel utilisateur, retry et échec partiel.
- Tester l’e-mail uniquement sur staging/capture prévue, jamais vers un client réel.
- Ajouter une page de résultat et les actions de reprise sûres.

### Lot 3 — KPI et exploitation

- Ajouter les agrégations définies et testées.
- Mettre en place périodes, comparaison et rafraîchissement.
- Ajouter les alertes opérationnelles avec critères documentés.
- Vérifier les performances sur volumes représentatifs.

### Lot 4 — Mutations avancées

- Suspendre/réactiver, gérer les plans ou relancer certains traitements seulement après définition métier.
- Ajouter confirmation forte, audit et tests d’autorisation pour chaque action.
- Conserver hors périmètre les opérations de paiement live non testables sans risque.

## Tests indispensables

- utilisateur non connecté : refus ;
- utilisateur organisateur `owner` ou `admin` : refus de l’espace plateforme ;
- utilisateur standard modifiant son profil : impossible de s’attribuer le rôle plateforme ;
- administrateur plateforme : accès aux seules routes prévues ;
- deux organisations synthétiques : aucune fuite via les routes organisateur ;
- pagination, filtres, limites et payloads invalides ;
- onboarding répété avec la même clé : pas de doublon ;
- e-mail déjà connu, e-mail nouveau et échec Auth intermédiaire ;
- audit créé pour chaque mutation, sans secret ;
- reconstruction SQL jetable, tests Edge simulés, build frontend et recette staging.

## Critères d’acceptation du MVP

- Le privilège plateforme est distinct des rôles d’organisation et impossible à s’auto-attribuer.
- Un non-administrateur reçoit un refus serveur, même en appelant directement l’API.
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
- Faut-il exiger une MFA pour tout accès plateforme ou seulement les mutations sensibles ?
- Quelles actions de support sont réellement nécessaires au MVP ?
- Quelle définition exacte retenir pour organisation active, MRR, GMV et revenu Eventflow ?
- Quelle durée de conservation appliquer au journal d’audit ?
