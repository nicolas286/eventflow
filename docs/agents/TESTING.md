# Stratégie de test Eventflow

Tester au niveau le plus bas qui prouve le comportement. Choisir les validations selon le diff ; une modification de documentation demande une revue des faits et des liens, pas une nouvelle suite applicative.

| Changement | Validation attendue |
| --- | --- |
| Schéma, mapping, helper | Tests unitaires ciblés |
| Composant/hook | États et transitions utiles, build frontend, recette visuelle si nécessaire |
| RPC/RLS/migration | Reconstruction SQL jetable et scénarios avec rôles réels |
| Edge Function/prestataire | Requête/réponse simulée, erreurs et effets de bord ; recette staging si configuré |
| Déploiement | Tests de destination, backend disponible, bundle publié relié à son backend |
| Paiement/webhook | Mode test, refus/annulation/répétition, état de commande, billet et mail capturé |

## Commandes existantes

```sh
npm test
npm run build
npm run lint
npm run check:backend
npm run lint:backend
npm run test:backend
```

`npm test` exécute Vitest et les tests Node de `tests/deployment`. `npm run build` vérifie le frontend, pas les modules Deno. Deno `2.9.6` vérifie toutes les fonctions, tests et contrats `shared/schemas` via les trois commandes backend ; ESLint reste limité au frontend/outillage. Les tests backend simulent les prestataires et ne valident pas un paiement réel. Ne pas annoncer un lint global réussi sans l'avoir exécuté ; la dette frontend non touchée reste distincte du backend propre.

La CI reconstruit une base jetable avec `supabase db start`, puis exécute `supabase db query --local --file tests/database/baseline.sql`. Pour une vérification manuelle, utiliser un workdir isolé, des ports disponibles et un chemin de fichier absolu si le CLI change de workdir. Ne pas arrêter la stack d'un autre projet.

## Règles de preuve

- Un bug reçoit un test de non-régression significatif quand il peut être reproduit ; tester le comportement plutôt qu'une copie de l'implémentation.
- Un mock OAuth prouve le format de requête, pas la validité des identifiants ni le succès d'un paiement réel.
- Ne pas utiliser de données clients ou de secrets production dans les tests.
- Conserver les tests négatifs pertinents : autre organisation, rôle insuffisant, entrées invalides et retries.
- Après correction, relancer les contrôles affectés ; éviter les répétitions sans changement ni incertitude nouvelle.

Rapporter commandes/résultats, limites, avertissements et défauts préexistants séparément. Un déploiement vert n'est pas une confirmation métier.
