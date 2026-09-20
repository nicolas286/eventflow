# Migration API — staging, 20 septembre 2026

## Publication

- `7784243` : domaines HTTP, contrats Zod partagés, services internes, typage et outillage Deno. Correction approuvée de l'autorisation de suppression de compte : vérifier le rôle owner/admin dans l'organisation demandée avant tout effet externe ou mutation.
- Premier déploiement interrompu avant publication du front : le bundler Supabase ne résolvait pas `zod` depuis `shared/schemas` à la racine. La CI locale et distante ne reproduisait pas cette résolution implicite.
- `d99a21c` : import map explicite commune au contrôle Deno et aux neuf fonctions dans `supabase/config.toml`. Publication réussie par [GitHub Actions](https://github.com/nicolas286/eventflow/actions/runs/35506139736), CI réussie. La fonction `orders` avait préalablement été publiée seule sur le projet staging pour vérifier la correction du bundler.
- Cible : `dev`, Netlify `eventflow-staging.netlify.app`, Supabase `cpcmcxerrsnnjncrhldr`. Aucune fusion dans `main`, aucune mutation distante en production.

## Bascule des consommateurs

- Front publié après le backend. La protection par mot de passe Netlify reste activée : l'API Netlify a vérifié le commit publié et les empreintes des fichiers du build. Cela ne remplace pas une recette navigateur authentifiée.
- Cron de rappels reconfiguré avec `scripts/deployment/configure-staging-reminders.mjs` : `workers/reminders`, cadence de 30 secondes et secret Vault conservés. L'expiration SQL directe reste toutes les deux minutes.
- Inventaire du worker de migration Mollie : HTTP 200, zéro candidat. La table staging `subscriptions` était vide ; aucun callback d'abonnement enregistré n'a demandé de PATCH. Les retries éventuels d'anciennes ressources de test terminées ne sont pas une garantie de compatibilité des anciennes URLs.
- Quinze anciennes fonctions supprimées explicitement du projet staging après succès du déploiement. Inventaire final : `orders`, `subscriptions`, `accounts`, `invoices`, `workers`, `mollie-connect-start`, `mollie-connect-callback`, `mollie-webhook`, `mollie-webhook-tickets`.

## Vérifications

- 72 tests Deno, 49 tests Vitest, 13 contrôles Node ; check et lint backend réussis, build réussi. Reconstruction SQL et tests des permissions réussis dans la CI.
- Aucun `any` explicite dans le backend et les contrats partagés. Cela ne signifie pas que tous les résultats SQL sont déjà dérivés de types de base générés.
- ESLint des fichiers frontend modifiés et des contrats réussi. Le frontend global conserve 55 erreurs et 2 avertissements dans le périmètre non modifié.
- Requête réelle en staging : commande gratuite HTTP 200, un billet émis, lecture avec booking token HTTP 200, mail et PDF capturés dans `mail-previews`.
- Après retrait des anciennes fonctions : absence de session refusée par les nouvelles routes protégées ; absence de booking token refusée pour la lecture publique ; worker de maintenance protégé.
- Mollie Connect : génération authentifiée d'une URL OAuth de test réussie, sans terminer une nouvelle liaison. Session QA fermée avec `scope: local`.

## Poste de développement

Deno 2.9.6 et extension Deno installés. Le lanceur npm `deno.cmd` fonctionne en terminal mais échouait avec `EINVAL` via le lancement natif utilisé par l'extension. Le réglage **utilisateur** VS Code `deno.path` pointe vers le `deno.exe` de cette installation ; aucun chemin personnel n'est versionné dans la configuration du projet. Recharger la fenêtre VS Code si le serveur Deno est encore celui lancé avant l'installation.

## Recette restante

Les paiements et souscriptions de test avaient été validés avant cette migration ; cette validation ne vaut pas recette du nouveau transport. Rejouer paiement test, création administrative, souscription, renouvellement/retry, annulation, accès facture et suppression sur fixtures jetables. Voir [le TODO backend](todo/backend.md). La promotion production reste une décision séparée.
