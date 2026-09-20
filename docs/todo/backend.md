# Backend — migration directe par domaine

État des sources locales au 20 septembre 2026. **Périmètre autorisé : dev/staging uniquement.** Les cases implémentées ne prouvent ni publication ni recette distante.

## Décisions

- Contrats front/API dans `/shared/schemas`, Zod `4.3.6`, types déduits et limites, sans dépendance React/Deno/Supabase.
- API `orders`, `subscriptions`, `accounts`, `invoices`, `workers` ; création de commande via `POST`.
- Migration directe : **aucune ancienne route conservée comme adaptateur**.
- E-mails, PDF et Billit internes ; rappels via worker protégé.
- Correction de sécurité explicitement approuvée : suppression de compte soumise au rôle owner/admin sur l'organisation demandée avant effet prestataire ou mutation. Un `orgId` client ne constitue plus une autorisation.

## Implémenté dans les sources

- [x] Deno `2.9.6` local/CI, configuration VS Code backend/contrats et séparation ESLint/Deno.
- [x] Contrôle strict complet et commandes `check:backend`, `lint:backend`, `test:backend`.
- [x] Contrats front/API touchés dans `shared/schemas`, imports frontend `@contracts`, validation serveur et taille HTTP bornée.
- [x] Commandes publique/admin/lecture dans `orders`, abonnements/webhooks dans `subscriptions`, compte dans `accounts`, facture dans `invoices`, crons dans `workers`.
- [x] E-mails, PDF et Billit internes ; travaux asynchrones protégés par `EdgeRuntime.waitUntil`, attente locale en fallback.
- [x] Anciens helpers HTTP/handler retirés ; un seul `createEdgeHandler` partagé.
- [x] Typage strict et remplacement des `any` explicites du périmètre.
- [x] Tests ciblés des autorisations, booking tokens, erreurs HTTP, annulations Mollie, commandes, PDF/QR/Unicode et workers.

Validation locale de la tranche : **72 tests Deno, 49 tests Vitest et 13 tests Node réussis**, check/lint backend et build réussis. ESLint des fichiers frontend modifiés et contrats partagé réussi. Le lint frontend global conserve **55 erreurs et 2 avertissements** dans la dette non modifiée ; ne pas annoncer un lint global propre.

Voir [l'architecture](../ARCHITECTURE.md) pour les routes. Les consommateurs RPC frontend non concernés restent à migrer ultérieurement.

## Bascule staging et recette à confirmer

- [x] Publier les nouvelles fonctions et le frontend staging ; vérifier les nouvelles routes (20 septembre, `d99a21c`, Actions réussie).
- [x] Appliquer le cron rappels `workers/reminders`. L'inventaire staging contient ce cron et l'expiration SQL directe, inchangée.
- [x] Inventorier les callbacks Mollie : aucun candidat et aucune ligne `subscriptions` en staging au moment de la bascule ; aucun PATCH nécessaire. Les futurs abonnements utilisent les nouvelles URLs.
- [x] Supprimer les quinze anciennes fonctions après publication du front et contrôles : neuf fonctions actives restent en staging.
- [ ] Rejouer inscription gratuite/payante/admin, lecture avec booking token, mail capturé et PDF.
- [ ] Rejouer souscription, renouvellement/retry, facture et annulation en test ; Billit reste bloqué en staging.
- [ ] Tester suppression sur fixtures jetables : autre organisation, session absente, rôle autorisé, ordre des effets.
- [ ] Compléter le [TODO Mollie](mollie-staging.md), dont renouvellement OAuth et répétition des webhooks.
- [x] Consigner publication et premiers contrôles dans le [journal API](../api-migration-journal.md). **Cette tranche n'autorise pas la promotion dans main.**

## Ensuite

- Migrer les accès RPC frontend vers les domaines HTTP concernés.
- Réduire les handlers volumineux ; mutualiser OAuth après caractérisation de concurrence/rotation.
- Renforcer idempotence/reprises en distinguant les défauts historiques.
- Les dépendances Zod backend et les contrats partagés utilisent désormais Zod 4 ; conserver leur version alignée avec le frontend.
- Reprendre le [frontend](refactoring.md) après recette de cette bascule.
