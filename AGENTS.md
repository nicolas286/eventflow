# Eventflow — Instructions globales

## Mission

Eventflow est un SaaS de gestion d'événements et billetterie organisé autour d'organisations. Préserver les parcours existants, l'isolation des organisations et celle des environnements.

Le refactoring global est **à venir**. Une correction ciblée n'est pas l'occasion de déplacer tous les modules ou de remplacer les bibliothèques. Distinguer comportement observé, intention métier et proposition d'architecture.

## Sources et instructions spécialisées

- Produit : [docs/PROJECT.md](docs/PROJECT.md).
- Architecture : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Exploitation : [docs/deploiements.md](docs/deploiements.md), `deploy/environments.json` et `.github/workflows/`.
- Prochaines tâches : [docs/todo/README.md](docs/todo/README.md).
- Instructions locales : [src/AGENTS.md](src/AGENTS.md), [supabase/AGENTS.md](supabase/AGENTS.md).

Les migrations décrivent le schéma versionné et les tests les contrats exécutables. Inventorier un éventuel écart distant avant de le corriger.

Lire les fiches pertinentes ; elles servent aussi de missions aux sous-agents :

- [ORCHESTRATION](docs/agents/ORCHESTRATION.md) : découpage et intégration.
- [COMPONENTS](docs/agents/COMPONENTS.md), [DESIGN_SYSTEM](docs/agents/DESIGN_SYSTEM.md), [COPY_I18N](docs/agents/COPY_I18N.md) : frontend.
- [REVIEW](docs/agents/REVIEW.md) : revue du diff réel.
- [SECURITY_REVIEW](docs/agents/SECURITY_REVIEW.md), [OFFENSIVE_TESTING](docs/agents/OFFENSIVE_TESTING.md) : permissions et tests négatifs.
- [TESTING](docs/agents/TESTING.md) : validations proportionnées.

## Méthode

1. Vérifier branche et diff ; préserver les changements de l'utilisateur.
2. Chercher l'existant, tracer appelants, contrats, RPC et effets externes avant édition.
3. Annoncer les changements de comportement production et les incertitudes ; ne pas les qualifier de simple infrastructure.
4. Implémenter le plus petit changement cohérent, avec les validations pertinentes.
5. Examiner le diff final, appliquer les revues utiles et documenter les résultats.
6. Distinguer code modifié, tests réussis, déploiement effectué et résolution métier confirmée.

## GitNexus

Utiliser l'index **Eventflow** s'il est disponible et à jour : `query`/`context` pour tracer, `impact` avant un changement sensible, `detect_changes` pour revoir un diff de code. Vérifier le dépôt et la fraîcheur de l'index.

Au 15 septembre 2026, Eventflow n'était pas indexé dans la session ; Nexora a servi de référence pour les conventions. Son graphe ne prouve rien sur Eventflow. Sans index exploitable, utiliser `rg`, les sources et les tests, et signaler cette limite. Ne pas bloquer une tâche documentaire ni réindexer un autre projet pour cela.

## Conventions

- Utiliser **npm** et `package-lock.json`, pas les conventions pnpm de Nexora.
- Respecter les alias réellement configurés dans TypeScript et Vite.
- Ne pas ajouter de `any`, cast ou suppression de lint pour cacher une régression.
- Séparer présentation, orchestration et données dans le périmètre touché ; mutualiser seulement une responsabilité réellement partagée.
- Ajouter une migration plutôt que modifier une migration déjà appliquée. Préserver les réglages existants lors d'un seed métier.

## Environnements et autorisations

- `dev` cible staging, `main` production. Le manifeste fixe les identifiants.
- Push et fusion déclenchent des déploiements : respecter le périmètre autorisé dans la conversation. Une autorisation de hotfix ponctuelle ne vaut pas pour toutes les futures fusions.
- Ne pas abaisser les protections GitHub pour faire passer une fusion bloquée.
- Vérifier la cible de chaque commande Supabase distante ; le lien CLI historique peut pointer en production.
- Tester les mutations sur fixtures locales/staging. Aucun paiement live, e-mail client ou facture réelle dans les tests automatisés.
- Ne pas exposer ni versionner secrets, jetons OAuth, booking tokens, mots de passe ou contenu de `.local`. Les variables `VITE_*` sont publiques.
