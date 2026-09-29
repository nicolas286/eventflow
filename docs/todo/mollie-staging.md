# TODO — Configurer Mollie sur staging

**Statut : configuration et parcours nominaux validés en test le 20 septembre 2026 par le propriétaire : Mollie Connect, paiement de billets et souscription.** Les contrôles complémentaires non confirmés restent ouverts ci-dessous. Ne pas remplacer la connexion OAuth ou les secrets de production.

## Deux circuits distincts

| Usage | Configuration |
| --- | --- |
| Abonnements des organisateurs à Eventflow | `MOLLIE_API_KEY=test_…` dans Supabase staging |
| Paiements de billets pour une organisation | Application Mollie Connect OAuth, puis connexion de cette organisation en mode test |

Une clé API de test seule n'active donc pas la billetterie dans l'architecture actuelle.

## Préparation OAuth billetterie

- [x] Configurer l'application Mollie Connect utilisée par staging ; connexion validée par le propriétaire. Une application dédiée reste la convention recommandée de séparation.
- [x] Enregistrer exactement ce callback dans Mollie (vérifié dans l'URL d'autorisation, puis connexion confirmée) :

```text
https://cpcmcxerrsnnjncrhldr.supabase.co/functions/v1/mollie-connect-callback
```

- [x] Configurer ces secrets sur le projet **eventflow-staging** (`cpcmcxerrsnnjncrhldr`) — création confirmée par le propriétaire :

```dotenv
MOLLIE_CONNECT_CLIENT_ID=<application-staging>
MOLLIE_CONNECT_CLIENT_SECRET=<secret-application-staging>
MOLLIE_CONNECT_REDIRECT_URI=https://cpcmcxerrsnnjncrhldr.supabase.co/functions/v1/mollie-connect-callback
MOLLIE_CONNECT_SCOPES=organizations.read profiles.read payments.read payments.write
```

- [x] Déterminer les scopes depuis les appels réels : `organizations.read profiles.read payments.read payments.write`, séparés par des espaces ; valeur vérifiée dans l'URL d'autorisation staging.
- [x] Utiliser les secrets Supabase, jamais des variables `VITE_*` — configuration confirmée par le propriétaire. Le modèle est dans [deploy/staging-functions.env.example](../../deploy/staging-functions.env.example).

Le bootstrap a déjà créé une clé de chiffrement staging indépendante (`MOLLIE_TOKEN_ENC_KID_ACTIVE`, `MOLLIE_TOKEN_ENC_KEYS_JSON`) et les secrets internes. Ne pas les remplacer par ceux de production : ils servent à conserver les jetons OAuth du staging.

Pour appliquer un fichier de secrets local ignoré, après vérification du contenu et de la cible :

```sh
supabase secrets set --project-ref cpcmcxerrsnnjncrhldr --env-file .local/mollie-staging.env
```

Ne pas utiliser directement le fichier d'exemple rempli de placeholders et ne pas versionner le fichier réel.

## Connexion et recette

- [x] Autoriser `https://eventflow-staging.netlify.app` dans `public.allowed_return_origins` avec `is_enabled=true`, en complément des secrets `APP_ALLOWED_ORIGINS` et `CORS_ALLOWED_ORIGINS`. Correction effectuée sur staging le 20 septembre 2026 : la table était vide et la RPC refusait `return_base_url`. Vérification avec le compte synthétique : `mollie-connect-start` retourne HTTP 200, une URL Mollie en mode test, le callback staging et les quatre scopes attendus. L'autorisation chez Mollie et le paiement ont ensuite été confirmés par le propriétaire.

Pour reconstruire le staging, exécuter ce seed de configuration **uniquement dans le projet staging** (`cpcmcxerrsnnjncrhldr`) :

```sql
insert into public.allowed_return_origins (origin, is_enabled)
values ('https://eventflow-staging.netlify.app', true)
on conflict (origin) do update set is_enabled = excluded.is_enabled;
```

Cette origine dépend de l'environnement : ne pas ajouter ce seed staging à une migration commune qui serait appliquée en production.

- [x] Lancer Mollie Connect depuis [le front staging](https://eventflow-staging.netlify.app) en **mode test** et terminer la connexion — confirmé par le propriétaire.
- [x] Passer une commande et effectuer un paiement de billet en test — confirmé par le propriétaire.
- [ ] Compléter les preuves de traitement : webhook vers staging, état de commande, billet/PDF et contenu de l'e-mail capturé dans le bucket privé `mail-previews`. La confirmation « paiement fonctionne » ne détaille pas ces contrôles.
- [ ] Vérifier aussi annulation, paiement échoué et réception répétée du webhook, sans émission répétée injustifiée de billets/e-mails.
- [ ] Tester le renouvellement OAuth après expiration du jeton d'accès. Le callback initial et les trois chemins de renouvellement doivent utiliser le même `redirect_uri`.
- [ ] Confirmer qu'aucune requête de ce parcours ne cible Supabase prod et qu'aucun paiement live ni e-mail réel n'a été produit.

Les restrictions staging restent actives. Ne pas modifier `APP_ENV` ou supprimer les gardes pour faire réussir une recette. Une nouvelle connexion doit produire ses propres jetons ; ne pas copier ceux d'une organisation production.

## Abonnements Eventflow — recette séparée

- [x] Ajouter `MOLLIE_API_KEY=test_…` au projet Supabase staging — secrets créés par le propriétaire.
- [x] Effectuer une souscription en mode test — fonctionnement confirmé par le propriétaire.
- [ ] Consigner les états d'abonnement et les callbacks observés pour cette souscription.
- [ ] Vérifier les limites du plan côté serveur et le comportement d'annulation.

La clé de test couvre ce circuit d'API, mais ne remplace ni la configuration des URL ni la recette complète.

## Preuves à conserver

### Déconnexion après session QA révoquée — 20 septembre 2026

Le script de vérification Connect utilisait une déconnexion globale du compte QA, susceptible de révoquer la session du testeur. Le script local utilise désormais `scope: 'local'`.

Le bouton applicatif attendait l'appel Supabase sans limite, ne traitait pas son erreur et laissait le second stockage de session en place. Le correctif centralise la déconnexion : tentative de révocation distante comme auparavant, attente maximale de cinq secondes, suppression des seules clés Auth du projet dans `localStorage` et `sessionStorage`, puis rechargement de `/admin/login` pour éliminer l'état en mémoire. Si le serveur ne répond pas, la révocation distante n'est pas garantie, mais le navigateur quitte sa session. Un échec du nettoyage local affiche une erreur et permet de réessayer.

Tests automatisés : succès, erreur de session révoquée, rejet réseau et appel bloqué ; les préférences et clés d'autres projets sont conservées. Recette navigateur restante après publication staging : session expirée → déconnexion → connexion dans la même fenêtre → nouvelle tentative Mollie Connect.

Date, projet cible, identifiants de commandes de test, statut des webhooks, résultat du renouvellement et PR éventuelle. Aucun secret, jeton OAuth ou booking token dans la documentation.

Références : [Mollie Connect OAuth](https://docs.mollie.com/docs/authentication-via-oauth), [renouvellement des jetons](https://docs.mollie.com/reference/oauth-generate-tokens), [incident corrigé](../incident-mollie-refresh-2026-09-15.md).
