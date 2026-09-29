# Eventflow

Gestion d'événements et billetterie pour petits organisateurs : publication d'événements, formulaires d'inscription, commandes, participants, billets PDF, scan QR et paiements.

Le [dépôt eventflow](https://github.com/nicolas286/eventflow) regroupe le front React, les migrations et Edge Functions Supabase, la fonction de partage Netlify et les workflows GitHub Actions.

## Environnements

| Branche | Front | Backend Supabase |
| --- | --- | --- |
| `dev` | [Staging](https://eventflow-staging.netlify.app) | `eventflow-staging` — `cpcmcxerrsnnjncrhldr` |
| `main` | [Production](https://app.useeventflow.eu) | `eventflow-prod` — `dixirvllhfkvqoahhfqh` |

Un push sur `dev` déploie le backend puis le front staging. Une fusion dans `main` déclenche la même chaîne en production. Tests, build et reconstruction SQL jetable précèdent les mutations distantes. Les builds Git Netlify sont arrêtés pour laisser GitHub Actions orchestrer la publication.

Voir le [guide de déploiement et de retour arrière](docs/deploiements.md). Un workflow vert ne remplace pas la recette métier, notamment pour les paiements et les e-mails.

## Démarrage local

Prérequis : Node.js, npm et Deno `2.9.6` ; Docker et Supabase CLI pour le backend local. Versions utilisées par la CI : Node `24.19.0`, Supabase CLI `2.84.2` ; vérifier `.github/workflows/` en cas d'évolution.

```sh
npm ci
```

Copier `.env.example` vers `.env` si ce dernier n'existe pas déjà. Pour une stack locale :

```sh
supabase start
supabase status
npm run dev
```

Reporter dans `.env` l'URL et la clé publique locale fournies par le CLI. Le front démarre généralement sur `http://localhost:5173`. Les secrets serveur ne vont jamais dans `VITE_*`. Les fixtures du staging distant ne sont pas créées automatiquement en local.

Le fichier `.env.prod` historique n'est pas chargé par un `vite build` standard, qui utilise le mode `production`. GitHub Actions fournit les variables de chaque cible. Le lien CLI historique à la racine du poste peut encore viser la production : vérifier la cible avant toute commande distante.

## Vérifications

```sh
npm test        # Vitest et contrôles des destinations
npm run build  # TypeScript frontend puis Vite
npm run lint   # ESLint frontend/outillage
npm run check:backend # Deno strict : fonctions, tests et contrats partagés
npm run lint:backend  # Deno lint
npm run test:backend  # Tests backend et prestataires simulés
```

Installer les extensions recommandées par `.vscode/extensions.json`. Deno est activé pour `supabase/functions` et `shared/schemas` ; le frontend reste suivi par TypeScript/Vite. Après installation de Deno, redémarrer le terminal intégré si le PATH n'est pas actualisé. Sous PowerShell, `npm.cmd` et `deno.cmd` évitent les problèmes de politique de scripts.

Le build Vite ne vérifie pas à lui seul les Edge Functions Deno. Voir la [stratégie de test](docs/agents/TESTING.md) pour les contrôles SQL et backend.

## Stack

React 19, TypeScript, Vite, React Router, Zod, Supabase Auth/PostgreSQL/RLS/RPC/Storage/Edge Functions Deno, Netlify et GitHub Actions. Mollie gère les paiements, Resend les e-mails métier et Billit l'intégration de facturation.

L'architecture est historique et hétérogène. Les conventions décrivent comment la faire évoluer progressivement ; elles ne prétendent pas que tout le code les applique déjà.

## Réorganisation backend sur dev

La migration directe regroupe les commandes dans `orders`, les abonnements dans `subscriptions`, les comptes dans `accounts`, les liens de factures dans `invoices` et les tâches planifiées dans `workers`. Les e-mails, PDF et appels Billit deviennent des services internes. Les contrats front/API résident dans `/shared/schemas`, avec Zod `4.3.6` partagé. Les anciennes routes ne sont pas conservées comme adaptateurs.

Cette tranche vise **dev/staging uniquement**. Son intégration dans les sources ne vaut pas validation du déploiement ni recette métier ; suivre le [plan backend](docs/todo/backend.md) avant toute promotion.

## Documentation

| Sujet | Document |
| --- | --- |
| Produit et invariants métier | [PROJECT](docs/PROJECT.md) |
| Architecture actuelle et direction du refactoring | [ARCHITECTURE](docs/ARCHITECTURE.md) |
| Instructions agents | [AGENTS](AGENTS.md) |
| Missions des sous-agents et revues | [Orchestration](docs/agents/ORCHESTRATION.md) |
| Configuration Mollie staging à terminer | [TODO Mollie staging](docs/todo/mollie-staging.md) |
| Travaux suivants | [Backlog](docs/todo/README.md) |
| Exploitation | [Déploiements](docs/deploiements.md) |
| Historique de la séparation | [Journal](docs/staging-production-journal.md) |
| Incident OAuth résolu | [Renouvellement Mollie](docs/incident-mollie-refresh-2026-09-15.md) |

En staging, les e-mails métier sont capturés dans `mail-previews`, les paiements live et Billit sont bloqués. Connect, paiement de billets et souscription en mode test ont été validés avant cette migration. Leur recette doit être répétée sur les nouvelles routes ; la recette des e-mails Supabase Auth reste distincte.
