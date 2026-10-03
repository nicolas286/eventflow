# B0 — Historique des factures via Edge

Date : 2 octobre 2026. Branche `dev`, HEAD `4ef53f40c779b7bdbe65f80630a0d37bc7973574`.
Les modifications A0–A8 et frontend préexistantes ont été conservées. Aucun commit,
push, merge, déploiement ou appel distant réalisé. GitNexus `list_repos` ne contient
pas ce dépôt ; `eventflow-site` est distinct. Traçage par sources, migrations,
catalogue local et tests, sans preuve de graphe/PDG.

**Statut : tranche verticale prête et validée localement ; fermeture livrée et
testée, différée hors du pipeline actif ; aucun déploiement. B0 n'est pas clôturé
sur les environnements publiés.** Les lots B1–B6 ne sont pas implémentés.

## Revalidation des prérequis

Les rapports A0–A8 et le complément de synchronisation ont été lus et confrontés
aux sources du checkout, sans déduire leur publication :

| Lot | État local constaté |
| --- | --- |
| A0 | Inventaire disponible ; métadonnées distantes historiques, aucune nouvelle inspection distante |
| A1 | Fermeture interne versionnée à HEAD, migration équivalente locale conservée ; suite SQL repassée |
| A2 | FK composite champ/groupe/événement et préflight locaux ; suite SQL repassée |
| A3 | ACL table/colonnes système produits corrigées localement ; suite SQL repassée |
| A4 | Réponse paiement SQL validée, solde/échéance distingués ; tests SQL/Deno repassés |
| A5 | Livraison durable, bail/token/reprise bornée présents ; suites repassées, pas de garantie exactly-once |
| A6 | Session/cache organisateur et plateforme présents ; recette navigateur toujours non effectuée |
| A7 | Contrats Connect, limites HTTP et bypass CAPTCHA bornés présents ; tests repassés |
| A8 | Quotas 429/panne 503 et client présents ; frontière IP et planification purge non attestées |
| D1 | Partiel grâce à A6 : réponses plateforme périmées rejetées ; verrou explicite identité/cible mutation non livré |
| D2 | Ouvert : `currentTarget.reset()` après await toujours présent |
| D3 | Ouvert : onboarding lit l'opération sans verrou avant préconditions ; aucune migration corrective |
| D4 | Partiel grâce à A6 ; récupération MFA et preuve SQL step-up complète restent ouvertes |
| D5 | Ouvert : reprise des livraisons failed et constantes légales restantes |

Le modèle plateforme existant a été examiné : `createEdgeHandler`, client service
indépendant, Auth serveur, état session/registre privé/MFA, contrats et ACL RPC
serveur. Sa logique SQL d'autorisation n'est pas recopiée dans le pilote.

## Opération et contrat

Opération choisie : **lecture paginée de l'historique des factures d'une
organisation**, déjà utilisée par
`AdminSubscriptionPage → InvoicesTab → useMakeInvoiceList → makeInvoiceListRepo`.
Aucun paiement, génération de facture, mutation d'abonnement ou export ajouté.
Le téléchargement PDF conserve son endpoint existant.

Entrée `POST invoices/list` : `{ orgId, limit: 1..100 (25 par défaut), cursor? }`.
Curseur : `{ id, issuedAt: ISO avec offset | null }`. Payload strict, 4 Kio maximum,
JSON invalide 400, dépassement 413, méthodes non permises 405.
Réponse : `{ orgId, items, nextCursor }`, avec chaque item limité à
`id, number, status, issuedAt, totalCents, dueAt, paymentReference`.
Les identifiants prestataires, `billing_snapshot`, `pdf_path` et autres colonnes
ne traversent pas cette route. Types déduits de Zod dans `shared/schemas`.

`dueAt/paymentReference` sont préservés depuis la définition **effective** de
`rpc_list_invoices` dans `20260928181116_manual_subscription_invoicing.sql`,
et pas seulement sa définition initiale. Les affichages, absence de données,
chargement, erreurs, ajout de page et rafraîchissement sont conservés.
Les erreurs serveur/transport sont traduites en message sûr ; 403 et 429/503
conservent leur traitement utile. Le schéma d'arguments RPC et le DTO de ligne DB
devenus sans appelant avec cette migration sont retirés après recherche des usages.

**Changement de comportement production intentionnel :** les pages incluent les
factures sans date après les factures datées et continuent ensuite par ID. L'ancien
RPC excluait les dates null dans sa comparaison de tuples puis pouvait répéter la
première page avec un curseur null. Le tri reste date décroissante/nulls last puis
ID décroissant. Une dernière page pleine conserve un curseur, suivie au besoin
d'une page vide, comme auparavant. Aucun changement de montant ou de statut.
Un curseur supprimé ou modifié est refusé ; rafraîchir recharge la première page.

## Patron réutilisable, autorisation et données

1. `createEdgeHandler(auth: required, serviceClient: true)` vérifie le bearer avec
   `Auth.getUser` ; sessions absente/invalide/expirée sont refusées avant lecture.
2. `assertOrganizationManager` interroge la source serveur
   `organization_members`, avec **org demandé + ID de l'utilisateur vérifié**.
   Il accepte uniquement owner/admin. `orgId` n'est pas une preuve ; `userId`
   supplémentaire est rejeté et `user_metadata` ignorée.
3. Quota existant consommé avec clé hashée user/org et scope
   `invoices:history:1m`, budget 120/minute, après membership, avant lecture.
   Un curseur invalide consomme le budget ; un utilisateur étranger ne consomme
   pas celui de la victime. Panne limiteur = 503, épuisement = 429/Retry-After.
4. Repository serveur : `.from(invoices)` utilise uniquement le client privilégié
   créé par le socle, sans header Authorization utilisateur. Toutes les requêtes
   portent `.eq(org_id, org autorisée)` ; la résolution du curseur ajoute son ID
   et ne charge que `id, issued_at`. Curseur étranger/incohérent = 403 sans lookup
   non borné. La pagination utilise le timestamp retourné par PostgreSQL, y
   compris sa précision, après vérification de cohérence du timestamp client.
5. Mapping explicite et réponse validée. Aucun proxy table/action, framework de
   permissions, routeur SQL universel, DI ou déplacement global introduit.

L'ancien RPC dépend de `auth.uid()` ; le nouveau chemin **ne l'invoque pas**.
Aucun acteur issu du payload n'est transmis à SQL. La lecture ne reconstruit
aucune transaction d'écriture ; contraintes, triggers et invariants PostgreSQL
restent intacts. Les anciennes fonctions serveur ne sont pas réécrites.

## Fermeture complète du périmètre pilote

Migration préparée par `supabase migration new`, puis placée dans
`supabase/deferred-migrations/b0/20261002213326_close_invoice_history_browser_access.sql`.
Elle est **exclue de `db push`** tant qu'elle n'est pas promue explicitement :

- révoque PUBLIC/anon/authenticated sur **toutes** les surcharges de
  `rpc_list_invoices`, conserve EXECUTE service_role ; une signature actuelle
  est constatée et testée ;
- révoque les grants table **et colonnes** sur `public.invoices`, y compris
  SELECT et voies UPDATE/DELETE RETURNING, INSERT et TRUNCATE ; conserve les
  droits serveur existants et garantit SELECT service_role ;
- retire seulement la policy applicative inspectée
  `storage.objects.invoices_read_auth_org_member`, qui ouvrait l'énumération,
  lecture et signature navigateur des PDF du bucket privé ; aucun grant/RLS
  global ni autre policy Auth/Storage modifiés.

Voies équivalentes inventoriées : aucune vue publique de factures dans le replay.
Les fonctions publiques lisant invoices/invoice_peppol sont serveur-only sauf
l'ancien RPC fermé et **`get_dashboard_bootstrap.latestOpenInvoice`**. Ce dernier
reste un résumé distinct de la dernière facture manuelle ouverte, déterminé par
le membership de `auth.uid()`, sans org fourni. Son absence de fuite B est testée
sans RLS. **Tout le domaine factures n'est donc pas Edge-only** ; ce résumé relève
des lots futurs. `platform_admin_read` et les RPC création/PDF/Peppol/livraison
restent réservés au serveur. Les callbacks et tâches de subscriptions/workers
conservent leurs accès. Aucun usage direct frontend/Netlify du bucket factures ni
autre consommateur de la liste n'est trouvé dans le dépôt. Les consommateurs hors
dépôt et les écarts distants restent à inventorier avant publication autorisée.

Les policies RLS des tables partagées sont inchangées. Le pilote ne dépend plus
de RLS **après sa fermeture** ; cela ne signifie ni retrait de toutes les policies
du domaine, ni fermeture effective des environnements aujourd'hui publiés.
Les default privileges globaux restent à traiter en B6.

## Preuves et validations

Base jetable : projet `eventflow-security-b0-20261002`, PostgreSQL 17, ports
603xx, CLI local 2.75.0, **55 migrations actives rejouées** sans seed réel, copie de
seuls config/migrations, aucune lecture `.local` ni credential distant.

- **15 tests frontend ciblés** : SDK Functions réel/fetch contrôlé, unique route
  Edge, payload, DTO strict, cursor/null, mauvais org, 403, 401/message sûr,
  erreurs serveur, quotas et transitions chargement/vide/erreur/refresh/pages.
- **9 tests Deno ciblés** : Auth, A/B, membership, rôle inconnu fail-closed,
  metadata ignorée, payload/taille, erreurs/quotas, filtres et **headers SDK
  service distincts du JWT utilisateur**, DTO et curseur. Aucun rôle métier
  insuffisant réel : la contrainte membership accepte seulement owner/admin,
  tous deux autorisés. Le test de rôle inconnu vérifie le défaut fermé, sans
  prétendre reproduire un troisième rôle existant.
- **SQL réel B0** : fermeture appliquée dans une transaction **annulée**,
  après injection de grants PUBLIC/colonnes permissifs. EXECUTE et lectures
  table/colonnes/RETURNING/TRUNCATE refusés sous vrais rôles anon/authenticated.
  Mêmes refus après `DISABLE ROW LEVEL SECURITY` sur invoices et membership ;
  accès serveur aux deux organisations et membership conservé. Catalogue,
  PUBLIC, surcharges, vues et autres RPC vérifiés. Contrôle négatif : rétablir
  EXECUTE authenticated fait échouer la suite avec `Bad history function ACL`,
  puis la transaction est annulée.
- **12 autres suites SQL** de `tests/database/*.sql` réussies, avant et après
  activation locale de la fermeture, vérifiant les consommateurs serveur existants.
- **1 recette HTTP réelle** (nombreux scénarios, pas un mock du handler) : serveur
  Deno hébergeant le dispatcher réel, Auth/PostgREST/Storage locaux, utilisateurs
  et organisations synthétiques. A/A owner et admin, B/B, vide, A/B et B/A refusés,
  outsider, cursor étranger/incohérent, acteur falsifié, JWT invalide et JWT local
  correctement signé mais expiré. Pagination datée puis draft null et fin vide.
  Ancien RPC refusé (42501/PGRST202), table/colonne refusée (42501), GraphQL sans
  données, Storage list/download/sign refusés. PDF serveur signé téléchargé et
  PDF étranger refusé. Quota SQL réellement épuisé = 429/Retry-After, B reste 200.

Le test SQL désactive RLS au sein de sa transaction annulée. PostgreSQL garde un
verrou AccessExclusive jusqu'à la fin d'un `ALTER TABLE` : une requête HTTP d'une
autre connexion ne peut pas lire à travers ce verrou. Pour **la preuve HTTP
complémentaire**, la recette commit donc la fermeture et la désactivation RLS
uniquement dans cette base jetable, puis réactive RLS en finally. Storage conserve
son RLS géré. Les fixtures sont supprimées et la stack B0 détruite après validation.
La preuve cross-tenant fonctionne avec le client serveur réellement privilégié
et RLS métier réellement désactivée ; aucun état de test n'est appliqué à distance.

Commandes finales : `check:backend`, `lint:backend`, `test:backend` réussis
(**297 tests Deno**) ; `npm test` réussi (**186 Vitest + 16 Node**) ; `npm run build`
réussi. Lint ciblé frontend/outillage et Deno recette réussis, `git diff --check`
réussi. Avertissement Vite de chunk >500 Ko (environ 3,07 Mo) préexistant.
Lint frontend global non revendiqué.

Reproduction après préparation d'un workdir isolé (config projet/ports B0,
55 migrations copiées, seed vide, aucune config/secrets de la stack habituelle) :

```powershell
supabase start --workdir $b0Dir --exclude studio,postgres-meta,realtime,edge-runtime,logflare,vector,supavisor *> $null
if ($LASTEXITCODE -ne 0) { throw 'Échec du démarrage local B0' }
node tests/database/invoice-history.checks.mjs supabase_db_eventflow-security-b0-20261002
# Toutes tests/database/*.sql via psql ON_ERROR_STOP, sur ce seul conteneur.
node tests/integration/invoice-history.local.mjs $b0Dir
supabase stop --project-id eventflow-security-b0-20261002 --no-backup --workdir $b0Dir
```

Le runner HTTP exige l'identifiant B0 et une URL loopback ; il obtient seulement
les clés **locales synthétiques** par `supabase status`, sans les imprimer.
Les workflows CI et vérification pré-déploiement ajoutent le runner SQL
transactionnel : la fermeture est testée à chaque replay et annulée, jamais
activée implicitement par ces tests.

## Publication en trois phases, sans action effectuée

Le workflow `deploy-environment.yml` applique `db push` **avant** fonctions et
frontend. La révocation ne peut donc pas entrer dans les migrations actives de
la release initiale sans casser le frontend publié.

1. **Route** : déployer d'abord la fonction `invoices` étendue, compatible avec
   l'ancienne route PDF et l'ancien front. Recette autorisée sur fixtures de la
   cible ; aucune révocation dans cette release.
2. **Frontend** : publier le repository migré, vérifier le bundle/commit/cible et
   l'onglet Factures. À cette heure de publication **T**, ouvrir une fenêtre de
   transition explicite **24 heures** pour actualiser les sessions/anciens
   onglets. Prévenir que les anciens bundles devront être rechargés après T+24 h.
   Ce délai est une proposition opératoire bornée à inscrire dans la publication
   autorisée, pas une observation d'adoption des clients ni un déploiement fait.
3. **Fermeture à T+24 h dans une release séparée autorisée** : inventorier la
   cible (PUBLIC/rôles/colonnes/surcharges/vues/GraphQL/policies Storage, bucket
   invoices privé, consommateurs externes). Si une dépendance imprévue empêche
   la fermeture, la traiter explicitement et fixer une nouvelle échéance avant
   de déclarer B0 clôturé ; ne pas supprimer silencieusement la fermeture.
   Créer une **nouvelle migration courante** avec `supabase migration new`, y
   copier exactement le SQL différé revu (ne pas modifier une migration appliquée
   ni insérer son ancien timestamp derrière des migrations déjà publiées), puis
   la placer dans `supabase/migrations` de cette release. Rejouer les tests SQL et
   HTTP avec la fermeture, publier le SQL, confirmer les refus et PDF serveur.
   Le frontend migré est déjà en ligne lorsque ce pipeline applique la migration.

Après fermeture, un ancien onglet peut recevoir un refus et doit recharger ;
aucun fallback frontend vers l'ancienne RPC et aucune réouverture des grants
authenticated pour faire fonctionner l'Edge. Ne pas retirer les autres RLS, ne
pas désactiver globalement la Data API. Le fichier différé reste la référence
testée jusqu'à sa promotion ; adapter son chemin dans les runners lors de cette
promotion pour conserver la preuve.

## Fichiers et limites de revue

Contrat : `shared/schemas/invoice-history.ts`. Backend :
`_shared/organization-access.ts`, `invoices/history.ts`,
`invoices/history-repository.ts`, dispatcher `invoices/index.ts`.
Frontend : repository/hook existants et type de l'item dans `InvoicesTab` ;
`admin.makeInvoiceListArgs.schema.ts` et `db.invoice.schema.ts` devenus inutiles
supprimés, sans nettoyage d'autres domaines.
Tests : `invoice-history-test.ts`, `invoiceHistoryRepo.test.ts`,
`invoiceHistoryHook.test.ts`, `database/b0/invoice-history.sql` et runner,
`integration/invoice-history.local.ts/.mjs`. Fermeture SQL différée et deux
workflows de validation. Rapport et statut du plan actualisés.

Revue principale et revue indépendante selon REVIEW/SECURITY_REVIEW : **PASS
pour le code B0 et les validations locales**, avec fermeture distante non
effectuée conforme à la demande. Le hook historique n'isole pas lui-même les
réponses tardives par session/org ; cette limite préexistante reste distincte
d'A6 et n'est pas présentée comme corrigée par B0. Les tests frontend contrôlent
les hooks, sans recette visuelle/navigateur. Le serveur HTTP local teste le
handler réel, sans attester le runtime Edge hébergé, ses crons, Auth settings ou
les ACL d'une cible publiée. Aucun paiement, e-mail client ou donnée réelle.
