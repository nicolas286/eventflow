# Déployer Eventflow

Dépôt : https://github.com/nicolas286/eventflow (ancien nom : `eventflow-front`).

## Circuit attendu

| Action Git | Front Netlify | Backend Supabase |
| --- | --- | --- |
| Push sur `dev` | https://eventflow-staging.netlify.app | `cpcmcxerrsnnjncrhldr` — eventflow-staging |
| Fusion d'une PR approuvée dans `main` | https://app.useeventflow.eu | `dixirvllhfkvqoahhfqh` — eventflow-prod |

Le renommage du dépôt ne renomme pas les sites ni les projets Supabase. Le dossier local peut conserver son nom actuel.

## Ordre du workflow

1. Vérifier la branche, les identifiants de destination et les variables publiques avec `deploy/environments.json`.
2. Refuser un commit déjà dépassé sur sa branche.
3. Installer les dépendances, exécuter les tests et construire le front.
4. Rejouer les migrations dans une base Docker jetable et vérifier les données de référence et permissions.
5. Lier explicitement le runner au projet Supabase cible, examiner puis appliquer les migrations.
6. Configurer les assets du projet et déployer les Edge Functions.
7. Vérifier la disponibilité du backend.
8. Synchroniser les variables du site Netlify correspondant, puis publier le front et sa fonction de partage.
9. Vérifier que le site répond et que son bundle publié contient l'URL de son propre backend, sans celle de l'autre environnement.

Un échec arrête les étapes suivantes. Il n'existe pas de transaction globale entre SQL, Edge Functions et front : les changements backend doivent rester compatibles avec le front encore publié. Une migration déjà appliquée reste appliquée si une étape suivante échoue.

## Configuration

Les environnements GitHub `staging` et `production` limitent l'accès aux secrets à leur branche respective. Ils contiennent :

- Secrets : `SUPABASE_ACCESS_TOKEN`, `NETLIFY_AUTH_TOKEN`, `VITE_SUPABASE_ANON_KEY` (clé publique).
- Variables : `SUPABASE_PROJECT_REF`, `NETLIFY_SITE_ID`, `VITE_SUPABASE_URL`, `PUBLIC_BASE_URL`, `VITE_TURNSTILE_SITEKEY`.

Le CLI Supabase utilise son jeton d'accès et un rôle de connexion temporaire ; le pipeline ne réinitialise pas le mot de passe de production. Les secrets serveur Mollie, messagerie et Billit restent dans chaque projet Supabase. Ils ne sont pas publiés dans le front ni synchronisés automatiquement entre projets.

Les variables de dépôt `STAGING_DEPLOY_ENABLED` et `PRODUCTION_DEPLOY_ENABLED` contrôlent les workflows. La propriété `deploymentEnabled` du manifeste est un second contrôle. Un déploiement demande les deux contrôles actifs. L'activation production ne publie rien à elle seule : un push dans `main`, normalement issu d'une PR approuvée, déclenche la publication.

Les deux interrupteurs sont actifs depuis la validation staging du 15 septembre 2026. La [PR initiale #181](https://github.com/nicolas286/eventflow/pull/181) a été fusionnée et son déploiement production a réussi. Le correctif Mollie de la [PR #182](https://github.com/nicolas286/eventflow/pull/182) a ensuite suivi le même circuit avec succès.

Les builds Git automatiques Netlify doivent être arrêtés ; les publications CLI/API de GitHub Actions restent possibles. Ne pas réactiver les builds Netlify en parallèle. Un nouveau rattachement de dépôt peut les réactiver : revérifier ce réglage après un renommage.

## Travail quotidien

```sh
git remote set-url origin https://github.com/nicolas286/eventflow.git
git switch dev
# changements et nouvelles migrations
git push origin dev
```

Attendre le workflow **Deploy Eventflow**, puis tester le staging. Ouvrir ensuite une PR `dev` vers `main`, faire approuver les changements et attendre les checks CI avant fusion. Le merge déclenche automatiquement la même chaîne sur la production.

La revue avant fusion reste la convention de travail. Lors du dernier contrôle du 15 septembre 2026, GitHub exige les checks `frontend` et `database` à jour, y compris pour les administrateurs, mais le nombre d'approbations obligatoires est à **zéro**. La protection actuelle ne garantit donc pas une approbation humaine avant publication.

Créer une nouvelle migration pour toute évolution SQL. Ne pas modifier une migration déjà appliquée. Le lien Supabase CLI historique à la racine du poste pointe encore vers la production : pour les opérations manuelles staging, utiliser le répertoire séparé `.local/staging` et vérifier sa référence.

## Données et intégrations staging

- Plans `free`, `starter`, `pro` fournis par migration avec `ON CONFLICT DO NOTHING` : les valeurs existantes ne sont pas écrasées, y compris en production.
- Fixtures synthétiques séparées dans `scripts/deployment/seed-staging.mjs` ; aucune copie de clients ou de factures de production.
- E-mails métier capturés dans le bucket privé `mail-previews`.
- Paiements live et transmissions Billit bloqués en staging. Des identifiants sandbox séparés sont nécessaires pour tester un paiement payant.
- Clés Turnstile officielles de test en staging.
- Expiration des commandes toutes les deux minutes ; rappels toutes les trente secondes, avec secret interne propre au staging dans Vault. Bootstrap : `scripts/deployment/configure-staging-reminders.mjs`, avec `STAGING_EDGE_SERVICE_TOKEN` fourni dans l'environnement.
- Les e-mails Supabase Auth constituent un circuit distinct de la capture métier ; le reset de mot de passe reste à tester avec sa configuration SMTP.

La configuration et la recette des paiements sont détaillées dans le [TODO Mollie staging](todo/mollie-staging.md).

## Incident et retour arrière

1. Mettre la variable GitHub de l'environnement concerné à `false` pour bloquer les nouveaux déploiements. Annuler explicitement un run déjà commencé si nécessaire ; changer la variable ne l'arrête pas.
2. Consulter l'étape en échec et les migrations déjà appliquées. Une relance doit viser le commit encore courant de la branche.
3. Pour le front, republier le déploiement Netlify précédent ou corriger par un nouveau commit. Vérifier sa compatibilité avec le backend actuel.
4. Pour SQL, préférer une migration corrective. Ne pas lancer `db reset`, une suppression de projet ou une réparation d'historique en production pour annuler un déploiement.
5. Une restauration de sauvegarde est une opération distincte à préparer avec son impact sur les données récentes ; le workflow ne la déclenche jamais automatiquement.

Voir le [journal de mise en place](staging-production-journal.md) pour les validations effectivement réalisées et les points encore ouverts.
