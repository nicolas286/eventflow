# TODO — Refactoring progressif

**Statut : plan de travail, pas de refactoring lancé par la mise à jour documentaire.**

## 1. Établir les contrats existants

- [ ] Indexer Eventflow avec GitNexus si disponible, puis tracer les flux réels. Ne pas réutiliser le graphe de Nexora comme preuve.
- [ ] Compléter les tests de caractérisation : édition événement, formulaire, participants, commande gratuite/payante, webhook et scan.
- [ ] Inventorier les contrats Zod dupliqués, versions frontend/backend, RPC et grants associés.
- [ ] Distinguer bugs existants, changements métier souhaités et simples extractions.

## 2. Première tranche frontend à définir

- [ ] Examiner `EventRegistrationFormPanel.tsx` et `AttendeeEditorPanel.tsx` dans `src/app/modules/admin/singleEvent/components`.
- [ ] Extraire progressivement validation/mapping et orchestration d'état des composants, avec tests de sauvegarde, annulation et erreurs.
- [ ] Conserver les chemins, contrats publics, styles et comportements pendant la première extraction.
- [ ] Réutiliser les composants de `shared/ui` avant toute généralisation.

## 3. Frontières backend

- [ ] Caractériser puis mutualiser les trois implémentations de renouvellement Mollie ; conserver callback, rotation et chiffrement des jetons.
- [ ] Examiner concurrence des renouvellements, idempotence des webhooks et commande laissée en attente après un refus prestataire.
- [ ] Améliorer le diagnostic des erreurs OAuth avec statut/code sûrs, sans secrets.
- [ ] Réduire les handlers volumineux en séparant transport, autorisation, orchestration et données.

## 4. Décisions à prendre, pas à appliquer implicitement

- Couche de requêtes/cache commune ; ne pas introduire TanStack Query sans décision.
- Contrats partagés compatibles Node/Deno et versions Zod.
- Consolidation des styles/tokens ; pas de conversion globale en CSS Modules.
- Internationalisation éventuelle ; aucun engagement FR/NL hérité automatiquement de Nexora.
- Réduction des alias historiques, dont `@contracts` sans dossier cible actuel.

Chaque tranche doit préciser les fichiers touchés, les contrats préservés, les tests, la recette staging et l'effet possible en production. Références : [architecture](../ARCHITECTURE.md) et [revue](../agents/REVIEW.md).
