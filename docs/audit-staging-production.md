# Eventflow — Audit de séparation staging / production

Date : 15 septembre 2026.

> **Mise à jour après accès distant :** `git fetch` a révélé que le main local utilisé lors de l'audit était périmé. Le main distant `f9d441f` contient déjà les 28 migrations et 19 fonctions ; son contenu est identique à dev. Les 28 versions de migrations correspondent à la production. Les constats Git initiaux ci-dessous sont conservés comme historique et remplacés par les vérifications du [journal de mise en œuvre](staging-production-journal.md). Ne pas préparer de réparation d'historique sur la seule base de cet audit initial.

## 1. Décision recommandée

Conserver le dépôt unique, les branches `dev` et `main`, et le projet Supabase actuel comme production. Créer un deuxième projet Supabase durable pour staging. Orchestrer les déploiements avec GitHub Actions : contrôles et build, migrations, Edge Functions, puis publication Netlify.

Le dépôt unique est adapté : une même PR peut contenir une évolution SQL, les fonctions backend et le front qui l'utilise. Le problème prioritaire est le partage du backend et l'absence de processus de promotion vérifiable.

| Branche | Front | Backend | Intégrations |
| --- | --- | --- | --- |
| `feature/*` | Local ; previews en option | Supabase local ou environnement isolé | Tests |
| `dev` | `https://staging.useeventflow.eu` | Nouveau projet staging | Mollie test, e-mails capturés, facturation de test ou désactivée |
| `main` après fusion d'une PR approuvée | `https://app.useeventflow.eu` | Projet actuel de production | Services réels |

Les données staging ne sont jamais fusionnées vers la production. Ce sont le code, les migrations et la configuration adaptée à la destination qui sont promus.

### Alternative : branche Supabase persistante

Une branche persistante est une vraie option : elle possède son instance et ses identifiants, et convient à un staging durable. Une branche de preview éphémère ne convient pas à cette URL staging permanente. Les branches n'incluent par défaut ni données ni objets Storage ; leur initialisation reste à préparer. [Documentation Supabase](https://supabase.com/docs/guides/deployment/branching).

Pour Eventflow, deux projets rendent les secrets, les services externes et les destinations de déploiement explicites. La branche persistante serait intéressante ensuite pour automatiser des environnements de PR. Dans les deux cas, vérifier le coût et les capacités du compte au moment de la création. Si l'intégration GitHub Supabase est choisie, configurer les remotes et choisir un seul responsable du déploiement backend : éviter qu'elle et GitHub Actions appliquent simultanément les mêmes changements. [Configuration des branches](https://supabase.com/docs/guides/deployment/branching/configuration).

## 2. Périmètre et niveau de preuve

Audit du code et des références Git disponibles localement, sans modification des services hébergés. Les valeurs secrètes des fichiers d'environnement n'ont pas été reproduites.

- Branche auditée : `dev`, commit `3ae71d5` du 7 août 2026.
- `main` local : `8d6c957` du 18 février 2026 ; les références `origin/*` locales correspondent à ces commits. Aucun fetch n'a été effectué : il faut confirmer l'état distant avant intervention.
- `dev` contient 277 commits supplémentaires ; le diff depuis l'ancêtre commun touche 642 fichiers.
- 28 migrations SQL et 19 Edge Functions sont versionnées sur `dev` ; le dossier `supabase/` est absent du `main` local.
- Aucun workflow `.github/workflows` versionné n'a été trouvé.
- GitNexus ne possède pas d'index pour Eventflow ; l'examen a été effectué directement dans les fichiers.

Ne sont pas vérifiés : sites/contextes et variables Netlify, protections GitHub, schéma réel et historique des migrations Supabase, fonctions réellement déployées, secrets hébergés, jobs cron, réglages Auth/SMTP, configuration Mollie/Billit. Le partage du backend par les fronts hébergés repose sur le contexte fourni par le propriétaire.

## 3. Constats dans le dépôt

### A. Le choix du backend est déjà configurable

`src/shared/gateways/supabase/supabaseClient.ts:3` utilise `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`. Les deux clients créés utilisent ces mêmes paramètres. Il n'est pas nécessaire de refactorer tous les repositories pour raccorder staging.

Le `.env` local pointe vers Supabase local. `.env.prod` contient l'URL du projet hébergé actuel. Ces fichiers ne sont pas suivis par Git. Attention : `npm run build` lance `vite build`, dont le mode par défaut est `production` ; `.env.prod` n'est donc pas chargé automatiquement par ce script. Privilégier des variables injectées explicitement en CI et des exemples sans secrets. [Modes Vite](https://vite.dev/guide/env-and-mode).

### B. Le premier déploiement automatisé de production demande une réconciliation

Les migrations comprennent une migration initiale de plus de 10 000 lignes (`supabase/migrations/20260324133258_remote_schema.sql`) et des évolutions jusqu'en août. Leur présence dans `dev` ne prouve ni leur application ni leur absence dans le backend partagé.

Avant toute automatisation, comparer le schéma réel, l'historique distant des migrations et les fonctions déployées avec le dépôt. Une première PR de séparation ne doit pas déclencher aveuglément le déploiement des 277 commits de `dev` ni rejouer des créations d'objets déjà existants. Le code backend réellement exécuté peut aussi différer des fichiers locaux.

### C. Plusieurs chemins traverseraient encore les environnements

| Emplacement | Constat | Action |
| --- | --- | --- |
| `src/app/modules/admin/widget/components/WidgetPanel.tsx:37` et `:70` | URL du widget et origine `postMessage` fixées à `app.useeventflow.eu` | Utiliser l'origine de l'environnement et conserver une validation stricte des messages |
| `netlify/functions/share-event.js:35` | Repli vers `eventflow-staging.netlify.app` | Rendre `PUBLIC_BASE_URL` obligatoire et propre au site |
| `src/app/modules/admin/dashboard/components/EventTable.tsx:39` | Même repli staging pour les liens de partage | Exiger `VITE_PUBLIC_BASE_URL` |
| `supabase/functions/mollie-connect-callback/index.ts:88` | Repli staging en cas d'erreur OAuth | URL de repli propre à l'environnement |
| `supabase/functions/register-tickets/config.ts:18` et autres fonctions | `FUNCTIONS_URL` configuré indépendamment de `SUPABASE_URL` | Dériver l'URL du projet ou vérifier leur cohérence avant déploiement |
| Migrations SQL, notamment `20260607155412_add_event_charter.sql:618` | Des valeurs par défaut et fonctions SQL pointent vers les fichiers du projet actuel | Ajouter une migration corrective ; utiliser des chemins d'assets ou une configuration par environnement |

Changer uniquement les deux variables Supabase du front ne réalise donc pas l'isolation complète.

### D. Auth, Storage et tâches planifiées ne sont pas entièrement reproductibles

- `supabase/config.toml:150` configure Auth pour `127.0.0.1:3000`, alors que les variables Edge locales utilisent le port `5173`. Ce fichier n'est pas un inventaire fiable des réglages distants.
- Huit fonctions seulement ont un bloc explicite `verify_jwt = false`. Il manque notamment des déclarations pour plusieurs webhooks et le callback OAuth Mollie. Recenser le mode d'authentification de chaque fonction et l'encoder : JWT utilisateur, endpoint public avec validations adaptées, ou secret serveur. Ne pas désactiver globalement l'authentification. Des fonctions déclarées sans vérification JWT plateforme valident déjà l'utilisateur dans leur handler. [Configuration des fonctions](https://supabase.com/docs/guides/functions/function-configuration).
- Les buckets `public-assets` et `invoices` sont utilisés. Des policies Storage sont présentes, mais aucune création de bucket n'a été trouvée dans les migrations inspectées. Recréer les buckets, leurs propriétés et les assets par défaut ; conserver les factures privées.
- `pg_cron` est activé dans la migration initiale. La fonction `expire-orders` existe, mais aucun job `cron.schedule` n'est versionné. Inventorier les planifications réelles et leurs éventuels secrets Vault / endpoints externes.
- `supabase/seed.sql` ne renseigne que le plan `free`. Il ne permet pas de tester l'application de bout en bout.

### E. Les services externes doivent être isolés avec le backend

- **Mollie billetterie** : le mode test dépend de la connexion de l'organisation (`register-tickets/mollie-auth.ts:145`), pas d'un garde-fou global staging. Le callback accepte aussi le mode live. Ajouter un refus serveur des opérations live en staging, y compris aux entrées OAuth, et utiliser des connexions de test.
- **Mollie abonnements** : chemin distinct utilisant `MOLLIE_API_KEY` ; le tester séparément de la billetterie. Garder en production les callbacks/webhooks des paiements et abonnements réels déjà créés.
- **E-mails** : deux circuits existent, Resend (`_shared/mail/mailService.ts`) et un service HTTP défini par `MAIL_SERVICE_URL` / `MAIL_SERVICE_TOKEN` (`send-confirmation-mail/config.ts`). L'implémentation du service HTTP n'est pas dans les fonctions Netlify suivies. Il faut aussi isoler les e-mails Auth/SMTP. Une simple adresse d'expéditeur staging n'empêche pas l'envoi à de vrais destinataires : prévoir une capture ou une liste autorisée côté serveur.
- **Billit / Peppol** : `send-invoice-to-billit/index.ts:857` utilise l'API réelle par défaut. Prévoir une configuration explicite et un mode désactivé ou de test en staging, sans identifiants de production. Ne pas copier l'état ni la numérotation des factures réelles comme données de test.
- **Secrets internes** : générer des valeurs distinctes pour `EDGE_SERVICE_TOKEN`, `CRON_SECRET`, les clés de chiffrement des jetons Mollie et les secrets externes. Ne pas copier les jetons OAuth, utilisateurs, commandes ou abonnements réels vers staging.
- **Turnstile** : configurer les domaines et clés adaptés. Encadrer `TURNSTILE_BYPASS` et interdire son activation en production.

### F. Validation locale actuelle

- `npm.cmd run build` échoue sur `@mdxeditor/editor` et `rehype-raw`, déclarés dans `package.json` mais absents de `node_modules`. Cela ne démontre pas un échec après une installation propre.
- Quatre fichiers de tests unitaires existent. Vitest est déclaré mais absent localement ; la tentative `npx.cmd --no-install vitest run` n'a pas produit de résultat et a été interrompue. Aucun test n'est déclaré réussi.
- Docker n'est pas joignable ; la reconstruction du schéma par les migrations n'a pas été exécutée.
- Aucun code applicatif n'a été modifié par cet audit.

## 4. Plan de mise en œuvre

### Étape 1 — Établir un état initial vérifié

1. Actualiser les références Git et relever les commits réellement publiés sur les deux fronts.
2. Identifier les sites Netlify, leurs branches, contextes, variables et déclencheurs ; relever les protections GitHub.
3. Exporter le schéma applicatif et lire l'historique des migrations du backend actuel. Inventorier fonctions et versions déployées, Auth, SMTP, buckets/policies, Realtime, extensions, cron, Vault, webhooks et noms des secrets.
4. Vérifier la sauvegarde et le processus de restauration de production ; inventorier aussi les objets Storage, qui demandent un traitement distinct.
5. Comparer cet état au dépôt. Réconcilier les migrations historiques seulement après avoir vérifié leurs effets réels ; ne pas marquer artificiellement toutes les migrations comme appliquées.
6. Préparer une PR dédiée pour établir ce socle sur `main`, sans activer encore le déploiement automatique backend et sans y embarquer le refactor applicatif de `dev`.

**Critère de sortie :** chaque objet et réglage nécessaire est soit versionné, soit décrit dans une procédure d'initialisation ; les écarts avec la production sont connus.

### Étape 2 — Rendre le backend reconstructible

1. Rejouer les migrations sur une base locale jetable. Ne jamais utiliser un reset distant de production pour cette opération.
2. Conserver les migrations appliquées comme historique immuable ; introduire des migrations correctives pour les URL et écarts. Si une nouvelle baseline est nécessaire, traiter explicitement la transition des historiques sur chaque environnement, dans un changement séparé.
3. Versionner le manifeste complet des Edge Functions et de leur authentification.
4. Préparer la création des buckets, les fichiers par défaut et les tâches planifiées avec des valeurs propres à la destination.
5. Séparer les données de référence nécessaires en production des fixtures staging. Créer des utilisateurs de test via Auth, une organisation, des événements, des billets gratuits et payants, des codes promotionnels et des scénarios de capacité/expiration.

**Critère de sortie :** reconstruction complète d'un environnement vide et tests des contrats SQL/RPC, des permissions RLS et des fonctions importantes.

### Étape 3 — Créer staging et fermer les chemins vers la production

1. Créer le projet staging, avec une région et une version Postgres cohérentes avec la production.
2. Appliquer le socle, les migrations de `dev`, les fonctions et les paramètres staging.
3. Ajouter les garde-fous Mollie, e-mails, Billit et les contrôles de cohérence d'URL.
4. Configurer Auth : Site URL staging, routes de confirmation et reset, providers éventuels et SMTP de test. Configurer séparément les callbacks Mollie et les domaines Turnstile.
5. Corriger les URL figées du widget, des liens de partage et des assets SQL.
6. Configurer les variables du front staging **et** de la fonction Netlify de partage, puis reconstruire et publier staging.
7. Tester avec les fixtures. Ensuite retirer les anciennes autorisations staging des réglages production lorsque les parcours correspondants ne les utilisent plus.

**Critère de sortie :** les actions staging ne touchent ni le projet Supabase actuel ni les services externes réels. Une commande de test n'existe qu'en staging et ses liens restent en staging.

### Étape 4 — Automatiser la promotion

Mettre en place trois workflows proposés : `ci.yml`, `deploy-staging.yml`, `deploy-production.yml`, éventuellement avec un workflow de déploiement réutilisable. Le schéma `dev → staging`, puis fusion `dev → main → production`, est couvert par le guide officiel [Managing Environments](https://supabase.com/docs/guides/deployment/managing-environments).

**CI sur PR :** installation propre avec le lockfile, compilation, tests unitaires, reconstruction des migrations sur base jetable, tests SQL/RLS et validation des fonctions. Épingler les versions des outils. Définir les contrôles de lint réalistes après mesure de la dette existante.

**Push sur `dev` :** contrôles et build avec variables staging → vérification de la destination → migrations staging → Edge Functions staging → contrôles backend → publication Netlify staging du même commit → tests de parcours.

**Fusion d'une PR approuvée vers `main` :** même chaîne avec les paramètres production. Une approbation seule ne déploie rien : la fusion déclenche la publication. Protéger `main` contre les pushes directs, exiger les checks et une revue valide, et invalider les approbations après nouveaux commits. Le besoin d'un reviewer distinct et la disponibilité des protections doivent être vérifiés pour le dépôt/compte.

Points de conception :

- Environnements GitHub `staging` et `production`, avec secrets et références de projets distincts ; vérifier les droits des identifiants utilisés, pas seulement leurs noms.
- Production accessible uniquement depuis `main`, jamais depuis le code d'une PR non approuvée. Pas de secrets production pour les previews.
- Sérialiser les déploiements par environnement ; ne pas interrompre une migration active lorsqu'un nouveau commit arrive. Empêcher aussi la publication tardive d'un commit plus ancien.
- Références Supabase et identifiants Netlify explicites ; ne pas dépendre du lien local dans `supabase/.temp`.
- Contrôle bloquant des correspondances branche ↔ projet Supabase ↔ URL publique ↔ site Netlify avant toute mutation.
- Un seul orchestrateur décide de publier le front. Désactiver les publications Git Netlify concurrentes ou les conditionner explicitement au succès backend. Un simple build hook asynchrone ne suffit pas comme preuve de succès : attendre et contrôler le résultat.
- Construire avant de migrer afin de détecter les erreurs de compilation avant toute modification distante. Publier seulement après succès du backend.
- Le build staging et le build production utilisent le même code promu, mais sont reconstruits avec leurs variables Vite respectives. Ne pas republier tel quel le bundle staging en production.
- Déployer les migrations et les fonctions ne synchronise pas à lui seul tous les réglages Auth/Storage/cron : leur procédure doit faire partie du processus.
- Ne pas exécuter les fixtures staging en production. Les données de référence requises par le produit suivent des migrations dédiées.

### Étape 5 — Valider une première promotion limitée

Faire passer une petite évolution additive par toute la chaîne. Vérifier le commit publié, les migrations appliquées, les fonctions déployées et les variables de destination. Ensuite seulement, promouvoir le refactor accumulé avec ses tests de compatibilité.

Le rollback n'est pas atomique entre Postgres, les fonctions et Netlify. Utiliser des migrations compatibles avec l'ancien front : ajout d'abord, transition du code, suppression ultérieure. En cas d'échec après migration, conserver l'ancien front compatible et réparer en avant ; restaurer une base est une opération de dernier recours avec impacts sur les données produites depuis la sauvegarde.

## 5. Matrice de configuration minimale

| Couche | Paramètres à isoler |
| --- | --- |
| Build front | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PUBLIC_BASE_URL`, `VITE_TURNSTILE_SITEKEY`, indicateur d'environnement proposé |
| Fonction Netlify de partage | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `PUBLIC_BASE_URL` disponibles à l'exécution |
| Supabase natif | URL et clés propres au projet, fournies par Supabase ; aucune clé `service_role` dans le front |
| Edge Functions | `APP_BASE_URL`, `APP_ALLOWED_ORIGINS`, `CORS_ALLOWED_ORIGINS`, `FUNCTIONS_URL`, `EDGE_SERVICE_TOKEN`, `CRON_SECRET` |
| Mollie | `MOLLIE_API_KEY`, paramètres `MOLLIE_CONNECT_*`, clés `MOLLIE_TOKEN_ENC_*`, callback et garde-fou serveur du mode staging |
| E-mails | `RESEND_API_KEY`, `MAIL_DEFAULT_FROM`, `MAIL_SERVICE_URL`, `MAIL_SERVICE_TOKEN`, capture/liste de destinataires autorisés ; SMTP Auth séparé |
| Billit | `BILLIT_BASE_URL`, `BILLIT_API_KEY`, `BILLIT_PARTY_ID`, informations vendeur, activation explicite |
| Anti-abus | `TURNSTILE_SECRET_KEY`, domaines, contrôle du bypass et du mode debug |
| Déploiement | Identifiants CI Supabase, référence du projet et mot de passe DB ; identifiants Netlify et ID de site adaptés |

Sur Netlify, les variables utilisées par la fonction de partage doivent être disponibles dans le scope Functions, en plus du scope Builds nécessaire à Vite. Les variables définies uniquement dans `netlify.toml` ne sont pas disponibles aux fonctions à l'exécution. Deux sites distincts peuvent chacun appeler leur branche principale « production » dans Netlify : ce libellé n'identifie donc pas à lui seul l'environnement métier. [Variables des fonctions Netlify](https://docs.netlify.com/build/functions/environment-variables/).

## 6. Critères d'acceptation

- Inscription, connexion, déconnexion et réinitialisation de mot de passe restent dans le bon environnement.
- Création d'organisation et d'événement, formulaire, inscription gratuite, commande payante test, confirmation, billet PDF et contrôle de billet fonctionnent en staging.
- Mollie Connect, paiement initial d'abonnement et webhooks sont testés séparément ; une notification répétée ne crée pas de doublons.
- Les buckets sont accessibles selon les bonnes permissions ; les factures restent privées et les assets par défaut viennent de staging.
- Widget, aperçu de partage, retours OAuth et liens d'e-mail restent en staging.
- L'expiration des commandes et la libération de capacité fonctionnent avec un job staging isolé.
- Un utilisateur ne peut pas accéder aux données d'une autre organisation ; un jeton staging ne donne pas accès aux données production.
- Le pipeline refuse une référence production sur `dev`, bloque la publication front si le backend échoue et laisse une trace du commit déployé.
- Une PR approuvée puis fusionnée publie les changements attendus en production sans copier les données staging.
- Aucun envoi d'e-mail à des clients, paiement live ou transmission Peppol réelle ne peut partir de staging.

## 7. Informations à confirmer pour passer à l'implémentation

1. Méthode actuelle de déploiement SQL et Edge Functions : CLI, Dashboard ou intégration GitHub ; source effective du service HTTP d'e-mail.
2. Deux sites Netlify ou deux contextes d'un site ; réglages et variables associés.
3. Historique réel des migrations et fonctions, paramètres Auth/Storage/cron et intégrations du projet actuel.
4. Plan Supabase et protections GitHub disponibles ; personne pouvant approuver les PR de production.

Ordre recommandé : état initial vérifié → reconstruction du backend → staging isolé → CI/CD → première promotion limitée → refactor applicatif.
