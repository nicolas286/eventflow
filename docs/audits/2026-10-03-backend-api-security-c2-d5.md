# C2 puis D1–D5 — livraison locale

Branche `dev`, HEAD `4ef53f40c779b7bdbe65f80630a0d37bc7973574`. Diff antérieur conservé. Aucun commit, push, merge, déploiement, mutation distante, paiement ou e-mail client. GitNexus Eventflow indisponible : sources/appelants et tests utilisés, sans réaudit global.

| Lot | Changements et preuves |
| --- | --- |
| C2 | `readPublicOrder.ts` partagé par `OrderPage` et le widget : contrat `orders-read`, cache désactivé, identité vérifiée, `cancelled` normalisé en `canceled`. Markdown ignore l’HTML brut ; titres, liens, listes, tableaux, emphase et retours conservés. Suppression de `rehype-raw` et des deux conversions récursives orphelines. `platform-admin/transport.ts` mappe uniquement les collections SQL connues ; métadonnées JSON intactes. Architecture/TODO actualisés, recette Mollie archivée. |
| D1 | `PlatformOrganizationPage` verrouille statut, plan et propriétaire si chargement/erreur/identité différente de l’URL. Générations et isolation session de `usePlatformQuery` déjà livrées conservées. Tests de réponses B puis A et des trois cibles exactes. |
| D2 | `PlatformOnboardingPage` / `PlatformAdminsPage` capturent le formulaire avant attente. Tests différés : reset, absence de faux échec, clé conservée jusqu’au succès. Suppression des casts d’erreurs dans les pages touchées. |
| D3 | Migration nouvelle `20261003190000_platform_onboarding_atomic_replay.sql` : verrou d’opération avant completed/membership ; insertion d’autorisation avec `ON CONFLICT` puis verrou. Acteur, hash, session, step-up et unicité conservés. Concurrences réelles sur l’autorisation initiale et la mutation : deux succès, une organisation, un audit. |
| D4 | Gate/caches préexistants revalidés par tests contrôlés A→B sans fuite. Consigne MFA corrigée. [Procédure](../runbooks/platform-mfa-recovery.md) vérifiée avec Auth local : invitation SMTP Mailpit, TOTP réel, réattribution sans récupération, révocation globale, suppression ciblée, refresh refusé puis nouveau TOTP AAL2. Tests SQL réels expiration, autre action/cible/session, admin révoqué, consommation concurrente et replay. |
| D5 | Migration nouvelle `20261003191000_platform_campaign_retry.sql` : création de campagne sérialisée par clé, claims atomiques, token de bail, bornes et audit par tentative. Finalisation sérialisée avec claims/completions. Front conserve payload et clé tant que campagne incomplète ; retry explicite requiert un nouveau step-up, reprend les seules livraisons éligibles. Versions juridiques communes dans signup, accords vendeur, paiement page/widget, validation Edge et pages légales. Typage des deux pages paiement corrigé sans changement des branches de paiement. |

## Contrats, permissions et transactions

Les routes plateforme existantes conservent JWT vérifié, session active, administrateur, AAL2, quotas et step-up lié acteur/session/action/cible. Aucun endpoint/table/RPC générique ajouté. Client service existant conservé ; aucun grant `authenticated` ajouté. Les RPC onboarding et campagnes restent fermées à `PUBLIC`, `anon`, `authenticated`, prouvé avec `SET ROLE` réel. Les politiques ne sont pas supprimées dans ce lot.

Les transactions SQL portent les locks et mises à jour ; l’envoi prestataire reste hors transaction et garde `platform-email/<campagne>/<livraison>`. Trois claims maximum, une minute après un échec, reprise d’un bail expiré après dix minutes, fenêtre de 23 heures depuis la première tentative. Le nom destinataire est figé au premier claim. Les anciens attempts prennent leur date de création comme borne conservatrice ; leur fenêtre n’est pas renouvelée. Au-delà des bornes, pas de nouvel envoi automatique : intervention opérateur et rapprochement fournisseur nécessaires.

La limite est inférieure à la [rétention de 24 heures des clés Resend](https://resend.com/changelog/idempotency-keys). Un ancien worker ne peut finaliser un nouveau bail. L’ancien `platform_admin_record_email_delivery` est révoqué pour service_role et remplacé par un refus sans effet ; même le grant service global différé B6 ne réactive pas son écriture. Tests de concurrence sur création/claim, cooldown, failed→sent, exclusion sent, limite de tentatives/durée, anciens tokens et audit. L’idempotence prestataire est testée par erreurs 503 puis succès simulés avec la même clé ; aucun Resend réel contacté.

## Validation

- Replay des **67 migrations** dans `supabase_db_eventflow-security-b6-20261003`, sans seed, projet isolé et ports 584xx ; aucune migration ancienne modifiée. Douze suites SQL racine réussies.
- `node tests/database/platform-corrections.checks.mjs supabase_db_eventflow-security-b6-20261003` : réussi, vraies connexions concurrentes et rôles `service_role`/`anon`/`authenticated`, fixtures nettoyées. Ajout au job SQL CI.
- `node tests/database/edge-boundary.checks.mjs supabase_db_eventflow-security-b6-20261003` : réussi, fermeture B6 et droits réels sans RLS, défauts futurs, vues, GraphQL, Realtime.
- `node tests/integration/platform-mfa.local.mjs node_modules/.cache/eventflow-security-b6` : réussi, Auth/MFA/SMTP réels locaux, utilisateurs et messages synthétiques supprimés.
- `check:backend`, `lint:backend` : réussis, 223 fichiers ; `test:backend` : **409 tests réussis**.
- `npm test` : **524 Vitest + 19 Node réussis** ; `npm run build` : réussi, avertissement habituel de bundle supérieur à 500 kB.
- ESLint ciblé, `check:browser-boundary`, `git diff --check` : réussis. Aucun lint frontend global revendiqué.
- Stack jetable arrêtée sans sauvegarde après validation ; conteneur Vector orphelin supprimé explicitement. La stack `eventflow-front` est préservée.

Limites : hooks/formulaires et contenu Markdown testés avec cycles contrôlés/rendu React HTML, sans recette visuelle navigateur ni comparaison de pixels. La concurrence SQL onboarding ne prouve pas deux invitations Auth simultanées de bout en bout ; l’invitation a un test séparé de transport réel local. La procédure MFA n’atteste ni une récupération hébergée ni la vérification humaine d’identité. Les reprises de campagne exigent la même clé et le payload inchangé ; le formulaire les conserve dans l’onglet courant, sans ajout d’une reprise persistante de l’historique après rechargement. Les modèles d’e-mail doivent rester stables pendant la fenêtre de reprise, faute de quoi Resend peut refuser le payload avec cette même clé.

## Publication et relecture

C2/D1/D2 et l’affichage juridique sont compatibles avec les contrats actuels. D3 s’applique par nouvelle migration avant l’Edge existante ; elle conserve ses signatures. **D5 exige une bascule coordonnée** : suspendre les envois de campagnes, laisser les handlers précédents se terminer, appliquer la migration de claim/completion et publier la nouvelle Edge `platform-admin`, puis reprendre les campagnes et publier le frontend. L’ancienne Edge appelle le writer désormais refusé ; une migration appliquée seule casserait les campagnes. Tester cette transition sur staging avant autorisation de publication. Respecter séparément les préconditions B0–B6 des révocations navigateur différées, qui exigent le nouveau frontend et, pour certains objets, le propriétaire géré.

À relire : locks onboarding/autorisation, serialization des finalisations de campagne, paramètres de reprise et borne historique, neutralisation du writer après fermeture B6, récupération MFA et transport Auth distinct de la capture métier. La revue automatique a refusé un diagnostic susceptible d’afficher les messages SMTP complets ; diagnostic remplacé par les seules métadonnées/counts, aucun jeton affiché. Aucun blocage d’implémentation restant ; aucune publication effectuée.
