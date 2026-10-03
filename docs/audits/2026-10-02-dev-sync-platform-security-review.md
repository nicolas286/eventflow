# Synchronisation de dev et complément d'audit plateforme

Date : 2 octobre 2026. Ancien HEAD : `34cde6d621da43edf15fbda550f3ec48f0c7c4b9`. Nouveau HEAD : `4ef53f40c779b7bdbe65f80630a0d37bc7973574`.

## Résultat de l'intégration

- `git fetch origin`, puis avance rapide de `dev` de 20 commits, sans commit de fusion créé. `HEAD...origin/dev` : 0/0 à la vérification.
- Sauvegarde complète des modifications suivies et fichiers non suivis dans le stash `38c3ddcf5b4cf362712b1b9ff4544025dc45c4c0`, nommé `eventflow-before-dev-sync-2026-10-02-a0-a3`. Sauvegarde conservée, pas de `stash pop` ni suppression.
- Deux conflits à la réapplication, tous deux résolus. Aucun fichier non fusionné restant.
- `docs/deploiements.md` : conservation du comportement distant d'onboarding progressif (plus de limite à un seul utilisateur autorisé), avec correction des caractères mal encodés de ce paragraphe.
- `AdminSignUpPage.tsx` : conservation de la page distante et du libellé local conditionnel « Maintenance » ; import MessageBox unique.
- Les scripts d'inscription et leur test déjà présents à distance sont identiques aux fichiers locaux sauvegardés. Le garde Stripe distant a évolué pour préserver le mapping pilote sans plafonner le nombre d'utilisateurs : cette version distante est conservée, l'ancienne reste dans le stash.
- Les trois migrations A1–A3, trois suites SQL, script d'inventaire, rapports et plan locaux sont restaurés. Aucun fichier métier historique supprimé.

**Aucun push, commit, déploiement, paiement, e-mail ou mutation distante effectué.** Les autres worktrees et la stack locale Eventflow préexistante ne sont pas la cible des opérations d'intégration.

## Ce qui invalide des conclusions de l'ancien audit

1. Le dashboard plateforme existe dans ces commits : `src/app/modules/platform`, `platform-admin`, `platform-config`, contrats et migrations associés. Le constat d'absence à l'ancien HEAD était exact mais incomplet pour le dev distant.
2. `20260930181500_harden_internal_function_privileges.sql` ferme déjà les cinq RPC d'A1 et d'autres RPC internes. La migration A1 locale est redondante mais compatible et conservée. Ne pas créer un troisième correctif identique.
3. Le rapport A0 a observé des ACL production exposées et des ACL staging fermées. Le nouveau code local ne modifie pas cette observation distante et ne prouve pas une publication production. Pas de nouvelle inspection distante dans cette session.
4. Le frontend appelle maintenant 32 RPC distinctes, dont deux nouvelles de conformité vendeur. Les sept tables directes restent présentes. Le helper dynamique plateforme rend l'ancien décompte d'invocations Edge obsolète.
5. Onze Edge Functions locales, contre neuf auparavant. La plateforme dispose déjà d'un quota applicatif et de contrats partagés ; les autres trous de couverture du plan restent à traiter.
6. Redaction des logs centralisée et tests enrichis : ne pas proposer de réimplémenter cette consolidation. Les évolutions de conformité lient davantage les acceptations vendeur/acheteur et les preuves contractuelles.

## Autorisation du dashboard : protections observées

Sources : `supabase/functions/platform-admin/auth.ts:61`, `index.ts:305`, `supabase/migrations/20260930174530_platform_admin_backoffice.sql:234`, `:270`, `:349`.

- Le bearer est validé par Auth avant lecture des claims du même token.
- Registre privé d'administrateurs et présence de la session vérifiés côté serveur, à chaque accès.
- Adresse vérifiée, AAL2 requis pour les données et mutations, TOTP récent pour émettre une preuve renforcée.
- Preuve de step-up liée à l'acteur, session, action et cible, consommée atomiquement et à usage unique.
- RPC internes plateforme non exécutables par les rôles navigateur ; le frontend passe par les Edge.
- Entrées/réponses plateforme validées par contrats partagés ; annonces affichées en texte, sans HTML brut.

**Aucun contournement majeur de cette authentification n'a été identifié dans les chemins examinés.** Cela ne signifie ni absence de défauts, ni audit exhaustif de tous les réglages Auth distants. La plateforme utilise aussi des contrôles SQL serveur ; leur consolidation future vers la cible Edge-only doit rester distincte des correctifs ci-dessous.

## Findings prioritaires

### P1 — Affichage d'une organisation et action sur une autre

Preuves : `src/app/modules/platform/hooks/usePlatformQuery.ts:11–22`, `pages/PlatformOrganizationPage.tsx:13`, `:22`, `:27`, `:32`.

Le hook accepte une réponse tardive sans comparer génération/clé de requête. Navigation A → B, réponse B puis réponse A : l'interface peut afficher A avec l'URL B. Les actions utilisent l'identifiant de l'URL B, tandis que le nom de confirmation provient des données affichées. Un administrateur autorisé peut donc agir sur la mauvaise organisation.

Correctif D1 : invalider les requêtes obsolètes, remettre les données à zéro au changement de clé, lier les caches à la session et bloquer les actions tant que l'ID chargé ne correspond pas à l'ID courant. Test de deux promesses contrôlées résolues dans l'ordre inverse, avec assertion de cible mutation. Scénario établi par source, pas d'exploitation navigateur exécutée.

### P1/P2 — Mutation réussie suivie d'une erreur de formulaire

Preuves : `pages/PlatformOnboardingPage.tsx:35–36`, `pages/PlatformAdminsPage.tsx:17`.

Après une attente asynchrone de confirmation renforcée et mutation, le code utilise `event.currentTarget.reset()`. React remet currentTarget à null après dispatch (confirmé dans le code local react-dom). Le succès backend peut donc être suivi d'une exception UI. L'onboarding renouvelle déjà sa clé d'idempotence et conserve alors les champs ; une nouvelle soumission devient une nouvelle tentative au lieu d'un replay fiable. Le contrôle membership SQL empêche normalement une deuxième création séquentielle : ne pas présenter un doublon comme systématique.

Correctif D2 : capturer le formulaire avant await, gérer reset/succès/clé de manière cohérente ; tests d'interaction différée et erreur réseau ambiguë. Ne pas refaire une mutation déjà réussie pour corriger son affichage.

### P2 — Onboarding concurrent : verrou absent avant contrôles

Preuves : `supabase/migrations/20260930174530_platform_admin_backoffice.sql:1197–1274`.

La ligne d'opération est lue sans FOR UPDATE. Les vérifications de complétion et de membership précèdent l'UPDATE qui verrouille la ligne. Deux appels déjà autorisés peuvent franchir les contrôles, puis le deuxième attendre et poursuivre après le commit du premier sans relecture. **La reproduction à deux connexions a corrigé l'hypothèse initiale de doublon : la contrainte organizations_one_per_creator empêche une seconde organisation.** Le défaut observé est une erreur 23505 au second appel concurrent, au lieu d'un résultat rejoué. Un retry séquentiel retourne bien replayed:true.

Correctif D3 : nouvelle migration verrouillant l'opération avant les contrôles, puis test réel avec deux connexions exigeant succès + replay. L'ancienne migration ne doit pas être éditée. Ne pas supprimer la contrainte d'unicité qui protège déjà l'intégrité.

### P2 — État autorisé et cache conservés lors d'un changement de session

Preuves : `src/app/modules/platform/auth/PlatformAccessGate.tsx:15–27`, `hooks/usePlatformQuery.ts:4–25`.

La garde revérifie l'identité mais ne remet pas son état allowed à loading ; les données de pages ne sont pas liées à la session. Un remplacement d'utilisateur sans démontage peut conserver temporairement un affichage privilégié. Le logout normal recharge la page ; aucun contournement serveur démontré.

Étendre A6/D4 : réinitialisation immédiate, clé identité/session, rejet des réponses tardives. Tester A → B pendant requête et pendant contrôle d'accès.

### P2 — Récupération MFA annoncée mais non implémentée

Preuves : `src/app/modules/platform/auth/PlatformMfaPage.tsx:243–247` ; migration plateforme, branche d'attribution/révocation vers `:1399–1440`.

Retirer puis réattribuer le rôle plateforme ne réinitialise pas le facteur Auth perdu. La consigne UI ne constitue donc pas une procédure de récupération fonctionnelle. Corriger le texte et préparer un runbook contrôlé, vérifié sur compte synthétique et audité ; ne pas ajouter un contournement MFA improvisé.

### P2 — Livraisons de campagne en échec sans reprise

Preuves : `supabase/migrations/20260930211708_platform_admin_communications.sql:340–383`.

Seules les livraisons pending sont sélectionnées ; une erreur les passe en failed, qu'un nouvel appel avec la même clé ne sélectionne plus. La présence d'une clé d'idempotence prestataire ne suffit pas à fournir une reprise. Définir retry borné/observabilité et tests échec puis retry, sans doubler les envois réussis.

### P2/P3 — Versions légales dupliquées

Sources : `shared/legal/documents.ts:2–7`, `src/app/modules/admin/organization/data/sellerComplianceRepo.ts:27–30`, `auth/data/authRepo.ts:54`, pages de checkout et `shared/schemas/organization-sales-terms.ts:5`.

Les valeurs correspondent aujourd'hui, mais des dates littérales distinctes sont transmises alors que les documents affichés ont des constantes communes. Au prochain changement, l'acceptation peut viser une autre version. Réutiliser les constantes et tester version affichée/version envoyée/version attendue côté serveur ; les tests répétant les mêmes littéraux ne suffisent pas.

## Couverture et autres limites

- Les tests SQL baseline vérifient les grants et catalogues plateforme ; ils ne constituent pas une suite métier complète de consommation step-up, révocation, concurrence et campagnes.
- Les tests Deno plateforme simulent Auth/RPC. Ajouter les scénarios SQL réels d'expiration, replay, action/cible/session étrangère et concurrence des mutations.
- `auth.admin.inviteUserByEmail` dans platform-admin utilise le circuit Auth, distinct de MAIL_MODE=capture. Aucune invitation n'a été envoyée pendant cette revue ; les futures recettes doivent employer Auth local/staging adapté.
- L'audience organizer de platform-config est sélectionnable anonymement : c'est un filtre d'affichage, pas un contrôle de confidentialité.
- L'index GitNexus ne couvrait pas ce dépôt lors de l'audit initial. Cette actualisation repose sur le diff exact, les sources et les tests ; aucune preuve de graphe/PDG revendiquée.
- Revue ciblée des 114 fichiers du delta par surfaces sensibles, pas certification exhaustive de toutes les fonctions historiques ou de la production.

## Validation d'intégration

- `npm test` : 121 tests Vitest et 16 tests Node réussis.
- `npm run test:backend` : 136 tests réussis.
- `npm run check:backend` et `npm run lint:backend` : réussis, 182 fichiers vérifiés au lint.
- `npm run build` : réussi ; avertissement de chunk JS de 3,06 MB minifié, sans lien avec les permissions SQL.
- Rejeu de **54 migrations** dans une base Supabase jetable distincte ; **neuf suites SQL** réussies après correction de la fixture A3.
- Concurrence réelle de public.platform_admin_mutate(..., 'organizations.onboard', ...) : premier appel replayed:false, second erreur 23505 organizations_one_per_creator, retry séquentiel replayed:true. Aucun doublon observé ; défaut de replay concurrent confirmé.
- Première exécution A3 : EVENT_REGISTRATION_CLOSED. Les nouveaux commits initialisent les inscriptions fermées. Ajout dans `tests/database/product-system-columns.sql:2–3` de l'ouverture dans la transaction de fixture annulée. Aucun changement du garde serveur ni des assertions ; seconde exécution du fichier exact réussie.
- `git diff --check` réussi, aucun conflit restant, changements locaux non commités.
- Base jetable et volumes supprimés après validation ; les onze conteneurs de la stack Eventflow préexistante restent actifs. Logs synthétiques conservés dans le dossier temporaire eventflow-dev-integration-4ef53f4-20261002.

Les résultats de l'ancien rapport A0–A3 restent conservés tels quels avec leur ancien HEAD. Le plan principal contient désormais une table de statut distinguant intégré dans dev, fait localement, à publier et à faire. A1 additive est gardée pour préserver le travail ; sa suppression éventuelle serait un nettoyage séparé, pas une condition d'intégration.

## Décision

Intégration locale effectuée et validations de compatibilité réussies. **Corrections plateforme D1–D5 à planifier**, avec D1/D2 avant de considérer les actions sensibles UI fiables. L'autorisation serveur examinée possède les protections attendues, mais les défauts de cible et de reprise ont un impact métier réel.

**Aucune résolution production revendiquée. Aucun déploiement effectué.**
