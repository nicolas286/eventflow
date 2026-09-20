# TODO — Refactoring progressif

**Statut : réorganisation backend implémentée dans les sources dev ; bascule et recette staging à confirmer. Frontend différé.**

**Priorité révisée le 20 septembre 2026 : [migration backend par domaine](backend.md) avant le frontend.** Contrats racine `shared/schemas`, API regroupées, services internes, Deno et handler unique sont implémentés. Terminer la migration directe des consommateurs et la recette staging avant une nouvelle tranche UI.

## 1. Établir les contrats existants

- [x] Index Eventflow disponible et utilisé pour le diagnostic du 20 septembre 2026.
- [ ] Vérifier sa fraîcheur puis tracer les flux réels du périmètre refactoré. Ne pas réutiliser le graphe de Nexora comme preuve.
- [ ] Compléter les tests de caractérisation : édition événement, formulaire, participants, commande gratuite/payante, webhook et scan.
- [ ] Inventorier les contrats Zod dupliqués, versions frontend/backend, RPC et grants associés.
- [ ] Distinguer bugs existants, changements métier souhaités et simples extractions.

## 2. Tranche frontend différée — formulaire d'inscription événement

Objectif : rendre la validation et le mapping de `EventRegistrationFormPanel.tsx` testables sans changer le comportement utilisateur. Les parcours Mollie nominaux ont été validés en staging le 20 septembre 2026 ; les recettes complémentaires restent suivies séparément.

Périmètre initial : ce composant, ses helpers de validation/mapping et les tests associés. `AttendeeEditorPanel.tsx` constitue une tranche ultérieure. Aucun changement SQL, paiement, bibliothèque ou style dans cette première extraction.

- [ ] Tracer avec GitNexus les appelants, le hook/repository et le contrat de sauvegarde ; analyser l'impact avant édition.
- [ ] Écrire les tests de caractérisation utiles sur les données initiales, les modifications valides et invalides et le payload sauvegardé.
- [ ] Extraire les fonctions de validation/mapping sans modifier le contrat existant ; n'extraire l'état que si une responsabilité précise le justifie.
- [ ] Valider sauvegarde, annulation, erreur de sauvegarde et réouverture du formulaire sur staging, avec les tests ciblés et le build.
- [ ] Livrer une PR limitée avec les comportements préservés et les preuves de recette avant promotion production.

### Tranches frontend suivantes

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
- Extension des contrats partagés aux consommateurs RPC restants ; le socle Node/Deno Zod 4 est en place.
- Consolidation des styles/tokens ; pas de conversion globale en CSS Modules.
- Internationalisation éventuelle ; aucun engagement FR/NL hérité automatiquement de Nexora.
- Réduction des alias historiques ; `@contracts` cible désormais `/shared/schemas`.

Chaque tranche doit préciser les fichiers touchés, les contrats préservés, les tests, la recette staging et l'effet possible en production. Références : [architecture](../ARCHITECTURE.md) et [revue](../agents/REVIEW.md).
