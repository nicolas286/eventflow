# C1 — Nettoyage local démontré

Sur `dev`, HEAD `4ef53f40c779b7bdbe65f80630a0d37bc7973574`, après B6 local.
Diff préexistant préservé. Trois ensembles à relire/committer en PR distinctes ;
aucune PR distante, publication ou suppression distante effectuée.

| Ensemble | Retiré après recherche des consommateurs | Conservé / preuve |
| --- | --- | --- |
| Frontend mort | useStartMollieConnect → mollieConnectRepo et test isolé ; TextAreaWithToolbar → useMarkdownTextarea → applyMarkdown ; test de refresh du seul helper Mollie mort | useStripeConnect, éditeur actif, export ExcelJS ; aucun importateur actif trouvé |
| Modules backend morts | orders/public/mollie-auth et mollie-payments ; orders/admin/errors ; accounts/mollie ; subscriptions/first-payment, recurring-payment, env, mollie, subscription, webhook-contracts ; encryption utilisée seulement par mollie-auth ; deux tests de ces anciens modules | Vrais handlers subscriptions/start/cancel et routes historiques 410 ; aucun module routé supprimé |
| Dépendances npm | nodemailer et xlsx, via npm uninstall ; neuf packages retirés, lockfile synchronisé | ExcelJS réellement importé pour participants, circuit email Deno existant |

21 fichiers retirés. Dans le service order-confirmation, seul sendOrderConfirmation
orphelin, son ancien template et ses deux helpers exclusifs sont retirés. Le dossier,
sendBankTransferInstructions, retryBankTransferInstructions et leurs helpers actifs
restent utilisés par orders et les reminders. Le service ticket-confirmation actif
conserve son propre template et sa logique de lecture.

Le worker migrate-subscription-webhooks reste routé, avec ses tests ; il n’est pas
considéré mort. Aucune donnée Mollie/facture, colonne ou RPC historique supprimée.
Les consommateurs externes ne justifient aucun retrait d’endpoint distant ici.
La preuve concerne le code local importable et les chemins réellement routés.

Un nouveau test appelle les deux vrais endpoints subscriptions/webhooks et vérifie
410 MOLLIE_HISTORY_READ_ONLY sans aucun fetch prestataire/base. Les anciens tests
qui ne validaient que des helpers désormais non routés sont supprimés ; tests des
parcours Stripe, abonnement interne, compte, email/capture et paiement conservés.

Validation : 14 tests ciblés abonnement/routes 410/livraison ; check:backend,
lint:backend (221 fichiers), test:backend (407), npm test (507 Vitest + 19 Node),
build et ESLint ciblé réussis. B6 a aussi validé 65 migrations, SQL avec rôles réels,
HTTP sans RLS et concurrences. La baisse des nombres de tests correspond aux seuls
tests de code mort retirés, avec ajout du test des vrais endpoints 410.
Avertissement Vite de chunk préexistant ; pas de recette visuelle/hébergée.

**État : trois sous-lots implémentés/testés localement ; aucun commit, push,
déploiement ou retrait distant. C2 n’a pas été exécuté.**
