# Eventflow — Backend Supabase

Hérite de [../AGENTS.md](../AGENTS.md). Lire les fiches [sécurité](../docs/agents/SECURITY_REVIEW.md), [tests](../docs/agents/TESTING.md) et le [guide de déploiement](../docs/deploiements.md).

## Responsabilités

- PostgreSQL : contraintes, relations, RLS, grants, opérations atomiques et invariants persistants.
- Edge Functions Deno : transport HTTP, validation, autorisation, orchestration et prestataires.
- `functions/_shared` : briques réellement partagées ; le code propre à un endpoint reste à proximité.

Viser des handlers minces lors des extractions, sans imposer l'arborescence backend de Nexora. Le code historique n'est pas uniformément typé ou découpé.

## Authentification et contrats

- `createEdgeHandler` centralise HTTP/CORS, logs et erreurs ; il **n'authentifie pas automatiquement tous les handlers**.
- Les `verify_jwt=false` existants ne dispensent pas des contrôles utilisateur, service token ou webhook appropriés.
- Vérifier appartenance à l'organisation et droits sur la ressource avant une opération privilégiée ; un `orgId` client n'est pas une preuve.
- Préserver grants minimaux et `search_path` maîtrisé des RPC `SECURITY DEFINER`. Tester les rôles réels, pas seulement `service_role`.
- Vérifier les versions de Zod et la compatibilité Node/Deno avant de mutualiser des contrats frontend/backend.

## Paiements et effets externes

- Distinguer `MOLLIE_API_KEY` (abonnements Eventflow) et Mollie Connect OAuth (billetterie des organisations).
- Préserver montants en centimes, identité de commande, mode test/live, vérification serveur et idempotence des webhooks.
- Le renouvellement OAuth fournit le même `MOLLIE_CONNECT_REDIRECT_URI` que l'échange initial. Examiner les trois chemins tant qu'ils restent dupliqués.
- Journaliser statut prestataire, code sûr et corrélation ; pas de réponse brute contenant potentiellement jetons ou données personnelles.
- Conserver les protections `environment-safety.ts`, la capture staging et les secrets séparés. Supabase Auth constitue un circuit d'e-mails distinct.

## SQL et publication

- Ajouter une migration, ne pas réécrire l'historique appliqué. Documenter effets sur les lignes existantes et compatibilité avec le front encore en ligne.
- Le seed `plan_limits` insère les plans absents ; ne pas écraser une configuration existante.
- Rejouer les migrations dans une base jetable. Aucun `db reset` sur une cible distante.
- Vérifier le projet avant les commandes CLI distantes. Les déploiements habituels passent par GitHub Actions.
