# Incident Mollie — Souper sur la baie — 15 septembre 2026

## Périmètre et méthode

Diagnostic demandé après une erreur `ORG_TOKEN_REFRESH_FAILED` sur une commande payante du site production. Consultation des logs Supabase et des métadonnées SQL, comparaison du code réellement déployé avec l'export réalisé avant la séparation staging. Aucun appel de renouvellement, paiement ou reconnexion Mollie déclenché pendant ce diagnostic ; aucun changement de code applicatif ni de données de production.

## Faits observés

- PR #181 fusionnée à 15:42:41 UTC ; déploiement production GitHub Actions réussi, run `34990265915`.
- Dernière tentative retrouvée sur l'événement original : commande de 20 EUR créée à 15:58:26 UTC (17:58:26 Bruxelles), erreur à 15:58:31 UTC.
- Requête interne : `658d16cd-8b8e-4ad8-a055-dbd9a009f94c`.
- Connexion de l'organisation marquée `connected`, mode Mollie **test**, jetons chiffrés présents. Dernière mise à jour le 7 août 2026 à 15:00 UTC ; expiration du jeton d'accès à 16:00 UTC ce même jour.
- Les deux commandes récentes retrouvées sur l'événement original sont en `awaiting_payment`, sans ligne de paiement associée. D'autres tentatives apparaissent aussi dans les logs pour cette période ; elles ne sont pas toutes attribuées à cet événement original dans ce diagnostic.

## Chaîne d'exécution confirmée

1. `register-tickets` crée la commande.
2. `getValidOrgMollieAccessOrThrow` lit la connexion de l'organisation, vérifie les champs et déchiffre les deux jetons.
3. Le jeton d'accès expiré déclenche `refreshMollieAccessToken`.
4. `POST https://api.mollie.com/oauth2/tokens` retourne un statut non réussi.
5. Le code l'encapsule en erreur applicative HTTP 502 `ORG_TOKEN_REFRESH_FAILED` ; la création du paiement n'est pas atteinte.

Le 502 est le statut **Eventflow**, pas nécessairement celui renvoyé par Mollie. L'expiration normale du jeton d'accès n'explique pas à elle seule l'échec : le refresh token doit permettre son renouvellement.

## Lien avec la séparation staging

Le corps du rafraîchissement dans la fonction déployée est identique à celui exporté avant la PR. Les seuls ajouts dans `mollie-auth.ts` sont l'import et l'appel du garde-fou de mode staging. Ce garde-fou n'est pas l'erreur observée : le flux atteint l'appel OAuth Mollie.

Cela exclut un blocage direct par le garde-fou staging pour cette tentative, sans suffire à prouver l'absence de tout problème de configuration externe.

## Limite du diagnostic et piste concrète

La réponse d'erreur Mollie est conservée dans `ResponseError.details`, puis perdue pour l'observation : `createEdgeHandler` ne journalise que le code Eventflow et son statut. Les logs existants ne permettent donc pas de distinguer un refresh token révoqué, un client OAuth refusé, un paramètre manquant ou un autre refus du prestataire.

Le callback OAuth envoie `redirect_uri` lors de l'échange initial, mais le rafraîchissement ne l'envoie pas. La [documentation Mollie](https://docs.mollie.com/reference/oauth-generate-tokens) indique que ce paramètre est requis au rafraîchissement s'il était fourni initialement. C'est une non-conformité concrète à vérifier/corriger, **pas encore le motif démontré du refus observé**. Le rafraîchissement du webhook de billetterie doit aussi être examiné pour la même omission.

## Suite proposée

- Ajouter une journalisation ciblée du statut HTTP Mollie et de son code d'erreur, sans jetons, secrets, données acheteur ni retour brut au navigateur.
- Aligner les requêtes de renouvellement sur le `redirect_uri` configuré, avec des tests de requête simulée.
- Tester sur staging avec une connexion Mollie de test séparée, puis promouvoir le correctif selon le circuit de PR.
- Si Mollie confirme `invalid_grant`, examiner l'autorisation de cette organisation et sa reconnexion ; ne pas révoquer ni remplacer à l'aveugle les connexions existantes.

Le diagnostic ne réalise aucune de ces mutations. Le détail du refus Mollie demeure inconnu à ce stade.

## Correctif ciblé autorisé

Le propriétaire a demandé de corriger l'hypothèse `redirect_uri`, de pousser sur `dev`, puis de fusionner cette modification limitée sur `main`.

- Ajout du `MOLLIE_CONNECT_REDIRECT_URI` configuré au corps des requêtes de renouvellement dans `register-tickets`, `mollie-webhook-tickets` et `mollie-webhook`.
- Aucune requête OAuth envoyée si cette configuration est absente ou vide, comme pour les identifiants OAuth manquants.
- Tests exécutant les trois helpers réels avec un transport simulé : URL de callback conservée, encodage correct et absence d'appel avec une configuration incomplète.
- Aucun changement de schéma, de connexion Mollie ou de journalisation dans ce correctif. L'hypothèse restera à confirmer sur une tentative métier après déploiement.
