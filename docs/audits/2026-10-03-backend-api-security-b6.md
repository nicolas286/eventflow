# B6 — Frontière Edge et régressions

Travail local sur `dev`, HEAD `4ef53f40c779b7bdbe65f80630a0d37bc7973574`.
Diff A0–B5 préservé ; aucun commit, push, fusion, déploiement ou mutation distante.
GitNexus Eventflow absent : inventaire AST/rg, sources et catalogue SQL local.

## Livré

| Élément | Implémentation / preuve | État de publication |
| --- | --- | --- |
| React et Netlify | Aucun RPC, table ou Realtime métier direct ; scanner AST `scripts/security/check-browser-boundary.mjs`, tests et étapes CI/déploiement | Non publié |
| Exceptions | Auth : liste explicite de huit fichiers ; Storage SDK : liste vide. URLs publiques d’assets, upload Edge et URL PDF signée conservés | Parcours Auth/Storage réels testés |
| Paramètres de paiement | Deux appels serveur avec JWT remplacés par `organizer_accept_organization_sales_terms` / `organizer_update_organization_payment_settings`, acteur Auth explicite et client serveur ; garde membership commune | Migration additive active, Edge non publiée |
| Création administrative | Dernier is_org_member avec JWT retiré ; garde serveur commune depuis événement/org résolu, mêmes rôles owner/admin permis par la contrainte SQL | Non publiée ; tests ciblés et HTTP réels sans RLS |
| Objets futurs | Defaults `postgres` fermés pour navigateur ; `PUBLIC EXECUTE` global retiré, puis ACL public/private/graphql_public. Grants service existants conservés | Replay réussi sous postgres |
| Créateur géré | `managed-creator-defaults.sql`, réservé à supabase_admin ; nouveaux objets des deux créateurs testés | Intervention opérateur différée |
| Accès existants | Fermeture B0–B5 cumulée et B6 : tables/colonnes, vues, séquences, toutes surcharges public/private/graphql_public, wrapper GraphQL et publications métier | Fermés uniquement en base jetable |
| RLS métier | Migration B6 phase 4 séparée ; refuse de commencer si ACL table/colonne/RPC ouvertes ; policies public retirées seulement après fermeture | Livrée/testée, promotion et revue high différées |

Fichiers SQL B6 : migration additive `20261003122216_edge_boundary_defaults.sql`,
fermeture différée `20261003170000_close_remaining_business_browser_access.sql`,
retrait RLS `20261003180000_retire_business_rls.sql`. Aucun historique appliqué
modifié, aucune ligne métier supprimée. RLS Auth/Storage/private conservée.
Inventaire réutilisable sans valeurs : `scripts/security/edge-boundary-inventory.sql`.

Les deux routines de paiement reprennent les dernières définitions du
29 septembre : acceptation 200–10000 caractères, email public, version/snapshot,
acteur et historique ; mise à jour Stripe seulement, virement désactivé, verrou
organisation et IBAN existant préservé. Quotas SQL historiques et quotas Edge
conservés. Aucun remboursement, paiement ou email réel. Entrées read/update
désormais strictes ; acteur et champs système client rejetés. Le DTO reste partagé.

## Preuves locales

- 65 migrations rejouées ; 23 relations et 177 routines public inventoriées avant fermeture. Schémas exposés configurés localement : public et graphql_public ; private n’est pas exposé.
- Douze suites SQL historiques et suites B0–B6 réussies. Vrais rôles anon/authenticated : toutes relations/colonnes, séquences et routines testables refusées ; ACL également vérifiées pour fonctions STRICT/pseudo-types/triggers. Unaccent invoqué avec une valeur non nulle.
- Grants PUBLIC/colonne, vue propriétaire contournant RLS, SECURITY DEFINER oublié et publication métier injectés, puis fermés. Nouveaux objets créés sous postgres et supabase_admin : aucun accès navigateur par défaut. Transactions de preuve annulées.
- Sept recettes réelles Auth/HTTP/PostgREST/Storage B0–B6 passent après fermeture cumulée et retrait de toute RLS public : organisations, événements/produits/formulaires/promos, commandes/export, billets/QR, factures/PDF, catalogue/Netlify et paramètres de paiement. API GraphQL sous anon et JWT utilisateur refusée sans données métier.
- Paramètres de paiement : trois actions, sessions absentes/invalides, A/B, acteur injecté, contrat réponse, quotas SQL épuisés ; acceptation attribuée au vrai acteur. Test unitaire vérifie le bearer service indépendant et p_actor_id.
- Création administrative : sessions absentes/invalides, organisation étrangère, produit d’un autre événement (400 historique), succès nominal gratuit sans prestataire/email et quota réel 429 ; aucun RPC membership utilisateur. 107 tests ciblés création/paiement/quotas réussis.
- Concurrences PostgreSQL B2 (cinq recettes), B3 paiement/expiration/suppression, B4 double scan, confirmations avec lease/fencing et quotas avec douze connexions réussies.
- check:backend, lint:backend (221 fichiers), test:backend (407), npm test (507 Vitest + 19 Node), build et ESLint ciblé réussis. Vite conserve son avertissement de taille de chunk.

Les helpers temporaires de tests SQL reçoivent maintenant EXECUTE explicitement,
dans leurs transactions annulées : retirer PUBLIC EXECUTE global ferme aussi les
fonctions futures hors public. Aucune assertion métier ni permission production
n’a été affaiblie. Le CLI local 2.75.0 a nécessité un redémarrage du Kong jetable
après un reset pour rétablir Storage ; le replay final a terminé normalement.

## Publication et limites à relire

1. SQL additive/defaults postgres → nouvelles Edge → préflights → frontend et Netlify.
2. Attester les consommateurs externes, les créateurs et schémas réellement exposés, l’adoption des versions B0–B5 et la transition B0 de 24 heures.
3. Release distincte des fermetures B0–B5 ; B6 et defaults gérés via un opérateur autorisé pour les objets supabase_admin. Prouver SQL/API les refus sur la cible.
4. Revue high et release distincte du retrait RLS ; refaire les recettes métier et les refus directs. Garder les protections Auth/Storage.

**Blocage de publication isolé :** postgres ne peut pas modifier les defaults de
supabase_admin. La fermeture totale inclut des objets appartenant à ce rôle
(unaccent, GraphQL). Le script B6 refuse avant toute mutation s’il manque le droit
du propriétaire ; ne pas promouvoir ces fichiers avec un simple db push postgres,
ni accorder une membership supplémentaire pour contourner cette limite.
Une intervention du créateur géré reste à faire sur les cibles hébergées.

Sans inspection distante autorisée ici, les éventuels schémas/objets/créateurs
supplémentaires, endpoints déployés, callbacks/crons et consommateurs hors dépôt
ne sont pas attestés. Realtime n’a aucun consommateur métier local et sa publication
est vide ; retrait effectif d’une table de publication injectée prouvé en SQL,
pas de recette WebSocket hébergée. Une publication FOR ALL TABLES supplémentaire
exigerait une adaptation revue ; le script échouerait sans clôture partielle.

Le scanner AST est un garde-fou CI borné, pas une preuve contre du code volontairement
obfusqué. La sécurité repose sur les ACL et l’autorisation Edge testées. Les dettes
métier suppression B3/statuts B4, ingress IP non attesté et contraintes d’export
catalogue B5 restent inchangées. Pas de recette visuelle ni hébergée.

**État : implémenté/testé localement ; accès direct fermé seulement en base jetable ;
fermeture et retrait RLS différés ; intervention gérée et revue high requises ;
non déployé. B6 n’est pas clôturé sur les environnements publiés.**
