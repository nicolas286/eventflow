# B1 puis B2 — Migration organisateur vers les Edge

Date : 3 octobre 2026. B1/B2 implémentés et testés localement, aucune publication.
Branche `dev`, HEAD `4ef53f40c779b7bdbe65f80630a0d37bc7973574`.
`origin/dev` lu en réseau : `879b0603cd57b525ce227cc56f547322439b2c3a`, deux commits UI
de retard, non intégrés. Les modifications A0–A8/B0 et UI préexistantes sont préservées.
Pas de push, merge, déploiement, mutation distante ou données réelles.

GitNexus ne contient pas Eventflow (le dépôt `eventflow-site` est distinct).
Traçage par `rg`, sources, migrations, catalogue et tests locaux. Le lecteur de
provenance `gitnexus-work` ne fonctionne pas sous Windows ; aucun reçu ou résultat
de graphe n'est revendiqué. Les consignes explicites de travail sur `dev` et de
mise à jour des statuts priment sur les étapes génériques de branche/commit du skill.

## B1.1 — Organisations et profils

Backend et frontend implémentés, tests locaux réussis : routes strictes `organizations/bootstrap`,
`create`, `update`, `profile`, `branding`, `seller-identity`, `agreements`.
Session Auth serveur, membership owner/admin vérifié avant quota et effet ; acteur
SQL exclusivement fourni par l'Edge, client privilégié sans JWT utilisateur.
Création organisation/profil/propriétaire et preuves d'acceptation restent atomiques.
Le statut organisateur active/suspended existant est préservé ; plan, rôles,
privilèges plateforme, Stripe et état de paiement ne sont pas des champs modifiables.
Bootstrap conserve le premier membership par date et permet une sélection explicite
autorisée ; profil utilisateur et profil organisation restent distincts.

Fermeture B1.1 préparée hors migrations actives : toutes surcharges RPC historiques,
ACL tables et colonnes ; RLS utilisateur éligible seulement après fermeture.
RLS organisations/profil/members conservée pour les consommateurs B3–B6 et publics B5.
Les routes Edge ne dépendent pas de ces policies pour autoriser leurs opérations.

Exceptions non migrées précises : `update_organization_payment_settings(uuid,text,text,text)`
et `accept_organization_sales_terms(uuid,text)` restent exécutables par authenticated
car `organization-payment-settings` les appelle encore avec le JWT utilisateur.
Ce domaine paiement/conditions de vente existant, hors opérations B1 annoncées,
requiert une adaptation acteur/service-only dans B6 ; ses contrôles SQL et RLS
ne sont pas retirés ici. B1 ne signifie pas que toute mutation de ces tables est
déjà Edge-only. `default_asset_url` et les RPC publics B5 restent des exceptions
de lecture explicites ; aucun secret n'est rendu par les nouveaux DTO.

Tests ciblés : 13 Deno Edge, 14 Vitest repositories, build frontend ; suite SQL
création/propriétaire/rollback/update/preuves avec acteur explicite réussie. Fermeture
différée B1.1 éprouvée par vrais rôles anon/authenticated, tables/colonnes/surcharges
avec et sans RLS ; transaction annulée. Les permissions actives restent ouvertes
pour compatibilité jusqu'à publication. Aucune recette navigateur revendiquée.

## B1.2 — Coordonnées de facturation

Routes `organizations/billing/read` et `billing/update`, contrats stricts,
repository frontend migré. La transaction SQL interne conserve les normalisations,
les champs absents/null, le premier setup obligatoire et la remise à zéro des preuves
TVA lorsque son identité change. Aucun domaine invoices/paiement ajouté.
9 tests Edge, 20 tests repository et suites SQL active/fermeture réussis. Les tests
ont révélé un minimum évalué avant trim ; les champs requis sont désormais trimés
avant leur validation, sans effet partiel. Fermeture table/colonnes/surcharges
préparée/testée et différée ; RLS conservée pour les snapshots facture B6.
Les lecteurs SQL équivalents étaient déjà service-only, droits réaffirmés sans
changer leurs consommateurs. Les hooks lecture/écriture réutilisent la portée
session/organisation A6 et invalident réponses/erreurs obsolètes, y compris les
DTO retournés aux callers qui pourraient lancer un abonnement. 33 tests billing
repository/hook passent, TypeScript et lint ciblé réussis ; formulaire inchangé.

Recette réelle B1.1/B1.2 réussie : Auth local, HTTP du handler réel et PostgREST,
deux organisations et outsider synthétiques, fermeture appliquée uniquement dans
la base jetable, RLS métier désactivée. Bootstrap et création propriétaire,
profils/accords, facturation et isolation A/B passent ; tables/RPC internes et
historiques refusées au navigateur. Fixtures supprimées, RLS restaurée.

## B1.3 — Assets organisateur

Upload binaire via `organizations/assets/upload` et suppression scoped via
`organizations/assets/delete` : membership puis relation événement/organisation,
quota avant Storage, chemins UUID immuables générés serveur. Taille streaming
bornée à 5 MiB, formats PNG/JPEG/WebP/GIF et structure de conteneur contrôlés.
Ce contrôle ne décode pas intégralement les codecs. SVG et autres formats autrefois
acceptés par `image/*` sont désormais refusés ; les URL existantes restent lisibles.
Les limites UX logo/banner existantes sont préservées. Le remplacement crée une
nouvelle URL ; les anciennes images peuvent rester orphelines, sans nettoyage
automatique des références publiques. La route de suppression n'ajoute pas de flow UI.

11 tests Edge (dont fichiers réels et logo du dépôt), 20 tests repository, check/lint
ciblés passent. Recette Auth/HTTP/Storage réelle réussie : uploads cross-org refusés,
contenu HTML déguisé refusé, chemins distincts, lecture publique et suppression
scoped ; écritures Storage directes refusées. Les trois policies applicatives
d'écriture sont retirées par fermeture différée ; Storage géré conserve RLS, grants,
lecture publique et réglages du bucket. Le test GraphQL ne restitue pas les données
fermées. Cette recette utilise exclusivement la stack jetable.

Revue indépendante B1 réussie après correction de la continuation abonnement :
26 tests caller/hook/cancellation vérifient session remplacée, org changée,
démontage pendant la lecture suivant le save, et abonnement conservé au bon scope.

| Chemin B1 | Avant | Après implémentation et fermeture différée |
| --- | --- | --- |
| Bootstrap/org/profils/accords | RPC ou tables au JWT, autorisation SQL/RLS | Edge Auth/membership, DTO stricts, transaction service-only |
| Facturation | RPC au JWT, SQL/RLS | Edge scoped, transaction service-only, omission/null préservés |
| Assets | Storage navigateur, chemins fixes | Edge binaire validé, UUID serveur, anciennes écritures refusées |
| Paiement/conditions de vente B6 | RPC au JWT appelée par Edge existante | Exception conservée avec ses gardes SQL, à migrer en B6 |
| Tables partagées et Storage | Policies existantes | Policies nécessaires B3–B6/Storage conservées ; permissions navigateur B1 fermées après publication |

## B2.1 — Événements

Six routes `events/overview`, `detail`, `create`, `update`, `duplicate`, `delete`,
cinq repositories migrés et seed staging adapté (non exécuté). Le détail conserve
l'accès UUID ou organisation/slug. L'Edge dérive l'organisation de la ressource,
autorise owner/admin, puis consomme A8. Opérations SQL internes service-only :
`organizer_get_events_overview`, `organizer_get_event_detail_admin_core`,
`organizer_create_event`, `organizer_update_event`, `organizer_duplicate_event`,
`organizer_delete_event`. Actor SQL issu d'Auth, aucun `auth.uid()` de confiance.

Dates ISO avec offset en entrée, DTO explicites en sortie (timestamps SQL inchangés),
charte, publication, régénération du slug au changement de titre et cascades de
suppression conservées. Duplication atomique : UUID renouvelés, groupes remappés,
options JSON inchangées et compteurs produits remis à zéro. Corrections production :
les quotas payants sont évalués avant insertion et les lots de produits/champs
copiés sont comptés ensemble. Le verrou organisation sérialise ces transitions.
Le plafond physique de dix produits reste actif. Le plafond historique de trente
champs avait été supprimé par une migration ; il n'est pas réintroduit. Le quota
configurable porte sur les champs actifs. Les réglages de plan ne sont pas
écrasés. L'Edge ne délègue pas l'autorisation métier à ces invariants SQL.

15 tests Edge, 37 tests frontend repository/stores/caller, check/lint ciblés réussis.
Suite SQL réelle, refus ACL avec/sans RLS et deux scénarios PostgreSQL concurrents
réussis : création payante et transition payante, attente effective du verrou,
un succès et un refus de quota sans état partiel. Recette Auth/HTTP/PostgREST réelle
réussie pour UUID/slug, admin, A/B, duplication et suppression avec RLS métier off.
Les gardes A6 du détail/mutations empêchent affichage ou navigation obsolètes ;
un reload au même scope conserve la saisie. Aucun test visuel navigateur revendiqué.

Fermeture événements préparée et éprouvée, toujours différée : toutes surcharges
historiques et ACL table/colonnes. Sa publication doit attendre les consommateurs
produits/formulaires B2.2/B2.3, dont les anciennes policies lisent `events`.
RLS partagée conservée pour B3–B5. Pas de publication ni mutation distante.
La revue a également fermé `get_event_by_slug`, lecture équivalente sans appelant,
et ajouté un filtre organisation aux agrégats commandes : une fixture contenant
org B/événement A est exclue des totaux A. Pendant la transition, les garanties de
sérialisation des nouvelles opérations ne couvrent pas les anciens chemins encore
ouverts ; la fermeture différée met fin à cette coexistence.

## Matrice des opérations

Chaque route vérifie Auth serveur puis owner/admin et la ressource avant A8.
« Différé » signifie : fermeture SQL livrée et testée sur base jetable, pas appliquée
aux environnements publiés. Les fonctions internes n'ont aucun EXECUTE navigateur.

| Appel frontend historique | Route Edge | Données/opération interne | Autorisation et ancien accès |
| --- | --- | --- | --- |
| Dashboard `get_dashboard_bootstrap` | `organizations/bootstrap` | SELECT DTO profil propre, membership et org autorisée | Acteur Auth et org choisie ; RPC/table/colonnes différé |
| `create_organization` | `organizations/create` | `organizer_create_organization` | Acteur injecté, création propriétaire atomique ; RPC différé |
| `update_organization` | `organizations/update` | `organizer_update_organization` | Manager org, allowlist ; RPC/table/colonnes différé |
| UPDATE `user_profile` | `organizations/profile` | UPDATE `user_id = acteur Auth` | Profil propre, aucun privilège modifiable ; table/colonnes différé, retrait RLS séparé |
| UPDATE `organization_profile` | `organizations/branding` | UPDATE `org_id` autorisé | Manager org ; table/colonnes différé |
| Identité/accords RPC directs | `organizations/seller-identity`, `agreements` | `organizer_update_seller_identity`, `organizer_accept_platform_agreements` | Manager, acteur/versions/preuves ; surcharges différé |
| RPC billing read/upsert | `organizations/billing/read`, `update` | SELECT scoped / `organizer_upsert_organization_billing` | Manager, flags système interdits ; table/colonnes/RPC différé |
| Upload Storage navigateur | `organizations/assets/upload`, `delete` | Storage service, chemin UUID imposé | Manager + relation événement, contenu borné ; trois policies d'écriture différé |
| `get_events_overview` | `events/overview` | `organizer_get_events_overview` | Manager org, événements et agrégats org filtrés ; RPC/table/colonnes différé |
| `get_event_detail_admin_core` | `events/detail` | `organizer_get_event_detail_admin_core` | Org dérivée UUID ou slug/org autorisés ; RPC et équivalent `get_event_by_slug` différé |
| `create_event` | `events/create` | `organizer_create_event` | Manager org, actor injecté, quotas SQL ; RPC différé |
| `update_event` | `events/update` | `organizer_update_event` | Org dérivée, patch sans réaffectation ; RPC différé |
| `duplicate_event` | `events/duplicate` | `organizer_duplicate_event` | Source autorisée, transaction et IDs renouvelés ; RPC différé |
| DELETE `events` | `events/delete` | `organizer_delete_event` | Ressource/org vérifiées, cascades/FK conservées ; table/colonnes différé |
| `create_event_product` puis SELECT | `events/products/create` | `organizer_create_event_product`, DTO retour transactionnel | Org dérivée événement, compteurs DB ; RPC/table/colonnes différé |
| `update_event_product` puis SELECT | `events/products/update` | `organizer_update_event_product` | Produit/événement/org dérivés, stock verrouillé ; RPC/table/colonnes différé |
| SELECT produit (patch vide) | `events/products/read` | SELECT DTO `id` + `event_id` | Produit autorisé avant quota/read ; table/colonnes différé |
| DELETE `event_products` | `events/products/delete` | `organizer_delete_event_product` | Produit autorisé, snapshots/FK conservés ; table/colonnes différé |
| `create_event_form_field`, UPDATE champ | `events/forms/fields/create`, `update` | `organizer_create_event_form_field`, `organizer_update_event_form_field` | Org dérivée, groupe du même événement, options exactes ; RPC/table/colonnes différé |
| SELECT/DELETE champ | `events/forms/fields/read`, `delete` | SELECT scoped / `organizer_delete_event_form_field` | Champ/événement autorisés ; table/colonnes différé |
| `create_event_form_field_group`, UPDATE groupe | `events/forms/groups/create`, `update` | `organizer_create_event_form_field_group`, `organizer_update_event_form_field_group` | Org dérivée, patch métier ; RPC/table/colonnes différé |
| SELECT/DELETE groupe | `events/forms/groups/read`, `delete` | SELECT scoped / `organizer_delete_event_form_field_group` | Champs conservés avec `group_id = NULL` ; table/colonnes différé |
| Deux UPDATE successifs pour déplacer | `events/forms/reorder` | `organizer_reorder_event_form` | Tous les IDs du même événement, transaction unique ; table/colonnes différé |
| SELECT `promo_codes` par événement | `events/promos/list`, `read` | SELECT DTO `org_id` + `event_id` et ID sur read | Org dérivée et relation vérifiée ; table/colonnes différé |
| INSERT `promo_codes` | `events/promos/create` | `organizer_create_event_promo_code` | Manager événement, org client comparée puis injectée ; table/colonnes différé |
| UPDATE `promo_codes` | `events/promos/update` | `organizer_update_event_promo_code` | Promo/événement/org vérifiés, patch métier et compteur immuable ; table/colonnes différé |
| DELETE `promo_codes` | `events/promos/delete` | `organizer_delete_event_promo_code` | Relation vérifiée, FK redemptions conservée ; table/colonnes différé |

## B2.2 — Produits

Backend/front implémentés : create/update transactionnels retournent un DTO complet,
read scoped conserve le patch vide du repository, delete garde les snapshots
SET NULL et le refus des tickets émis. Aucun compteur, identifiant système ou
rattachement modifiable en patch. EUR normalisé, prix en centimes, participants,
flags gatekeeper et omission/null conservés. Changement production annoncé : `0`
reste un stock fini, `NULL` illimité ; l'ancien convertisseur les confondait.
Le stock ne peut pas descendre sous réservé + vendu, contrôlé sous verrou et par
la contrainte existante. Les commandes conservent leurs snapshots historiques.

15 tests Edge, 16 contrats, 24 repositories et 7 tests editor/caller passent ;
le groupe ciblé frontend compte 60 tests avec les 13 gardes événements réutilisées.
SQL réel et recette Auth/HTTP/PostgREST avec RLS off passent pour stock, tenant,
quotas, champs système et anciens accès. Deux scénarios de capacité payante et une
réservation concurrente prouvent le contrôle du nouvel état commis. Gardes A6 et
révision éditeur empêchent une réponse/timer tardifs de fermer une nouvelle saisie.
Messages UX ajoutés pour stock alloué, élément lié et ressource temporairement occupée.

La revue a corrigé l'interaction avec le checkout existant : verrous organisation
`NO KEY UPDATE` compatibles avec les FK, update/delete produit sans verrou événement
préalable. Suppression événement : préverrouillage NOWAIT des commandes puis des
produits avant les cascades, refus temporaire `RESOURCE_BUSY` sans effet partiel.
Une relation legacy commande/événement appartenant à une autre org est refusée
comme invariant incohérent, sans correction ni suppression automatique. Ces gardes
n'ajoutent aucun critère de publication ni règle métier sur une suppression valide.
La validation concurrente réelle passe dans cinq scénarios : checkout + update,
checkout + delete produit, checkout + delete événement occupé puis retry,
expiration + delete événement occupé puis retry, verrou événement seul + refus
NOWAIT puis retry. Les dépendances de blocage sont observées en PostgreSQL ; aucune
fonction checkout/paiement/B3 n'est modifiée. Aucun paiement, e-mail ni garantie
générale sur tous les workers n'est revendiqué. Revue B2.2 passée après correction.

## B2.3 — Formulaires

Neuf routes et sept opérations internes couvrent champs, groupes et ordre combiné.
Les relations A2 sont vérifiées avant quota puis en transaction ; supprimer un
groupe conserve les champs, les réponses et snapshots historiques. Réordonner est
une transaction unique : tous les IDs sont validés et verrouillés avant écriture.
Les UUID en majuscules sont acceptés et les doublons détectés sans tenir compte de
la casse. Le JSON options conserve ses valeurs, clés et espaces ; la validation
mesure comme JavaScript sans transformer le contenu, y compris tabs et Unicode.

Le catalogue effectif confirme l'absence de limite physique de trente champs,
supprimée historiquement. Elle n'est pas réintroduite. Les quotas configurables
de champs actifs restent appliqués, sans remplacer les réglages métier. SQL réel
valide plus de trente champs inactifs, duplication de 122 champs dont 31 actifs,
types, options, relations, unicité, suppression et absence d'effets partiels.
Trois scénarios concurrents passent : création et activation à la limite réelle
de 100 actifs, puis deux réordonnancements entiers sérialisés.

20 tests Edge, fermeture ACL table/colonnes/toutes surcharges avec RLS off et
recette Auth/HTTP/PostgREST réelle passent. La revue a corrigé la limite obsolète,
les mesures de whitespace/UTF-16 et les UUID canoniques. Frontend migré : six
repositories existants et un reorder, sept hooks avec gardes A6, révisions de saisie
et rollback de l'ordre local sur refus. 69 tests ciblés contrats/repos/callers/stores,
TypeScript et lint passent. La composition de page conserve le panneau pendant
un refresh ou une erreur avec données du même scope ; un nouvel ordre reçu
invalide les anciens retours. Revue indépendante favorable après correction,
avec revalidation des 69 tests. Aucune publication.
RLS partagée reste nécessaire à B3 et B5, notamment
mise à jour des participants et lecture publique des formulaires.

## B2.4 — Codes promotionnels

Cinq routes backend et trois RPC internes service-only sont implémentées. Les
DTO interdisent compteur, identifiants système, rattachement et timestamps en
patch. Le code est normalisé trim/majuscules et unique par événement selon l'index
historique ; remises exclusive pourcentage/centimes, dates et null/omission sont
conservés. Les dates partielles sont validées contre l'état complet verrouillé.
La liste conserve le maximum Data API configuré de 1000 et l'ordre créé décroissant,
avec filtres organisation et événement explicites.

Le CRUD ne refuse pas un code expiré ou épuisé : l'organisateur doit pouvoir le
gérer. Le checkout garde les contrôles de validité et incréments d'usage en SQL.
Abaisser `maxUses` sous le compteur reste permis et rend les prochains usages
épuisés ; aucun reset. La suppression conserve la FK RESTRICT des redemptions et
le garde UI historique `usedCount > 0`, sans ajouter de règle SQL. Aucun trigger
`updated_at` n'existe sur cette table : le patch conserve le timestamp historique.
Les redemptions gardent leur montant de remise ; le libellé affiché dans la vue
commandes utilise toujours le code actuel après renommage, comportement existant.

Aucun gate de plan `promo_codes` n'est appliqué par le CRUD ou ses appelants
historiques ; aucun nouveau gate n'est inventé. Les quotas A8 s'appliquent à toutes
les routes. Aucun plafond horaire SQL supplémentaire n'est ajouté aux anciens
CRUD directs ; seuls les quotas SQL historiques des RPC existantes sont conservés.

Les FK historiques org/événement indépendantes ne prouvent pas leur cohérence.
Les nouvelles routes et SQL la vérifient ; une relation legacy incohérente refuse
lecture individuelle et mutation sans modifier les lignes. La suppression de
l'événement refuse aussi cette cascade vers une promotion d'une autre org, avant
et après verrouillage. Aucun inventaire distant ni correction automatique de
données existantes n'est effectué. Checkout et vue commandes B3 restent des
dépendances explicites, sans migration de leurs fonctions dans ce lot ; la RLS
partagée des promotions/redemptions est conservée.

34 tests de contrats et 16 tests Edge passent. Refus réels ACL avec/sans RLS et
recette Auth/HTTP/PostgREST des cinq routes passent, notamment date partielle
invalide sans effet, changement de remise sans reset et relations falsifiées.
SQL réel valide les cinq refus checkout (étranger, expiré, futur, inactif, épuisé),
les snapshots, FK, patches et cascades. Trois scénarios concurrents passent :
checkout + update gardant le nouveau compteur, checkout + delete refusé par FK,
deux checkouts pour une dernière utilisation avec un seul succès sans état partiel.
Le code legacy rembourré d'espaces reste valide sur un patch indépendant ; le SQL
mesure selon la contrainte historique sans réécrire ce code.

Frontend migré : repository, cache session/organisation/événement, callbacks et
révision de saisie. 80 tests ciblés (34 contrats, 22 repos, 9 stores, 15 callers),
TypeScript et lint passent. Routes exactes SDK vérifiées, drafts conservés pendant
save/refetch, retours tardifs ignorés ; la création attend le chargement initial,
avec saisie libre. Revue indépendante favorable, 84 tests revalidés avec la page
commune. Fermeture table/colonnes livrée et différée ; aucune ancienne RPC CRUD
promo ni vue équivalente trouvée.

## Publication prévue

Le pipeline applique SQL avant Edge et frontend. Les migrations actives ajoutent
uniquement les opérations internes service-only. La fermeture reste dans
`supabase/deferred-migrations`, à promouvoir via une nouvelle migration dans une
release distincte après backend puis frontend et fenêtre B0 de 24 h explicitement
inscrite lors de la publication autorisée. Aucun fallback vers les anciens accès.
Le retrait RLS éligible `user_profile` est une phase 4 séparée, avec précondition
SQL refusant de désactiver RLS si un droit navigateur table/colonne subsiste.

## Validations

Validation finale après replay frais, sur la stack dédiée
`eventflow-security-b1b2-20261003`, ports 553xx, fixtures synthétiques uniquement.
La stack existante `eventflow-front` est intacte. La stack jetable a été arrêtée
avec `--no-backup` ; aucun conteneur dédié ne reste actif.

| Vérification | Résultat final |
| --- | --- |
| `supabase db reset --local --no-seed --workdir node_modules/.cache/eventflow-security-b1b2 --yes` | 61 migrations actives rejouées ; fermetures différées exclues |
| `tests/database/*.sql` | 12 suites réussies sur base fraîche |
| `organizer-migrations.checks.mjs` | 7 suites B1/B2 réussies ; fixtures et fermetures annulées |
| `invoice-history.checks.mjs`, `organizer-boundary.checks.mjs … b1`, `… b2` | B0/B1/B2 : vrais rôles, refus tables/colonnes/toutes surcharges avec et sans RLS ; lectures serveur conservées |
| Cinq recettes `tests/database/b2/*concurrency.checks.mjs` | 16 scénarios PostgreSQL concurrents réels réussis, sans état partiel |
| `organizer.local.mjs node_modules/.cache/eventflow-security-b1b2 b2` | Deux recettes HTTP cumulatives B1/B2 réussies : vrais Auth/PostgREST/Storage, anciens accès refusés, requête GraphQL sans données fermées |
| `npm run check:backend`, `npm run lint:backend` | Réussis, 223 fichiers lintés |
| `npm run test:backend` | 396 tests réussis |
| `npm test` | 486 tests Vitest dans 51 fichiers et 16 tests Node réussis |
| `npm run build` | TypeScript et Vite réussis, configuration publique locale/placeholder |
| Lint frontend ciblé et `git diff --check` | Réussis |

Les deux recettes checkout concurrentes sont autonomes : capture stricte du
réglage local `registrations_open`, ouverture temporaire puis restauration
vérifiée dans `finally`, même si le cleanup échoue. Elles passent à partir du
réglage fermé d'un replay frais. Aucun réglage de plan n'est écrasé. La CI et le
préflight SQL du déploiement exécutent suites, fermetures annulées et concurrence.
Les recettes acceptent uniquement la stack dédiée ou le conteneur GitHub Actions
jetable explicitement demandé avec `--ci` et variables CI vérifiées.

Scripts de seed organisateur migrés vers les nouveaux domaines ; le seed staging
n'a pas été exécuté. Le check backend vérifie également le refus sans Auth des
nouveaux domaines avant publication du frontend. Aucun check distant ni pipeline
GitHub n'a été déclenché. CLI locale 2.75.0, pin CI 2.84.2 conservé.

Limites : aucun test visuel navigateur ni recette gateway Edge déployée. La
recette locale utilise les vrais handlers Deno, Auth et services Supabase locaux.
Les preuves RLS off concernent les tables métier fermées ; le schéma Storage géré
conserve ses ACL/RLS et seules les policies d'écriture applicatives sont retirées.
Les dépendances B3–B6 explicites restent protégées par leurs contrôles existants.
Aucune fermeture n'est appliquée à staging/production ; aucun résultat métier
production, paiement, e-mail client, commit, push, fusion ou déploiement revendiqué.
