# A6 — Persistance et isolation des données de session

Date : 2 octobre 2026. Branche `dev`, HEAD `4ef53f40c779b7bdbe65f80630a0d37bc7973574`, inchangé pendant le correctif.

**Implémenté et testé localement. Non déployé. Recette navigateur incomplète.** Aucun push, merge, commit, déploiement, appel Supabase distant, paiement, e-mail ou donnée client utilisé pour ce lot. Aucun changement des permissions serveur ni nouvelle dépendance.

## Périmètre et revalidation

Les AGENTS racine, frontend et Supabase, le plan et le complément d'audit ont été lus. Les sources A6 et leurs consommateurs ont été revérifiés au HEAD courant. Le défaut était présent : `authRepo.signIn` utilisait le client sessionStorage puis copiait sa session dans le client localStorage avec `setSession`.

Les protections D1/D4 de génération, clé d'identité et remise à zéro de la garde n'étaient pas présentes au démarrage dans `usePlatformQuery` et `PlatformAccessGate`. A6 corrige leur partie session/cache et protège aussi le changement de clé organisation du hook partagé. Cela ne clôture pas D1 (contrôle de cible des mutations) ni D4 (runbook récupération MFA et tests SQL serveur).

Le diff préexistant (`AdminSignUpPage`, déploiements, A0–A3 et documents non suivis) est conservé. Des travaux parallèles A4/A5/A7 sont apparus pendant l'exécution : ils ne sont pas des modifications de ce lot. Seule la ligne de statut et la note d'exécution A6 du plan sont mises à jour ici.

GitNexus ne dispose d'aucun index `eventflow-front` dans cette session. `eventflow-site` et Nexora ne sont pas utilisés comme preuve. Tracé par `rg`, lecture des sources et tests. Le helper de lecture ancrée de `gitnexus-work` refuse Windows faute de primitives de fichiers compatibles ; aucun reçu de provenance généré n'est revendiqué. Les consignes explicites de travail local et de mise à jour du statut priment sur les étapes de branche/commit et l'interdiction générique de modifier le plan du skill.

## Comportement livré

- Un unique client Supabase pour Auth, RPC, Edge, Storage, récupération et MFA. `supabaseSession` et la recopie de session sont supprimés.
- `authStorage` conserve les clés canoniques existantes du projet. Le choix de persistance est propre à l'onglet, dans sessionStorage. Une connexion non mémorisée n'écrit aucun jeton dans localStorage, y compris au refresh et après MFA.
- Avant une nouvelle connexion, les anciens jetons persistants et les auxiliaires du projet sont supprimés, puis un logout SDK local sans session stockée invalide l'UI avant la requête de connexion. Une erreur de connexion ne restaure pas l'ancien compte. Une réponse de refresh de la session remplacée ne peut plus réécrire le stockage.
- Une connexion mémorisée écrit dans localStorage et conserve un miroir d'onglet. Un nouvel onglet peut la restaurer. Les sessions localStorage historiques restent restaurables tant qu'un nouveau choix de connexion ne les remplace pas.
- La connexion plateforme, sans case « rester connecté », passe explicitement par la connexion non persistante. Une inscription/récupération sans session préalable utilise également le mode d'onglet par défaut. Une récupération dans un onglet existant conserve son mode. Aucun nouveau proxy Auth ou gestionnaire d'état.
- Les notifications Supabase utilisent un canal unique par instance : une notification de connexion d'un autre onglet ne peut pas changer l'AuthProvider tout en laissant les requêtes sur l'ancienne identité. Les clés de stockage réelles restent stables. Le verrou SDK navigateur utilise la clé canonique du projet lorsque Web Locks est disponible.
- L'AuthProvider refuse un bootstrap dépassé par un événement Auth, ainsi qu'un résultat d'un effet démonté/rejoué. Son logout vide immédiatement utilisateur/session et ignore les notifications suivantes pendant la sortie. Le nettoyage final reste borné à cinq secondes, supprime les jetons et auxiliaires des deux stockages, bloque toute écriture SDK tardive et conserve la redirection existante `/admin/login`.
- La clé de cache est `user.id + session_id`, sans jeton dans la clé. Les claims décodés servent seulement à l'invalidation UI, jamais à accorder une permission serveur. Un refresh de la même session garde cette clé stable.
- Le sous-arbre organisateur est lié à la session ; le store existant est recréé vide lors d'un changement de session. Désabonnement et générations refusent les réponses/erreurs tardives, y compris entre refetch concurrents. Un bootstrap obsolète ne lance pas la lecture d'événements. Une réponse overview d'une autre organisation est refusée.
- Le bootstrap organisateur choisit actuellement l'organisation côté serveur, sans sélecteur d'organisation frontend. Un refetch explicite vide les données avant de résoudre cette organisation ; les pages enfants sont liées à son ID. Un simple refresh Auth ne déclenche pas ce refetch.
- `usePlatformQuery` masque immédiatement les données dont la clé session/organisation n'est plus courante, refuse les résultats tardifs et les anciens callbacks reload. Le chargement/error/retry sont conservés. Il n'accumule plus de loaders pour les anciennes organisations.
- La garde plateforme est remontée vide au changement de session ou de niveau MFA : aucun état `allowed` de A pendant la vérification de B. Un refresh au même niveau MFA conserve la garde et les données.

### Deux onglets : contrat explicite

1. Deux onglets mémorisés de la **même session** peuvent lire les nouveaux jetons de cette session ; aucun échange automatique de sessions différentes.
2. Une nouvelle connexion B dans un onglet ne remplace pas l'identité A de l'autre. Le dernier choix mémorisé détermine la restauration des futurs onglets. Un ancien onglet dont la session mémorisée a été remplacée/supprimée continue en stockage d'onglet et ne peut plus persister ses refreshes.
3. Une connexion B non persistante efface la restauration partagée de A. B reste uniquement dans son onglet. Les autres onglets gardent leur identité propre jusqu'à leur sortie, invalidation Auth ou fermeture.
4. Le logout conserve la tentative de révocation globale existante, puis efface la persistance partagée et l'onglet courant. Il n'envoie pas de session à un autre onglet et ne force pas une redirection inter-onglets. Les autres onglets peuvent conserver des données de **leur propre** identité jusqu'à une invalidation Auth/rechargement ; aucune garantie de logout visuel simultané n'est revendiquée.
5. La duplication/restauration d'onglet peut copier sessionStorage selon le navigateur. La fermeture et la restauration réelle du navigateur restent à vérifier ; ce correctif garantit l'absence de jetons localStorage pour le mode non mémorisé, pas une révocation serveur à la fermeture.

## Validation exécutée

| Vérification | Résultat et portée |
| --- | --- |
| Huit fichiers ciblés Auth/stockage/store/plateforme/logout/MFA | **33 tests réussis** |
| `npm test` | **148 tests Vitest, 16 tests Node réussis**, avec les travaux parallèles présents dans le checkout |
| `npm run build` | **Réussi** ; avertissement existant de chunk JS d'environ 3,07 MB minifié |
| ESLint de tous les fichiers source et tests A6 touchés | **Réussi**, aucune suppression ajoutée |
| `git diff --check` | **Réussi** |
| Test discriminant garde contre le fichier à HEAD | **Deux échecs attendus** : contenu privilégié conservé au changement d'identité/MFA ; fichier corrigé restauré, tests ensuite réussis |

Fichiers de tests : `authSessionStorage`, `authRepoPersistence`, `authProviderSession`, `adminDashboardSession`, `platformSessionCache`, `platformAccessSession`, `signOutFromBrowser`, `platformMfaEnrollment` dans `tests/unit/shared/*.test.ts`.

Les tests stockage utilisent le **SDK Supabase installé** avec transport Auth synthétique : signIn, getSession, refreshSession, challengeAndVerify et signOut. Les stockages sont des Maps. Ils prouvent les lectures/écritures et le routage des sessions ; ils ne prouvent pas une fermeture de navigateur, Web Locks réels ou la validité de facteurs MFA distants.

Les tests des hooks/garde/provider pilotent les effets et états React de façon contrôlée ; la garde/provider utilisent aussi le rendu HTML React. Ils prouvent masquage immédiat, clé stable au refresh, rejet de réponse/erreur A après B, génération de refetch et bootstrap périmé. Ils **ne sont pas** des tests React montés dans un navigateur, ni une preuve de l'ordonnancement réel du navigateur.

Tracé des parcours : formulaire organisateur → authRepo → singleton ; connexion plateforme → même repo → MFA ; vérification MFA et changement de mot de passe → même singleton ; AdminAppShell/PlatformLayout/garde → AuthProvider.signOut. La navigation historique `TopNav` appelle authRepo mais aucun rendu de ce composant n'est trouvé dans les sources courantes (imports de type seulement). La suppression de compte conserve son appel SDK/logout et sa navigation existants, sans mutation de fixture distante.

## Recette restante et revue

**Revue du correctif local : PASS sur le périmètre A6 ; VALIDATION INCOMPLÈTE pour la recette navigateur.** Aucun contenu privilégié conservé par la garde dans les scénarios contrôlés, aucune permission métier serveur modifiée. Les protections de cible mutation D1 et les autres sujets D4 restent séparés.

L'outil navigateur ne propose aucun navigateur dans cette session (tentative Chrome puis inventaire vide). À exécuter avec comptes synthétiques et Auth local/staging, lors d'une recette autorisée :

- Login non mémorisé, inspection des clés, rechargement de l'onglet, fermeture réelle et nouvelle ouverture, puis restauration de session du navigateur.
- Login mémorisé, fermeture/nouvelle ouverture et restauration ; A mémorisé → B non mémorisé → aucun A restauré dans un nouvel onglet.
- Deux onglets A/A puis A/B : refresh réels, verrou SDK, logout avec et sans réseau, absence de mélange d'identités ; vérifier le contrat ci-dessus.
- Requêtes A ralenties pendant B connecté/logout ; navigation organisation A → B avec ordre de réponses inversé ; aucune ancienne donnée visible.
- Admin plateforme A autorisé → B non autorisé : contenu retiré dès le changement, puis refus. Refresh de la même session : pas de rechargement permanent.
- MFA enroll/challenge/step-up réels et récupération de mot de passe ; inspection du stockage après élévation et logout. Les effets prestataires restent exclus.

**Aucune fermeture réelle de navigateur testée. Aucun déploiement effectué. Aucune résolution production ou certification de toute la sécurité du dashboard revendiquée.**
