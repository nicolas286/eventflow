# Exécution des lots A0–A3 — sécurité backend Eventflow

Date : 2 octobre 2026. Travail local sur `dev`, HEAD `34cde6d621da43edf15fbda550f3ec48f0c7c4b9`, 20 commits derrière `origin/dev`. Aucun pull, commit, push, merge, déploiement ou mutation distante effectué. Les permissions de production observées restent donc inchangées par ce travail.

Plan : `docs/plans/2026-10-02-gitnexus-plan-backend-api-security-audit.md`, uniquement A0 → A1 → A2 → A3. Les changements préexistants de déploiement, documentation, inscription et scripts/tests associés ont été préservés. Aucun fichier applicatif ni ancienne migration modifié. Aucune policy RLS ajoutée, retirée ou désactivée dans les migrations.

Instructions appliquées : AGENTS racine et Supabase, PROJECT, ARCHITECTURE, déploiements/manifeste, SECURITY_REVIEW, OFFENSIVE_TESTING, TESTING et REVIEW. Skills `gitnexus-work` et `supabase`. L'index GitNexus disponible ne comprend pas ce dépôt ; `eventflow-site` est un autre dépôt. Traçage par `rg`, sources, catalogues et tests réels ; aucune preuve de graphe/PDG ou `detect_changes` revendiquée.

## Provenance et environnement de preuve

Le helper `gitnexus-work/scripts/evidence-provenance.mjs read-plan` refuse Windows. Il a été exécuté avec succès dans `node:22-bookworm`, sans réseau, dépôt et skill montés en lecture seule. Le reçu porte le chemin exact du plan et le digest `sha256:5b90ef14702943011a4bcdb2d0b15dea203a10da35ff058fe1930073e1357f7a` ; seuls les octets décodés de ce reçu ont été utilisés.

La vérification `snapshot --schema-version 2` avec les 37 chemins cités donne le digest global initial `189401ba05aa8f348ad890e132112290ebf2d3e46a99e79756ac49747d56401d`, différent du pin du plan. Les digests des fichiers cités n'ont pas changé. Le périmètre a été réancré sur les sources actuelles, le diff préexistant et les migrations, sans modifier le plan ni intégrer les changements préexistants. La consigne utilisateur de rester sur `dev` prime sur la création de branche proposée par le skill.

Base jetable : workdir `%TEMP%/eventflow-security-a0-20261002`, `project_id = eventflow-security-a0-20261002`, conteneur `supabase_db_eventflow-security-a0-20261002`, port PostgreSQL `55322` ; autres ports de configuration décalés vers `553xx`. Migrations copiées depuis ce checkout, seed désactivé, aucun fichier `.local` copié. La stack existante `supabase_db_eventflow-front` sur `54322` n'a pas été arrêtée ou réinitialisée.

Versions utilisées : Supabase CLI `2.75.0`, PostgreSQL local `17.6.1.075`. Le CLI a téléchargé ses images de démarrage puis reconstruit le schéma géré Auth/Storage et les migrations applicatives. Il ne possède pas `db query` ; exécution SQL avec `docker exec ... psql -v ON_ERROR_STOP=1`. Aucun service de paiement ou de mail n'a été appelé par les tests. Toutes les fixtures sont synthétiques et annulées par transaction.

## A0 — Inventaire effectif

Fichiers ajoutés :

- `scripts/deployment/security-a0-inventory.sql` : transaction en lecture seule ; signatures/overloads, `proacl`, owner, SECURITY DEFINER, `search_path`, empreintes de définition, `pg_default_acl`, héritages de rôles, droits effectifs de colonnes, RLS/policies, nombre d'incohérences, dépendants SQL et métadonnées cron. Aucun corps de fonction, commande cron, secret ou valeur métier imprimé.
- `docs/audits/2026-10-02-backend-api-security-remote-metadata.json` : résultats distants de catalogue, sans données clients ; noms des endpoints inventoriés.

### Permissions confirmées avant correction

Les cinq fonctions ont chacune une seule signature ; aucune surcharge supplémentaire trouvée localement, sur staging ou en production.

| RPC | Local reconstitué | Staging | Production |
| --- | --- | --- | --- |
| `admin_grant_subscription(uuid,text,integer,timestamptz)` | exposée anon/authenticated | serveur seulement | exposée anon/authenticated |
| `claim_order_confirmation_email(uuid)` | exposée anon/authenticated | serveur seulement | exposée anon/authenticated |
| `log_email_once(uuid,text)` | exposée anon/authenticated | serveur seulement | exposée anon/authenticated |
| `mark_order_confirmation_email_error(uuid,text)` | exposée anon/authenticated | serveur seulement | exposée anon/authenticated |
| `mark_order_confirmation_email_sent(uuid)` | exposée anon/authenticated | serveur seulement | exposée anon/authenticated |

Pour toutes : PUBLIC n'a plus EXECUTE, `service_role` l'a. En local/production, `proacl` contient encore les grants directs anon/authenticated. Les default ACL de fonctions du schéma public, pour les créateurs `postgres` et `supabase_admin`, accordent EXECUTE à ces rôles. Aucune appartenance supplémentaire des trois rôles n'a été trouvée. La révocation historique de PUBLIC n'enlève pas les grants directs.

`PUBLIC` est le grantee ACL 0, pas un rôle utilisable par `has_function_privilege('PUBLIC', ...)`. Son accès a été vérifié avec `aclexplode(coalesce(proacl, acldefault('f', proowner)))`; les trois rôles SQL ont été vérifiés avec `has_function_privilege`.

Les empreintes `md5(pg_get_functiondef(...))` des cinq définitions sont identiques entre local, staging et production : cela confirme les définitions examinées, indépendamment de leurs ACL. Les fonctions e-mail claim/mark ont `search_path=pg_temp, private, public` ; admin/log ont `search_path=public`. Leurs corps et leurs chemins de recherche ne sont pas modifiés par A1. Cette inspection ne prouve pas une fuite effectivement exploitée : aucune RPC mutante n'a été appelée à distance.

Les FK de formulaires distantes restent simples : `group_id → groups.id ON DELETE SET NULL`. Les rôles authenticated possèdent UPDATE/INSERT au niveau table sur tous les champs produits locaux et distants, dont les compteurs et horodatages. L'UPDATE anon sur produits est déjà refusé ; son TRUNCATE local est encore accordé avant A3.

### Appelants et exploitation

- `orders/public/emails.ts` appelle claim et les deux mark avec le client `admin` ; les orchestrations commandes/Stripe fournissent un client serveur.
- `_shared/services/order-confirmation/db.ts` et `order-reminders/db.ts` appellent `log_email_once` avec `admin`. `workers/index.ts` utilise `serviceClient: true` et l'authentification interne pour les rappels.
- `_shared/app/edge-handler/create-edge-handler.ts` crée ce client via `_shared/modules/supabase-runtime/mod.ts::createServiceClient`, avec la clé serveur et sans reprendre Authorization utilisateur.
- Aucun appel de ces cinq RPC trouvé dans `src`, Netlify ou les scripts opérateur du checkout. Aucun autre corps SQL public/private ni commande cron ne référence leurs noms dans les catalogues inspectés. Cette recherche textuelle ne démontre pas l'absence de SQL dynamique ou de consommateurs externes.
- `admin_grant_subscription` est conservée pour les opérateurs (`postgres`) et les consommateurs serveur (`service_role`). Aucun retrait fondé sur l'absence d'appel frontend.

Cibles distantes vérifiées par `supabase_get_project` et `deploy/environments.json` avant SQL : staging `cpcmcxerrsnnjncrhldr` / `eventflow-staging` (PG `17.6.1.166`), production `dixirvllhfkvqoahhfqh` / `eventflow-prod` (PG `17.6.1.063`). Uniquement `supabase_execute_sql` avec `BEGIN READ ONLY` et SELECT de catalogues ; `supabase_list_edge_functions` pour les endpoints. Aucun token, fichier serveur, commande cron brute, corps Edge distant ou ligne client lu.

Production : neuf endpoints, identiques aux noms locaux. Staging : ces neuf plus `platform-config` et `platform-admin`, absents de ce HEAD. Leurs implémentations et consommateurs ne sont pas attestés par ce checkout ; écart à intégrer avant publication, pas raison de supprimer une RPC opérateur.

Crons actifs observés : expiration toutes les deux minutes (`expire-orders` staging, `expire-orders-direct` production), renouvellements manuels toutes les cinq minutes, rappels (`30 seconds` staging, `0 * * * *` production), exécutés par `postgres`. Le rappel cible `/functions/v1/workers/reminders` dans les deux environnements. Les commandes brutes et headers n'ont pas été lus/affichés. Les callbacks Stripe sont traités par `stripe-webhook-connect` dans les sources ; les inscriptions réellement configurées chez Stripe/Mollie n'ont pas été inspectées.

Validation A0 : `supabase db start --workdir <workdir-jetable>` rejoue les **45 migrations préexistantes**, puis inventaire via psql et cinq suites SQL existantes, toutes réussies. Nombre d'incohérences de formulaires local : 0. Les incohérences de données distantes ne sont pas inventoriées dans cette session ; aucune ligne client n'a été lue. Le comptage est fourni pour un préflight explicitement autorisé avant application d'A2.

## A1 — RPC internes

Fichiers : `supabase/migrations/20261002121507_restrict_sensitive_internal_rpcs.sql`, `tests/database/sensitive-rpc-acl.sql`.

Changement : révocation explicite de tous les droits des cinq signatures pour PUBLIC, anon et authenticated ; EXECUTE accordé à `service_role`. Propriétaire et usages SQL opérateur conservés. Pas de modification de corps, default ACL globales, frontend ou clients backend.

Test avant correction : échec attendu `Unexpected effective ACL on admin_grant_subscription(...)`. Après application locale : PASS. Le test vérifie les cinq signatures et les ACL, puis exécute réellement les cinq appels sous `SET LOCAL ROLE anon` et `authenticated`, identité membre/owner A avec ressources B. Tous doivent lever `insufficient_privilege`; aucune modification d'abonnement/log/état mail n'est constatée. Le booking token ne peut pas être obtenu par le claim refusé.

Sous `service_role`, l'attribution opérateur d'un plan, le claim et son retry, la journalisation idempotente, le marquage erreur puis envoyé fonctionnent ; valeurs et mutations vérifiées. Il s'agit d'un test du consommateur serveur, jamais d'une simulation d'utilisateur ordinaire.

Compatibilité : les appelants locaux utilisent déjà le client serveur. Les endpoints externes de staging n'ont pas été examinés ; tout appel privilégié au JWT utilisateur devra être corrigé côté serveur, sans rouvrir ces grants. Cette migration est une fermeture de permissions production réelle. Les default ACL larges restent à traiter dans B6 ; toute future recréation/surcharge doit être accompagnée de grants explicites et de la mise à jour des tests.

## A2 — Cohérence champ/groupe/événement

Fichiers : `supabase/migrations/20261002121531_enforce_form_group_event_scope.sql`, `tests/database/form-scope-regressions.sql`.

Changement : après verrouillage des deux tables et inventaire des incohérences, ajout de l'unicité `(id,event_id)` sur les groupes et remplacement de la FK simple par `(group_id,event_id) → groups(id,event_id)`, avec `ON DELETE SET NULL (group_id)`. Aucun event_id ou champ n'est effacé à la suppression d'un groupe. La contrainte couvre les écritures directes, les RPC et le serveur, ainsi que le déplacement d'un groupe référencé.

Préflight : une fixture incohérente a été injectée dans une transaction jetable puis le fichier de migration exécuté. Échec explicite `FORM_GROUP_EVENT_SCOPE_INCONSISTENT: 1 fields`, avant tout DDL ou réparation. La fermeture de connexion annule toute la transaction synthétique. Les lignes distantes devront faire l'objet d'un inventaire et d'une décision métier séparée si ce préflight échoue ; aucun nettoyage silencieux prévu.

Test avant correction : le scénario détecte `Cross-event INSERT accepted`. Après migration : PASS. INSERT/UPDATE A/A acceptés ; autre événement de A et événement de B refusés par FK sous authenticated ; modification du event_id du champ ou du groupe refusée ; suppression du groupe conserve le champ, son event_id et sa valeur ; écriture serveur incohérente également refusée. Scénarios réels sur trois événements et deux organisations synthétiques.

Compatibilité : `updateEventFormFieldRepo.ts` écrit toujours directement les mêmes colonnes. Les écritures cohérentes sont conservées ; les incohérences sont désormais refusées en base. La FK composite peut demander un verrou et la création d'un index unique lors d'une future application : aucune application distante réalisée.

## A3 — Colonnes système des produits

Fichiers : `supabase/migrations/20261002121709_protect_product_system_columns.sql`, `tests/database/product-system-columns.sql`.

Inventaire frontend : `createEventProductRepo.ts` utilise `create_event_product(jsonb)` ; `updateEventProductRepo.ts` utilise `update_event_product(jsonb)` puis SELECT ; `deleteEventProductRepo.ts` effectue DELETE. Aucun UPDATE/INSERT direct de produits trouvé dans ce checkout. `admin.createEventProduct.schema.ts` exclut id, createdAt, updatedAt, reservedQty et soldQty.

Changement : suppression des grants INSERT/UPDATE **table**, et de tous les grants INSERT/UPDATE **colonne**, pour PUBLIC/anon/authenticated ; réattribution à authenticated des seules colonnes métier. Fermeture de TRUNCATE sur cette table, qui peut contourner RLS et effacer le stock. SELECT/DELETE et policies existantes conservés.

Le caractère cumulatif des droits table/colonne est décrit dans la [documentation PostgreSQL GRANT](https://www.postgresql.org/docs/17/sql-grant.html) ; les résultats locaux ci-dessous prouvent les droits effectifs de ce schéma.

| Colonnes | INSERT authenticated direct | UPDATE authenticated direct |
| --- | --- | --- |
| `name, description, price_cents, currency, stock_qty, is_active, sort_order, creates_attendees, attendees_per_unit, is_gatekeeper, close_event_when_sold_out` | grant conservé (soumis à RLS existante) | conservé |
| `event_id` | conservé pour créer la relation | refusé |
| `id, created_at, updated_at, reserved_qty, sold_qty` | refusé, valeurs par défaut DB | refusé |

Aucune autorisation utilisateur n'est ajoutée en RLS. Les INSERT directs n'avaient déjà pas de policy les autorisant ; la création frontend reste la RPC existante. Les horodatages sont toujours écrits par la DB/RPC. L'identifiant et le rattachement d'un produit existant ne sont pas des mutations du frontend actuel.

Serveur : `create_order_intent` réserve les unités payantes et vend les gratuites ; `apply_order_payment` convertit réservé en vendu ; `expire_orders`, `expire_bank_transfer_order`, la clôture Stripe et les remboursements libèrent le stock. Les opérations existantes SECURITY DEFINER et les droits serveur sont conservés, sans changement de client ou de corps SQL.

Test avant correction : échec attendu `Broad product mutation privilege remains for anon` (TRUNCATE ; UPDATE/INSERT table sont également encore accordés à authenticated). Après migration : PASS. `has_table_privilege` et `has_column_privilege` vérifient les droits effectifs, puis UPDATE/INSERT des colonnes système et TRUNCATE sont réellement refusés sous anon/authenticated. Owner A ne remet pas les compteurs à zéro ; l'édition métier directe de A réussit et celle de B touche zéro ligne. Les RPC frontend création/modification, la lecture et la suppression restent fonctionnelles.

Achats synthétiques : réservation payante, paiement, remboursement répété sans double libération, expiration répétée sans double libération, achat gratuit ; compteurs exacts vérifiés à chaque transition. Les suites existantes couvrent aussi expiration virement, remboursements partiel/complet, Stripe Checkout et retries. Aucun paiement prestataire réel ni mail envoyé. Le parcours historique `create_order_intent` refuse un achat sans participant avec `p_new_attendees must be > 0` ; les fixtures ont été corrigées pour respecter ce contrat, sans changer cette règle hors périmètre.

Limite : les validations métier des colonnes éditables restent celles des RPC/policies existantes ; A3 ferme les colonnes système et ne réalise pas B2. Le frontend réellement publié n'a pas été inspecté ; compatibilité prouvée pour les consommateurs du HEAD examiné. Les autres consommateurs doivent être rapprochés de cette allowlist avant publication.

## Commandes et résultats finaux

Toutes les commandes ci-dessous ciblent le workdir/containeur jetable, jamais le projet CLI historiquement lié ni la stack existante.

```powershell
$auditDir = Join-Path $env:TEMP 'eventflow-security-a0-20261002'
$dbName = 'supabase_db_eventflow-security-a0-20261002'
# Après création d'un workdir isolé, copie des migrations/config,
# project_id distinct, ports 553xx et seed désactivé :
supabase db start --workdir $auditDir
# Validation distincte A1, puis A2, puis A3 :
Get-Content -Raw <nouvelle-migration-du-lot.sql> |
  docker exec -i $dbName psql -U postgres -d postgres -v ON_ERROR_STOP=1
Get-Content -Raw <test-du-lot.sql> |
  docker exec -i $dbName psql -U postgres -d postgres -v ON_ERROR_STOP=1
# Replay final des 48 migrations, dont les trois nouvelles :
Copy-Item supabase/migrations/20261002*.sql "$auditDir/supabase/migrations"
supabase db reset --local --no-seed --workdir $auditDir
foreach ($test in Get-ChildItem tests/database/*.sql | Sort-Object Name) {
  Get-Content -Raw $test.FullName |
    docker exec -i $dbName psql -U postgres -d postgres -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "FAIL $($test.Name)" }
}
Get-Content -Raw scripts/deployment/security-a0-inventory.sql |
  docker exec -i $dbName psql -U postgres -d postgres -v ON_ERROR_STOP=1
git diff --check
# Nettoyage final exclusivement de la base d'audit :
supabase stop --project-id eventflow-security-a0-20261002 --no-backup --workdir $auditDir
```

Replay final : **48/48 migrations réussies**. Suites : **8/8 réussies** (`baseline`, `sensitive-rpc-acl`, `form-scope-regressions`, `product-system-columns`, `payment-delivery-regressions`, `stripe-checkout-regressions`, `stripe-webhook-retries`, `subscription-renewal-regressions`). Inventaire final : cinq RPC serveur seulement, colonnes système refusées, incohérences locales 0. Les tests nouveaux sont automatiquement inclus par la boucle `tests/database/*.sql` des workflows existants ; aucun changement CI nécessaire.

Les premières exécutions des fixtures ont révélé des erreurs de montage de test (token trop court, alias PL/pgSQL ambigu, kind e-mail incorrect, événement sans date future, achat sans participant). Elles ont été corrigées pour respecter les contrats existants ; aucune assertion affaiblie ni règle métier modifiée. Les échecs avant correctif documentés ci-dessus ont été observés après ces corrections de fixtures.

`git diff --check` réussi. Notices SQL sur contraintes/triggers absents historiques et table temporaire d'allocation déjà présente : attendues. Warning CLI seed sans fichier : aucun seed de données lancé. Message `db reset on branch main` : branche interne du workdir temporaire ; le checkout Eventflow est resté sur `dev`. Avertissement de mise à jour CLI : aucun outil ni dépendance du projet mis à jour.

Contrôles applicatifs non relancés : aucun code frontend, Edge, contrat TypeScript ou package modifié. Un build ou un mock applicatif n'aurait pas prouvé ces permissions SQL. Aucune recette navigateur, charge concurrente, appel HTTP Data API ou prestataire réel revendiqué.

Nettoyage : conteneur et volumes jetables arrêtés/supprimés sans backup par la commande ciblée ci-dessus. Les onze conteneurs de la stack Eventflow préexistante sont restés actifs. Le workdir temporaire et les logs synthétiques peuvent servir à reproduire les vérifications ; aucun secret distant n'y a été copié.

## Revue et travaux restants

Revue locale du diff A0–A3 : **PASS** pour migrations, permissions et scénarios SQL exécutés. Les nouveaux fichiers sont non commités ; HEAD et changements préexistants conservés. La preuve de refus repose sur les grants effectifs et de vrais rôles SQL, sans utiliser service_role comme utilisateur.

**Validation distante d'application et résolution production : non réalisées.** L'exposition EXECUTE production est confirmée par catalogue ; elle demeure tant qu'A1 n'est pas appliquée dans une publication autorisée. Aucun incident d'exploitation n'est attesté. Les données distantes de formulaires peuvent bloquer A2 : préflight et décision métier requis, sans réparation automatique. Rapprocher les consommateurs de staging plus récents et le front publié de ce HEAD avant intégration.

Hors périmètre conservé : migration générale Edge, retrait RLS, default ACL globales/B6, framework d'autorisation, nettoyage Mollie, frontend global et A4+. Les ACL par défaut larges, le `search_path` historique et les éventuels consommateurs externes restent documentés, sans élargissement des correctifs.

**Aucun déploiement effectué. Aucune mutation distante effectuée.**
