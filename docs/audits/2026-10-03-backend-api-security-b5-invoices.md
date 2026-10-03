# B5.1 — Factures

Travail local sur `dev`, HEAD `4ef53f40c779b7bdbe65f80630a0d37bc7973574`.
Diff préexistant conservé ; aucun commit, PR distante, push, fusion ou déploiement.
Changement à relire/publier séparément du catalogue B5.2.

## Livré et réutilisé

L’historique demandé par B5 avait déjà été livré en B0 : repository frontend
`makeInvoiceListRepo.ts` → `invoices/list`, DTO `shared/schemas/invoice-history.ts`,
service client, membership owner/admin, quota user/org 120/min, pagination SQL
bornée à 100 et curseur issued_at/id avec NULLS LAST et précision DB préservée.
Pas de réimplémentation ni de nouvelle migration factures. Historique Mollie,
montants, références et statut inchangés ; aucune donnée supprimée.

La route PDF encore protégée par `is_org_member` via le client utilisateur utilise
désormais `assertOrganizationManager(serviceClient, orgId, actorId)` : acteur de
la session Auth vérifiée, membership minimal explicitement filtré, JWT utilisateur
jamais repris par le client privilégié. Génération PDF, bucket privé et lien signé
120 secondes inchangés ; quota existant 60/min après autorisation, avant génération
ou signature. Aucun prestataire ni e-mail réel appelé dans les recettes.

| Route | Autorisation | Lecture/effet serveur | Ancien accès |
| --- | --- | --- | --- |
| POST invoices/list | Auth + owner/admin sur org ; curseur vérifié dans cet org | SELECT explicite, tri/filtre/limite SQL ; DTO public de l’historique administratif | rpc_list_invoices + table/colonnes/Storage : fermeture B0 réutilisée |
| GET invoices/:id/pdf | Auth ; facture → org ; contrôle central owner/admin avec client serveur | Métadonnées minimales ; quota ; générateur existant si nécessaire ; signature privée TTL 120 s | Plus de dépendance Edge au RPC navigateur is_org_member ; aucun nouvel EXECUTE authenticated |

Fichiers modifiés dans ce sous-lot : `supabase/functions/invoices/index.ts`,
`repository.ts`, extension de `tests/integration/invoice-history.local.ts` et
nouveau runner strictement isolé `invoices-b5.local.mjs`. Historique/cache frontend
B0 conservés. Le préflight partagé vérifie maintenant aussi `invoices/list`.

## Preuves et limites

- SQL B0 avec vrais anon/authenticated/service_role : RPC, table/colonnes refusés avec et sans RLS, grants PUBLIC/colonnes injectés puis fermés.
- Recette réelle Auth/PostgREST/Storage sur la seule base jetable B5 : utilisateurs A/B/admin, pagination/date NULL, curseur étranger/invalide, sessions invalides et quota historique.
- PDF propre signé et téléchargé ; PDF étranger refusé ; anonyme/session invalide refusés ; budget PDF réellement épuisé → 429. Ancienne RPC de membership révoquée dans la base jetable : liste et PDF restent fonctionnels.
- Téléchargement, listing et signature Storage navigateur refusés. Fixtures privées synthétiques supprimées ; aucun fichier personnel public permanent ajouté.
- Validation commune B5 : 64 migrations, 12 suites SQL historiques, suites/ACL B0–B5, concurrence B3/B4 ; check/lint backend (234 fichiers), 413 tests backend, 514 Vitest + 16 Node, build et ESLint ciblé réussis. Avertissement Vite de taille de chunk préexistant.
- Pas de recette staging ni de nouvelle génération de facture financière réelle. Les erreurs/génération du PDF restent couvertes par les tests existants. Index GitNexus Eventflow absent ; sources/SQL/tests utilisés.

## Fermeture et publication

Réutiliser exactement la fermeture différée B0
`20261002213326_close_invoice_history_browser_access.sql`, déjà livrée/testée.
Ne pas promouvoir cette révocation avec la release initiale : le pipeline applique
SQL avant Edge/frontend. **Edge/history/PDF et frontend B0 publiés → préflight →
transition B0 de 24 h avec échéance → release distincte de fermeture**. Confirmer
les clients externes hors dépôt et anciens onglets avant promotion. Le helper
général `is_org_member` n’est pas fermé globalement par B5 : autres domaines à
inventorier en B6 ; sa révocation locale sert seulement de preuve d’indépendance.

**État : implémenté/réutilisé et testé localement ; ancien accès fermé uniquement
en base jetable ; fermeture différée B0 livrée ; non déployé.**
