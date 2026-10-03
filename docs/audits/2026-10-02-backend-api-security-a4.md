# A4 — Réponse après paiement administratif partiel

Implémenté et testé localement le 2 octobre 2026, sur `dev`, HEAD initial `4ef53f40c779b7bdbe65f80630a0d37bc7973574`. Aucun commit, push, merge, déploiement, accès métier distant, paiement prestataire ou e-mail client. Les changements locaux préexistants et les travaux apparus en parallèle sont préservés. A0–A3 et les autres lots ne sont pas réimplémentés.

## Changement observable de l'API

`POST /orders/admin`, après paiement offline, retourne désormais l'état de `apply_order_payment` validé, au lieu de forcer `paid`. Les logs de fin reflètent également cet état. `payment` conserve le résultat RPC brut, après validation ; le total est lu dans ce résultat et vérifié contre la création. La devise et les arguments de paiement restent ceux du parcours existant.

| Commande | Versement | Échéance initiale SQL | État | `dueNowCents` après versement | Solde total, pour comparaison |
| --- | --- | --- | --- | --- | --- |
| 100 € sans acompte | custom 10 € | 100 € | `partially_paid` | 9000 | 90 € |
| 100 € avec acompte | intégral 100 € | 20 € | `paid` | 0 | 0 € |
| 100 € avec acompte | acompte 20 € | 20 € | `partially_paid` | 0 | 80 € |
| 100 € avec acompte | custom 10 € | 20 € | `partially_paid` | 1000 | 90 € |

`dueNowCents` désigne la part impayée de l'échéance initiale, et ne constitue pas un nouveau champ de solde total. Source fiable : `create_order_intent.amount_due_now_cents`, qui correspond au snapshot d'acompte stocké. Le handler valide cette source avant le paiement, puis calcule `max(0, min(échéance initiale, total effectif SQL) - cumul payé SQL)`. Aucun montant d'acompte n'est relu dans la configuration modifiable de l'événement.

Une erreur RPC conserve `400 APPLY_ORDER_PAYMENT_FAILED`. Une réponse incohérente, manquante, sans succès explicite ou portant une autre commande retourne `500 APPLY_ORDER_PAYMENT_INVALID_RESULT`. L'échéance absente/invalide retourne `500 ORDER_PAYMENT_REQUIREMENT_INVALID` avant `apply_order_payment`. Aucun état de succès de remplacement. Une réponse invalide après l'appel ne prouve pas que le paiement SQL n'a pas été persisté : aucune compensation/retry automatique ajoutée.

Le schéma partagé contrôle les nombres entiers non négatifs, l'identité, `ok`, l'état, l'idempotence, la cohérence total/remise/total effectif/cumul payé et leur cohérence avec l'état. Le cas RPC `idempotent:true` renvoie un montant nouvellement appliqué de zéro. Les chemins gratuits et sans paiement manuel sont inchangés.

## Revalidation des sources et consommateurs

- Dernière définition trouvée : `supabase/migrations/20260629090759_apply_order_payment_alignment_for_promocodes.sql`, après la définition historique de `20260324133258_remote_schema.sql`. Les migrations suivantes appellent la fonction ou modifient ses droits, sans remplacer son corps.
- Contrat JSONB réel : `ok`, `order_id`, `paid_cents`, `total_cents`, `discount_cents`, `effective_total_cents`, `status`, `idempotent`. Aucune devise ni échéance dans ce retour ; devise issue du parcours existant, échéance issue de la création SQL. `paid_cents` est un cumul plafonné au total effectif, pas nécessairement le dernier versement.
- `create_order_intent` dans `20260629063112_promo_codes_implementation.sql` calcule l'échéance sur le total remisé, plafonnée par `deposit_cents` si positif, et la stocke dans `deposit_due_cents_snapshot`.
- Lecture réelle par `pg_get_functiondef` dans PostgreSQL local : corps conforme à la définition versionnée ; empreinte MD5 dans la base A4 reconstruite : `bd9896cf6eadb09d78ffa849edb88732`.
- Frontend tracé : `adminRegisterRepo.ts` parse le schéma partagé, `useAdminRegister.ts` transmet le résultat, `AdminCreateOrderWizardPanel.tsx:269` utilise `res.status` dans `onCreated`. Le contrat de succès impose déjà cet état ; son fallback historique n'est donc pas utilisé pour un succès valide. Les modèles et la liste acceptent `partially_paid`. Aucun consommateur de `dueNowCents` trouvé dans le parcours administratif de création. Pas de modification UI nécessaire ; aucune recette visuelle navigateur effectuée.
- Aucun changement aux règles SQL de paiement/acompte, au plafond du versement, aux contrôles de devise ou d'autorisation, au stock, à la confirmation des participants, aux billets ou aux e-mails. Les tests SQL constatent le comportement existant : le premier paiement confirme les participants et convertit le stock réservé en vendu ; `apply_order_payment` seul n'émet pas les billets.
- Aucun index GitNexus Eventflow disponible dans `list_repos`. Aucun graphe d'un autre dépôt utilisé comme preuve ; traçage `rg`, lectures de sources et tests à la place.

## Preuves de test

Tests HTTP **mockés** : `orders-admin-payment-test.ts` invoque le vrai routeur `handleOrdersRequest`, donc le vrai handler, l'authentification et la validation des contrats. Seul le transport `fetch` de Supabase est simulé ; aucun algorithme de paiement SQL n'est recopié dans les mocks. Les JSONB attendus sont fixés puis vérifiés séparément contre PostgreSQL.

Avant correctif, 5 tests passent et 11 échouent sur 16 : notamment paiement custom, acompte, résultats invalides et échéance absente. Après correctif et ajout des cas total divergent/replay SQL, **18/18 passent**. Assertions sur réponse HTTP, montants, devise, paramètres RPC, absence d'appel paiement dans les chemins sans paiement et gratuit, erreur SQL, résultat invalide et répétition HTTP.

Tests **DB réels** : `tests/database/admin-payment-response.sql` appelle `create_order_intent` et `apply_order_payment` avec le rôle `service_role`, compare le JSONB complet aux attentes HTTP et l'état aux lignes persistées. Les quatre scénarios du tableau passent ; devise USD refusée ; replay de la même référence renvoie `idempotent:true`, conserve le cumul, un seul paiement et le stock ; création gratuite inchangée. Toutes les fixtures sont synthétiques dans `BEGIN`/`ROLLBACK`.

Base jetable dédiée : `%TEMP%/eventflow-security-a4-20261002`, projet/conteneur `eventflow-security-a4-20261002` / `supabase_db_eventflow-security-a4-20261002`, port `58322`, seed désactivé. **55 migrations** du checkout copiées et appliquées, jusqu'à `20261002124005` inclus (fichier d'un travail parallèle, non modifié par A4). La stack habituelle sur 54322, trop ancienne pour le schéma actuel, n'a pas été réinitialisée. Le port tenté 56322 était occupé par une autre stack ; celle-ci n'a pas été arrêtée. Après rollback, zéro organisation fixture A4. Seule la base jetable A4 a été arrêtée, volumes conservés. Supabase CLI local 2.75.0 ; aucune mise à jour de dépendance.

| Commande | Résultat |
| --- | --- |
| `deno test --config supabase/functions/deno.json --allow-env supabase/functions/tests/orders-admin-payment-test.ts` | PASS, 18 tests HTTP mockés |
| `supabase db start --workdir "$env:TEMP/eventflow-security-a4-20261002"` | PASS, reconstruction locale, 55 migrations |
| `Get-Content -Raw tests/database/admin-payment-response.sql \| docker exec -i supabase_db_eventflow-security-a4-20261002 psql -U postgres -d postgres -v ON_ERROR_STOP=1` | PASS, DO puis ROLLBACK ; résultats réels du tableau |
| `npm run check:backend` | PASS après correction d'une incompatibilité de typage dans l'assertion du nouveau test |
| `npm run lint:backend` | Premier passage PASS (183 fichiers) ; dernier passage FAIL (187 fichiers), import `assertFunctionsUrl` inutilisé dans `orders/public/config.ts:2`, travail parallèle hors A4 |
| `deno lint --config supabase/functions/deno.json supabase/functions/orders/admin/handler.ts supabase/functions/tests/orders-admin-payment-test.ts shared/schemas/orders-admin.ts` | PASS, 3 fichiers A4 |
| `npm run test:backend` | PASS, dernier passage 187 tests, dont les 18 A4 ; le nombre inclut les tests ajoutés en parallèle |
| `npm test` | PASS, dernier passage 123 tests Vitest / 21 fichiers, 16 tests Node |
| `npm run build` | PASS ; avertissement de bundles supérieurs à 500 kB |
| `git diff --check -- shared/schemas/orders-admin.ts supabase/functions/orders/admin/handler.ts` | PASS |

Le changelog Markdown Supabase demandé par le skill n'a pas pu être rendu par le navigateur (`Unsupported content-type`). Aucun nouveau mécanisme Supabase introduit ; le contrat est vérifié contre le SQL versionné et PostgreSQL local.

## Fichiers du lot et revue finale

1. `supabase/functions/orders/admin/handler.ts` : résultat paiement et échéance validés, réponse et log fidèles.
2. `shared/schemas/orders-admin.ts` : schéma RPC, définition explicite du champ d'échéance ; forme publique de réponse conservée.
3. `supabase/functions/tests/orders-admin-payment-test.ts` : tests de réponse du handler réel, transport mocké.
4. `tests/database/admin-payment-response.sql` : preuve du contrat SQL réel, fixtures annulées.
5. `docs/plans/2026-10-02-gitnexus-plan-backend-api-security-audit.md` : statut A4 local et lien vers les preuves uniquement.
6. Le présent compte rendu.

Revue du diff A4 : **PASS dans le périmètre**, aucune ancienne migration modifiée, pas de `any`, cast ou suppression de lint ajouté. **Validation globale limitée** par le lint du fichier parallèle cité ; ne pas annoncer tout le workspace exempt de défauts. Le frontend est compatible avec la réponse modifiée, y compris pendant une publication séparée. Aucun déploiement effectué ni résolution métier distante confirmée.

## Défaut distinct documenté, hors A4

L'idempotence HTTP administrative reste absente : `idempotencyKey` est accepté dans le payload mais ignoré ; chaque appel crée un nouvel intent et une référence `offline:<UUID>` aléatoire. Le test HTTP répète le même payload/la même clé, constate deux créations et deux références différentes. Le replay SQL, lui, est idempotent pour une même référence. A4 ne remédie pas à cette limite et ne la dégrade pas. Toute correction nécessite un lot séparé et des règles de reprise après paiement SQL persisté mais réponse perdue/invalide.
