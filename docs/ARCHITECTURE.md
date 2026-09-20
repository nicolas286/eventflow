# Architecture Eventflow

## État observé

Un dépôt contient trois surfaces d'exécution : navigateur React, Edge Functions Deno/Supabase et fonction Netlify Node pour le partage. Il utilise npm et `package-lock.json`, sans découpage actuel en packages npm workspaces.

```text
shared/schemas/         # contrats front/API, Zod 4.3.6
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

## API par domaine — migration dev

Les chemins sont relatifs à `/functions/v1`. Ils décrivent les sources de la tranche en cours, pas une attestation de publication distante.

| Route | Responsabilité et autorisation |
| --- | --- |
| `POST /orders` | Commande publique : validation, CAPTCHA, limites et règles métier |
| `POST /orders/admin` | Commande administrative : session et appartenance à l'organisation de l'événement |
| `GET /orders/:orderId?token=…` | Consultation publique limitée, avec booking token correspondant à la commande |
| `POST /subscriptions` | Démarrage/changement d'abonnement avec session et permissions organisation |
| `DELETE /subscriptions/:orgId` | Résiliation autorisée, annulation Mollie avant mise à jour locale |
| `POST /subscriptions/webhooks/first-payment` | Premier paiement vérifié auprès de Mollie |
| `POST /subscriptions/webhooks/recurring-payment` | Renouvellement vérifié auprès de Mollie |
| `DELETE /accounts/me` | Suppression : session et rôle owner/admin sur l'organisation sélectionnée |
| `GET /invoices/:invoiceId/pdf` | Lien Storage signé après vérification de l'appartenance à l'organisation |
| `POST /workers/reminders` | Rappels manuels/cron avec authentification interne |
| `POST /workers/expire-orders` | Expiration d'un lot avec `x-cron-secret` |

Mollie Connect et les webhooks de billetterie gardent leurs points d'entrée dédiés. Le worker `POST /workers/migrate-subscription-webhooks` prépare la migration des URL de renouvellement existantes : staging uniquement, clé Mollie test et authentification interne.

Les services `_shared/services/{order-confirmation,ticket-confirmation,order-reminders,invoice-pdf,billit}` portent les effets internes. Les handlers appelants gardent la responsabilité de les autoriser. Il n'existe plus de point d'entrée HTTP autonome pour envoyer une confirmation, générer un PDF ou transmettre à Billit. La facturation asynchrone utilise `runInBackground` (`EdgeRuntime.waitUntil`, attente en Deno local).

Un seul `createEdgeHandler` demeure dans `_shared/app/edge-handler`. Il centralise HTTP/CORS et le contexte ; permissions métier et vérification des webhooks restent explicites. Les anciens chemins sont supprimés directement : frontend, crons et URL enregistrées chez Mollie doivent être migrés ensemble.

La création utilise `POST`, car elle crée une nouvelle ressource ; `PUT` impliquerait le remplacement idempotent d'une ressource identifiée. Les parcours métier sont préservés, mais l'enveloppe HTTP est harmonisée : certains préflights passent de 200 à 204, certaines méthodes invalides reçoivent l'erreur commune, et une configuration Supabase absente peut être rejetée par le wrapper avant le handler. Ne pas affirmer que tous les statuts/en-têtes sont strictement identiques.

La correction d'autorisation de suppression de compte est un changement de sécurité explicitement approuvé : le rôle owner/admin sur l'organisation demandée est vérifié avant toute mutation ou annulation Mollie.

## Contrats et contrôles

`shared/schemas` contient les payloads et réponses front/API, sans dépendance React ou Deno. Le frontend les importe via `@contracts`, le backend par imports relatifs. Le serveur valide systématiquement les entrées ; le lecteur HTTP limite aussi la taille avant parsing. Les consommateurs RPC frontend restants ne sont pas tous migrés vers HTTP dans cette tranche.

Deno `2.9.6` vérifie toutes les fonctions et tous les contrats en mode strict. ESLint suit le frontend/outillage ; Deno assure le lint backend. Utiliser `check:backend`, `lint:backend` et `test:backend`. L'alias temporaire `zod-legacy` subsiste pour certains modules internes, pas pour les nouveaux contrats front/API.

## Direction du refactoring restant

1. Garder les fonctionnalités dans leurs modules actuels ; déplacer seulement dans une tâche dédiée.
2. Séparer composition des pages, orchestration des hooks, présentation des composants et accès des repositories.
3. Étendre les contrats partagés aux futurs domaines et consommateurs RPC au fil des migrations.
4. Mutualiser dans `shared` seulement une responsabilité stable réellement utilisée à plusieurs endroits.
5. Extraire des helpers backend testables avant de réorganiser les handlers sensibles.
6. Préserver les contrats métier ; toute migration d'URL doit couvrir ses consommateurs internes et externes.
7. Séparer changement métier et déplacement de code dans des étapes révisables.

## Adaptation des conventions Nexora

La structure d'instructions et de revue s'inspire de Nexora, pas ses dépendances. Eventflow ne dispose pas actuellement de sa registry de repositories, de TanStack Query, de catalogues FR/NL ou de son organisation atoms/molecules/organisms. Leur adoption n'est pas décidée.

Les alias réels sont dans `tsconfig.app.json` et `vite.config.ts` : notamment `@app`, `@modules`, `@shared`, `@gateways`, `@ui`. L'alias `@contracts` cible désormais `shared/schemas` à la racine, distinct de `src/shared`.

Prochaine étape : [backlog de refactoring](todo/refactoring.md). Consignes détaillées : [frontend](../src/AGENTS.md), [backend](../supabase/AGENTS.md), [déploiements](deploiements.md).
