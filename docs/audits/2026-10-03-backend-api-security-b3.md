# B3 — Commandes et participants via orders

3 octobre 2026, branche `dev`, HEAD `4ef53f40c779b7bdbe65f80630a0d37bc7973574`.
Changements préexistants B0–B2 conservés. Aucun commit, push, fusion,
déploiement, paiement, e-mail ou appel Supabase distant. Eventflow absent de
`GitNexus list_repos` : traçage des sources, migrations et catalogue local.

**B3.1–B3.5 implémentés et testés localement. Fermeture livrée/testée et différée ;
aucun accès publié fermé, aucun déploiement. Règle métier de suppression à faire
relire : sa validité n'est pas confirmée par les tests de migration.**

## Routes et frontière

Toutes les routes sont `POST orders/admin/<route>`. `createEdgeHandler` vérifie
le bearer via Auth ; `assertOrganizationManager` vérifie owner/admin depuis la
base, sans utiliser metadata ou acteur fourni. Le client privilégié indépendant
ne reprend pas le JWT utilisateur. Résolution minimale événement/commande/
participant puis vérification de la chaîne ; un scope client incohérent est refusé.
Quotas A8 user+org 240 lectures/minute et 120 écritures/minute après autorisation,
avant lecture métier/transaction ; panne 503, dépassement 429/Retry-After.

Dans la matrice, `fermeture` signifie toutes surcharges de l'ancienne RPC,
PUBLIC/anon/authenticated révoqués dans la migration différée B3, EXECUTE serveur
conservé. Les nouvelles RPC `organizer_*` sont service-only dès la migration active.

| Route | Autorisation avant données/effets | SQL atomique ou lecture paginée | Ancien accès |
| --- | --- | --- | --- |
| list | événement → organisation → membership | organizer_get_event_admin_orders_view | get_event_admin_orders_view : fermeture |
| search | idem | organizer_search_event_admin_orders_view | search_event_admin_orders_view : fermeture |
| tickets-search | idem, joins ticket/commande/item/produit cohérents | organizer_search_event_admin_tickets_view | search_event_admin_tickets_view : fermeture |
| participants-export | événement autorisé à chaque page | organizer_get_event_admin_participants_export_data | get_event_admin_participants_export_data : fermeture |
| participant-update | participant → commande → événement/org + rôle | organizer_admin_update_order_attendee ; verrous commande puis participant, upsert/delete réponses | admin_update_order_attendee : fermeture |
| delete | commande → événement/org + rôle | organizer_admin_delete_order ; verrou commande, stock, DELETE/cascades | admin_delete_order : fermeture |
| bank-summaries | événement → organisation → membership | organizer_get_bank_transfer_admin_summaries | get_bank_transfer_admin_summaries : fermeture |
| bank-expire | commande → événement/org + rôle | organizer_expire_bank_transfer_order ; verrou commande, stock/participants/paiement/état | expire_bank_transfer_order : fermeture |

SQL vérifie à nouveau l'association événement/org et les commandes legacy
incohérentes ; mutations avec acteur Auth explicite et membership SQL, références
produits étrangères refusées. Aucune dépendance à `auth.uid()` dans le nouveau
chemin, aucun JWT injecté en SQL, aucun endpoint table/RPC générique.

## Contrats, frontend et consommateurs

- `shared/schemas/orders-management{,-data}.ts` : entrées/réponses ;
  `supabase/functions/orders/admin/management.ts` et dispatcher `orders/index.ts`.
- Sept repositories existants de `src/app/modules/admin/orders/data` migrés,
  couvrant les huit RPC (list/expire virement partagent un repository). Les hooks
  liste/recherche, modification, suppression et virement reprennent les gardes de
  session/scope/génération A6/B2. Réponses tardives ignorées ; données et saisie
  restent visibles pendant refresh/refus du même scope, erreurs affichées.
- `SingleEventParticipantsSection`, `SingleEventOrdersSubSection` et helper XLSX :
  scope de téléchargement, révision de l'éditeur ; aucun fallback RPC.
- Migration active `20261003120000_orders_admin_edge.sql` ; fermeture dans
  `supabase/deferred-migrations/b3/20261003130000_close_orders_browser_access.sql`.
  CI et vérification SQL pré-déploiement ajoutent les deux runners B3 ; préflight
  backend exige `orders/admin/list` refusé sans Auth avant publication du front.

Inventaire par recherche dans frontend, Edge, scripts et Netlify : anciens appels
uniquement dans ces repositories ; aucun appel serveur/externe versionné restant.
Les nouvelles routines reprennent les dernières définitions : vue commandes avec
promotions du 29 juin ; recherches, export, modification et suppression du schéma
initial ; résumés/expiration du 29 septembre. Catalogue du replay : huit signatures
anciennes, aucune vue/matérialisation dépendant des six tables fermées.
Les consommateurs hors dépôt et les écarts distants restent à inventorier avant
une publication autorisée, sans nouvelle inspection distante dans ce lot.

Listes/recherches : SQL conserve filtres, tri créé/ID décroissant, totaux, offset
et formes ; limite 1–1000, offset 0–10 000 000, recherche ≤500 caractères.
Pas de filtrage/pagination serveur en JS. Les lignes DB sont projetées seulement
sur les colonnes déclarées ; réponses métier JSON jamais renommées récursivement.

Export : 1–100 commandes par page SQL, enfants associés à ces commandes,
clé UUID immuable croissante, borne supérieure et timestamp initial précis dans
le curseur, créations ultérieures exclues. Le repository rassemble toutes les
pages ; aucun arrêt silencieux à 1000 lignes Data API. Curseur étranger/supprimé
refusé, curseur qui n'avance pas rejeté côté client. Le filtre confirmedOnly,
colonnes, valeurs, types et tri XLSX existants sont conservés. ExcelJS écrit les
chaînes utilisateur comme cellules texte, y compris `=`, `+`, `-`, `@` et tabulation ;
preuve par relecture du vrai XLSX. Téléchargement Blob local révoqué, aucun fichier
public permanent. Les groupes enfants gardent leur taille métier : une page peut
contenir plusieurs participants/réponses par commande ; aucun enfant tronqué.
Ce n'est pas un snapshot MVCC entre requêtes : suppressions ou modifications
concurrentes peuvent retirer/modifier des lignes ; export à relancer si curseur
supprimé. Le test de complétude porte sur un jeu stable de 1005 commandes.

Modification : seuls `answers` et les identifiants/valeurs déclarés sont acceptés,
maximum 200 réponses/64 Kio ; prix/statut/rattachement et champs inconnus refusés.
Les anciens email/phone/firstName/lastName étaient ignorés par SQL : désormais
rejetés explicitement, aucun consommateur réel ne les envoie. ID et clé de champ
fournis ensemble doivent désigner le même champ actif de l'événement. JSON `value`
transmis/storé inchangé ; les wrappers vides connus continuent d'effacer la réponse.
Les autres JSON non vides sont conservés au lieu d'être assimilés à un effacement.
Les lectures gardent le rendu historique des réponses en chaînes.

## Suppression et expiration : points à relire

Suppression : classification **historique conservée** `paid/confirmed` → sold,
tous autres statuts → reserved ; quantités des order_items, décrément saturé à zéro.
La fonction ne comporte aucune interdiction métier par statut. Une commande absente
ou déjà supprimée donne NOT_FOUND/404 ; pas de second effet. DELETE et contraintes
restent dans une seule transaction ; erreur injectée après stock = rollback complet.
Cascades : items, participants/réponses, tickets, paiements, journaux d'e-mails,
redemptions promotionnelles, instructions virements et états privés de livraison/
checkout liés à la commande. Le compteur used_count des promotions n'est pas
réinitialisé. Aucun appel de remboursement prestataire et aucun historique financier
durable nouveau : paiements/historiques locaux disparaissent comme auparavant.

**Risque métier existant, non corrigé par supposition :** supprimer une commande
déjà expirée peut décrémenter une seconde fois reserved_qty et affecter les autres
réservations ; partially_paid peut avoir du stock vendu depuis le premier paiement
alors que la suppression choisit reserved. Cette classification et l'effacement de
l'historique d'une commande payée demandent une décision métier avant publication.
La migration conserve le comportement ; elle ne prouve pas sa pertinence financière.

Expiration : conserve marqueur offline/bank_transfer, membership, états
open/pending/awaiting_payment, paid_cents=0 ; répétition expired idempotente sans
stock libéré. Commande verrouillée comme apply_order_payment ; paiement premier →
expiration refusée, expiration première → paiement SQL refusé ORDER_NOT_PAYABLE.
Paiement déjà acquis ne passe pas expired, aucune double libération. Pas de
modification Stripe, webhook, worker, ni remboursement automatique ajouté.

## Fermeture et publication

Migration différée : huit RPC anciennes/toutes surcharges et grants table **et
colonne** sur orders, order_items, order_attendees, order_attendee_answers, payments,
tickets (y compris RETURNING via writes/TRUNCATE). Aucune policy/RLS retirée.
`get_event_tickets_admin`, `mark_ticket_checked_in`, `mark_ticket_checked_in_by_qr`
restent B4, ainsi que leurs contrôles SQL ; recherche seule est B3. Le domaine
billets complet n'est donc pas Edge-only. Les parcours publics par booking token,
création, paiement, confirmation et workers gardent leurs droits serveur.

Ordre obligatoire : **SQL additive → Edge orders → préflight → frontend → fenêtre
de transition B0 de 24 h avec échéance inscrite → nouvelle release promouvant la
fermeture**. Revalider clients externes, vieux onglets/caches, dépendances B4 et
absence de nouvelles vues/surcharges avant promotion. Le pipeline SQL avant front
interdit de placer la révocation dans la release initiale. Aucune fermeture publiée
ni retrait de RLS attesté ; aucune publication réalisée dans B3.

## Preuves locales et limites

Stack dédiée `eventflow-security-b3-20261003`, ports 563xx, PostgreSQL 17/CLI 2.75.0 ;
fixtures synthétiques, stack habituelle intacte. Replay frais des **62 migrations**.
Les suites SQL ordinaires sont exécutées avant fermeture ; les fermetures sont
testées en transactions annulées, puis commises uniquement pour la recette HTTP
dans la base jetable, avec RLS métier désactivée et réactivée en finally.

| Validation | Résultat |
| --- | --- |
| 12 suites SQL existantes + 7 suites B1/B2 | Réussies sur replay frais |
| ACL B0/B1/B2 et deux suites B3 | Réussies ; vrais anon/authenticated/service_role, grants PUBLIC/colonnes injectés, refus avec/sans RLS, aucune vue équivalente |
| Quatre scénarios PostgreSQL concurrents B3 | Réussis ; attente de verrou réellement constatée, paiement/expiration dans les deux ordres, répétition expiration/suppression |
| Recette Auth/HTTP/PostgREST réelle | Réussie : huit familles, A/A, A/B, owner/admin, scopes incohérents, payload système, invalid session, quotas, anciens accès fermés ; 1005 commandes/participants sur 11 pages sans doublon ni fuite |
| Tests ciblés | 9 Deno et 12 Vitest réussis ; contrats, service headers, JSON, refus, absence de fallback, scopes tardifs, XLSX texte |
| check:backend / lint:backend / test:backend | Réussis ; 405 tests Deno |
| npm test / npm run build | Réussis ; 498 Vitest + 16 Node ; TypeScript/Vite |
| Lint frontend/outillage ciblé et diff --check | Réussis |

Recettes : `node tests/database/orders-management.checks.mjs <conteneur jetable>`,
`node tests/database/b3/orders-concurrency.checks.mjs <conteneur jetable>`,
`node tests/integration/orders-management.local.mjs <workdir B3>`.
Les deux runners SQL refusent les stacks normales sauf CI GitHub explicitement
vérifiée avec `--ci`. Stack B3 arrêtée avec `--no-backup` après validation.
Pas de recette visuelle navigateur ni gateway Edge publiée. Avertissement Vite
préexistant de chunk >500 Ko ; aucun lint frontend global revendiqué.

Revue du diff B3 : protections techniques testées ; **validation métier de la
suppression non confirmée**. Faire relire suppression/cascades/historique,
expiration/verrous/concurrence et portée/ordre des révocations avant publication.
