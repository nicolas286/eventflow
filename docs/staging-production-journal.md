# Journal de séparation staging / production

## 15 septembre 2026 — Étape 1 : état initial

### Cadre

- Demande : mettre en œuvre le plan, préserver la production et documenter chaque étape.
- Branche de travail dédiée : `infra/staging-isolation`.
- Le propriétaire confirme deux sites Netlify distincts et un déploiement Supabase par CLI (« supabase deploy »).
- Les exports locaux sont placés dans `.local/`, exclu de Git. Aucun secret ne doit figurer dans ce journal.

### Vérifications réalisées

1. `git fetch origin` a actualisé les références sans push ni déploiement.
2. Le main distant est `f9d441f` (7 août 2026), après la PR #180 ; dev est `3ae71d5`.
3. Le contenu des deux branches est identique. Les 136 commits supplémentaires du main correspondent à un historique différent ; ils ne représentent pas des changements de fichiers à récupérer.
4. Correction de l'audit initial : le main local de février était périmé. Le main distant possède déjà les 28 migrations et les 19 fonctions. Il n'est pas nécessaire de reconstruire artificiellement un historique Git backend.
5. Le projet lié est `eventflow-prod`, référence `dixirvllhfkvqoahhfqh`, région `eu-central-1`, Postgres 17.
6. `supabase migration list --linked` indique une correspondance exacte des 28 versions locales et distantes. Cela ne prouve pas à lui seul l'absence de changements SQL manuels.
7. Les 19 fonctions distantes sont actives et toutes ont `verify_jwt = false`. Le manifeste local ne décrit explicitement que 8 d'entre elles.
8. `send-confirmation-mail-tickets` a été modifiée le 28 août, après le dernier commit Git du 7 août : son code distant doit être comparé avant tout remplacement.

### Production

Aucune migration, aucun déploiement de fonction, aucune modification Netlify, aucun reset distant et aucun changement de secret de production n'ont été effectués. La commande de lecture de l'historique des migrations initialise un rôle de connexion temporaire via la CLI ; elle n'applique pas de migration applicative.

### Suite

Inventorier les métadonnées SQL et les sources des fonctions déployées, identifier les sites Netlify, réinstaller les dépendances et reconstruire une base locale isolée. Les résultats seront ajoutés ici.

## Étape 2 — Reconstruction et comparaison

- Dépendances réinstallées avec `npm ci` ; build réussi (avertissement existant sur la taille du bundle).
- Base Docker dédiée `eventflow-separation-audit`, port 59322 : les 28 migrations historiques se rejouent intégralement. Les ports d'un autre projet local ont été évités.
- Exports de schéma réalisés en lecture, sans données clients. Les différences de Storage proviennent aussi des versions du service géré ; elles ne doivent pas être reprises comme migrations applicatives.
- La comparaison des schémas `public`/`private` montre des restrictions de permissions présentes en production mais absentes de l'historique. Migration corrective ajoutée : `20260915160000_reconcile_production_privileges.sql` (37 révocations et 52 instructions observées en production). Testée localement, puis appliquée uniquement au nouveau staging.
- Les sources des 19 fonctions ont été téléchargées. Seul `send-confirmation-mail-tickets/ticketsPdf.ts` diffère : correction Unicode/WinAnsi. La version distante a été conservée dans le dépôt.
- Les 19 déclarations `verify_jwt = false` sont maintenant explicites et conformes à l'inventaire distant. Les vérifications des utilisateurs et des secrets internes dans les handlers sont conservées.

## Étape 3 — Nouveau projet staging

- Projet créé : `eventflow-staging`, référence `cpcmcxerrsnnjncrhldr`, région `eu-central-1`.
- Mot de passe DB généré aléatoirement, enregistré chiffré via Windows DPAPI dans `.local/staging-db-password.dpapi`.
- Lien CLI séparé dans `.local/staging/supabase/.temp/project-ref`. Le lien historique du dépôt vers la production n'a pas été remplacé.
- 31 migrations appliquées sur staging : 28 historiques, réconciliation des permissions, configuration des assets/buckets, plans métier.
- Buckets `public-assets` (public, images, 5 Mo maximum), `invoices` (privé) et `mail-previews` (privé, staging uniquement).
- Deux images publiques par défaut copiées ; aucun upload client ni facture réelle copié.
- Les valeurs par défaut SQL passent par `public.default_asset_url()`, alimenté par `private.app_environment`. La valeur initiale préserve le comportement production ; le bootstrap staging la remplace avant toute création de fixtures.
- Secrets internes et clés de chiffrement staging générés indépendamment. Aucun identifiant Mollie, Resend ou Billit de production copié.
- Garde-fous serveur : live Mollie refusé hors production, Billit bloqué en staging, appels internes vérifiés, e-mails capturés dans Storage privé. Le mode d'envoi réel impose une liste de destinataires en environnement non production.
- Turnstile configuré avec la paire de clés de test officielle Cloudflare ; `TURNSTILE_BYPASS=0`.
- Auth staging pointe vers `https://eventflow-staging.netlify.app`, avec les routes admin et reset. Confirmations d'inscription désactivées pour ce staging. SMTP/Auth reset reste à valider séparément de la capture des e-mails métier.
- Les 19 fonctions sont déployées sur staging.
- Cron d'expiration toutes les deux minutes configuré pour exécuter la RPC directement dans la base staging. Le cron de rappels reste à configurer.

## Étape 4 — Données métier et première recette

- Demande complémentaire : prévoir le seed métier en production, notamment les plans.
- Lecture de `public.plan_limits` en production : trois plans, `free`, `starter`, `pro`.
- Migration `20260915162000_seed_business_plans.sql` : valeurs identiques à la production et `ON CONFLICT (plan) DO NOTHING`. Elle ne remplace aucune limite déjà configurée. Pas encore appliquée en production.
- `supabase/seed.sql` n'écrase plus le plan gratuit : les références sont gérées par migration ; les fixtures sont séparées dans `scripts/deployment/seed-staging.mjs`.
- Fixture : compte synthétique `qa-owner@eventflow.example`, organisation de démonstration, événement et billet gratuit avec un participant. Mot de passe conservé uniquement dans `.local/staging-test-account.json`.
- Recette distante staging réussie : trois plans installés, inscription anonyme gratuite, commande payée, billet émis, PDF joint à l'e-mail capturé, accès anonyme à la table des commandes sans divulgation, URL des assets ciblant staging.
- Défaut préexistant découvert : une commande contenant uniquement un produit ne créant aucun participant échoue sur `p_new_attendees must be > 0`. Aucune correction métier de cette règle n'a été mêlée à la séparation ; le scénario validé utilise un billet avec participant.

## Étape 5 — Inventaire Netlify / GitHub

- Site production : `eventflow-prod`, ID `279f8c97-669b-466e-905e-56f378aa34fa`, branche main, commit publié `f9d441f`.
- Site staging : `eventflow-staging`, ID `08f211b0-7847-48c5-96e0-7a4b0efd0e42`, branche dev, commit initial publié `3ae71d5`.
- Le propriétaire confirme que l'adresse staging à conserver est `https://eventflow-staging.netlify.app`. Le domaine initialement évoqué `staging.useeventflow.eu` n'existe pas dans le DNS et n'est pas utilisé.
- Les variables publiques production utilisent actuellement le domaine `eventflow-prod.netlify.app`. Elles sont inventoriées mais pas modifiées.
- GitHub : dépôt public ; main exige déjà une revue et invalide les anciennes approbations. Cette protection n'est pas imposée aux administrateurs et aucun check obligatoire n'est configuré.
- Collaborateurs recensés : `nicolas286` (admin), `SpeedFox03` (write). Aucun message envoyé.
- Aucun environnement ni secret Actions n'était configuré.
- La lecture GitHub via le jeton de la session Git a d'abord été refusée par la revue automatique. Elle a été exécutée seulement après l'autorisation explicite du propriétaire, limitée à ce dépôt ; aucun jeton affiché ou enregistré.
- `deploy/environments.json` fixe les références exactes et laisse les deux déploiements désactivés avant validation du bootstrap.
- CI de tests/build/reconstruction SQL ajoutée, sans mutation distante. Tests de destination : 11 cas passent. Tests unitaires : 24 cas passent après ajout des contrôles d'environnement et de capture des mails.

## Étape 6 — Publication staging et renommage

- Front staging publié par CLI : déploiement `6aa95d2e89877b0a9cd13924`. Correction de l'option Netlify : `--context` est incompatible avec `--no-build` et a été retirée aussi du workflow.
- À la demande du propriétaire, dépôt renommé de `nicolas286/eventflow-front` en `nicolas286/eventflow` ; identifiant GitHub inchangé (`1141355966`), remote local actualisé.
- Les deux sites Netlify sont rattachés au nouveau nom. Ce rattachement a réactivé les builds et déclenché des rebuilds du même commit de production. L'arrêt des builds a dû être effectué dans une requête distincte du rattachement.
- Mesure corrective : builds automatiques arrêtés sur les deux sites, vérification des tâches en cours, puis restauration exacte du déploiement production initial `6a75f2657361240008a6f15f` (commit `f9d441f`) et maintien du staging validé. Aucun changement SQL ni déploiement Edge Function en production.
- Le contrôle immédiat confirme les deux identifiants de déploiement attendus et `stop_builds=true` sur les deux sites.

## Étape 7 — Secrets et configuration GitHub

- Autorisation explicite reçue pour copier les jetons CLI Supabase et Netlify dans les secrets Actions du dépôt.
- La revue automatique a refusé le premier script car il incluait aussi le mot de passe DB staging et des lectures supplémentaires. Script réduit aux deux jetons autorisés ; transfert ensuite accepté et effectué.
- Jetons chiffrés en mémoire avec la clé publique GitHub et stockés dans les environnements `staging` et `production`. Aucune valeur de jeton affichée ni ajoutée au dépôt ; aucun mot de passe DB copié.
- Environnements limités respectivement aux branches `dev` et `main`. Variables publiques et clé publique Supabase de chaque front configurées séparément.
- Certains champs Netlify sont masqués par l'API (`****************...`) : le contrôle initial ne devait pas les comparer à des URL en clair. Les valeurs staging connues du bootstrap ont été utilisées.
- Le manifeste permet désormais les deux cibles ; les interrupteurs GitHub seront activés après validation. Le résultat demandé est bien un déploiement automatique production après fusion approuvée, sans étape de publication manuelle supplémentaire.
- Guide d'exploitation ajouté : `docs/deploiements.md`.

## Étape 8 — Premier déploiement GitHub Actions validé

- Commit initial : `592a2d9`. CI sur la branche d'infrastructure réussie : https://github.com/nicolas286/eventflow/actions/runs/34986971316.
- Push de ce commit sur `dev` ; déploiement staging intégral réussi : https://github.com/nicolas286/eventflow/actions/runs/34987276431.
- Le runner GitHub a lié le projet staging avec le seul jeton CLI, sans mot de passe DB copié, puis vérifié les migrations, redéployé les fonctions et publié le front après succès du backend.
- Contrôle HTTP des deux fronts publiés : chacun contient uniquement son URL Supabase attendue. Le partage Netlify de l'événement synthétique staging répond correctement.
- Protection `dev` adaptée au push direct demandé (suppression de l'obligation historique de PR). `main` impose une approbation, invalide les approbations devenues obsolètes, exige les checks `frontend` et `database` à jour et la résolution des conversations. Ces règles s'appliquent aussi aux administrateurs.
- Cron de rappels staging installé : trente secondes, secret de service propre au staging dans Vault ; quatre premières réponses HTTP : 200. Cron d'expiration : toutes les deux minutes. Le script de bootstrap vérifie la référence liée et efface le contenu SQL temporaire contenant le secret après exécution.
- Contrôle du bundle publié ajouté au workflow pour rendre la vérification de séparation systématique après chaque publication.

## Étape 9 — Promotion production prête

- Second déploiement staging réussi sur `d5d29ff`, contrôle du bundle publié inclus : https://github.com/nicolas286/eventflow/actions/runs/34987829542.
- Variables GitHub `STAGING_DEPLOY_ENABLED=true` et `PRODUCTION_DEPLOY_ENABLED=true` ; les deux cibles du manifeste sont actives.
- PR **#181**, `dev` vers `main`, ouverte et prête à relire : https://github.com/nicolas286/eventflow/pull/181. Elle n'est pas fusionnée. Sa fusion après approbation et checks réussis déclenchera automatiquement le backend puis le front production.
- Vérification SQL production : toujours 28 migrations, dernière version `20260806170408`. Le seed des plans et les deux autres nouvelles migrations attendent la promotion de cette PR.
- Les secrets d'intégrations externes ne sont pas copiés entre projets : Mollie payant non configuré en staging, Resend remplacé par la capture des e-mails métier, Billit bloqué. Seuls les jetons de déploiement CLI sont réutilisés dans GitHub, conformément à l'autorisation reçue.
- Points de recette séparés encore ouverts : paiement Mollie sandbox/OAuth et e-mails Supabase Auth de reset. Le parcours gratuit et les e-mails métier avec PDF sont validés.

### État attendu après fusion de la PR

Un push sur `dev` déploie staging ; une fusion approuvée dans `main` déploie production. Aucun lancement manuel de Supabase ou de Netlify n'est nécessaire dans ce circuit. La première exécution production ne sera observable qu'après cette fusion ; les exécutions staging sont déjà validées.
