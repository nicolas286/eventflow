# Architecture Eventflow

## État observé

Un dépôt contient trois surfaces d'exécution : navigateur React, Edge Functions Deno/Supabase et fonction Netlify Node pour le partage. Il utilise npm et `package-lock.json`, sans découpage actuel en packages npm workspaces.

```text
src/
  app/
    routes/ layouts/ providers/
    modules/admin/       # dashboard, singleEvent, organisation, paiements…
    modules/public/      # pages publiques et inscription
  shared/
    gateways/supabase/   # client, wrappers et repositories historiques
    ui/                  # composants, thème et CSS
    models/ helpers/ hooks/ errors/
supabase/
  migrations/           # schéma, RLS, RPC, grants, références métier
  functions/            # endpoints Deno et _shared
netlify/functions/      # share-event.js
scripts/deployment/     # contrôles de cible et bootstrap
tests/                  # unitaires, SQL et destinations
.github/workflows/      # CI et déploiement backend puis front
```

Les features comportent souvent `pages`, `components`, `hooks`, `data`, `schemas`, mais la séparation n'est pas uniforme. Certains hooks gèrent leur store avec `useSyncExternalStore`. Les Edge Functions mêlent modules extraits et handlers volumineux.

## Flux à connaître

Le chemin recherché est `page → hook → repository → wrapper Supabase → RPC ou Edge Function`. Il faut tracer le chemin réel pour chaque modification ; tout le code historique ne suit pas encore cette convention.

La billetterie payante crée une commande, charge/renouvelle la connexion OAuth de l'organisation, puis crée le paiement Mollie. Les webhooks vérifient le paiement et déclenchent les suites métier. Une erreur OAuth peut donc laisser une commande en attente sans paiement. La fonction Netlify de partage lit les informations publiques de son propre backend.

## Direction du futur refactoring

1. Garder les fonctionnalités dans leurs modules actuels ; déplacer seulement dans une tâche dédiée.
2. Séparer composition des pages, orchestration des hooks, présentation des composants et accès des repositories.
3. Comparer les contrats et versions de Zod avant de supprimer les doublons.
4. Mutualiser dans `shared` seulement une responsabilité stable réellement utilisée à plusieurs endroits.
5. Extraire des helpers backend testables avant de réorganiser les handlers sensibles.
6. Préserver contrats RPC, réponses publiques, états de commande et URL lors d'une extraction sans changement métier.
7. Séparer changement métier et déplacement de code dans des étapes révisables.

## Adaptation des conventions Nexora

La structure d'instructions et de revue s'inspire de Nexora, pas ses dépendances. Eventflow ne dispose pas actuellement de sa registry de repositories, de TanStack Query, de catalogues FR/NL ou de son organisation atoms/molecules/organisms. Leur adoption n'est pas décidée.

Les alias réels sont dans `tsconfig.app.json` et `vite.config.ts` : notamment `@app`, `@modules`, `@shared`, `@gateways`, `@ui`. L'alias `@contracts` est déclaré mais son dossier cible n'existe pas dans l'état audité ; ce n'est pas une couche partagée opérationnelle.

Prochaine étape : [backlog de refactoring](todo/refactoring.md). Consignes détaillées : [frontend](../src/AGENTS.md), [backend](../supabase/AGENTS.md), [déploiements](deploiements.md).
