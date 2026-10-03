# A7 — Entrées HTTP Stripe et bypass CAPTCHA

Date : 2 octobre 2026. **Implémenté et testé localement, sans déploiement.** Branche `dev`, HEAD `4ef53f40c779b7bdbe65f80630a0d37bc7973574`. Verdict de revue du périmètre A7 : **PASS local**.

## Périmètre et état de départ

Lecture des instructions racine, frontend, backend, architecture, produit, exploitation, sécurité, tests négatifs et revue. Les trois handlers Stripe utilisaient encore `req.json()`/`req.text()` sans limite applicative. Le lecteur `_shared/app/request-body.ts` existait déjà et comptait les octets du flux ; il est réutilisé sans second mécanisme et sans modification de son implémentation.

Le diff initial contenait notamment A4, les migrations A1–A3 et les documents d'audit. Des travaux A5/A6 sont apparus pendant cette intervention : ils ont été conservés. Les suppressions des anciens arguments de confirmation `functionsBase`/`edgeServiceToken` dans le webhook et de leur configuration dans `orders/public/config.ts` appartiennent à A5, pas à A7. Les chiffres des suites complètes ci-dessous décrivent le workspace combiné au moment de la validation, pas uniquement les nouveaux tests A7.

GitNexus : `list_repos` confirme l'absence d'index de ce dépôt. `eventflow-site` est un autre dépôt. Traçage et revue par sources, `rg`, diff et tests ; aucun `impact`/`detect_changes` exploitable. Aucune réindexation d'un autre projet.

## Contrats Connect

- `shared/schemas/stripe-connect.ts` porte l'entrée commune et les deux réponses. Le module frontend historique les réexporte : le repository et le hook continuent à employer les mêmes schémas/types, sans modification d'endpoint.
- Le serveur valide l'entrée et la réponse avec ces contrats. L'UUID conserve la règle serveur existante : versions 1–5 et variante RFC, insensible à la casse. Le frontend applique désormais cette même règle, au lieu d'accepter des UUID que le serveur refusait déjà.
- Champs de réponse, valeurs `pending`, `connected`, `requires_migration`, projection de conformité et exigences Stripe conservés. Les objets de réponse sont construits explicitement ; aucun secret ni objet Stripe brut n'est renvoyé.
- Contrôles préservés : authentification, membership owner/admin sur l'organisation, allowlist utilisateur et créateur, origine autorisée pour start, conformité contractuelle avant création/remplacement, migration Standard et persistance conditionnée au compte attendu. Les règles de paiement, permissions et URL ne changent pas.

## Limites et comportements HTTP

| Entrée | Limite inclusive | Justification |
| --- | --- | --- |
| Connect start/status | 4 096 octets (4 Kio) | Un UUID d'organisation ; marge suffisante pour l'enveloppe JSON et les espaces |
| Webhook Connect | 1 048 576 octets (1 Mio) | Marge pour les événements Checkout, Account et Refund, avec consommation applicative bornée |

Ces limites sont des choix applicatifs, sans mesure de distribution des payloads distants. Une requête dépassant la limite réelle, même sans `Content-Length` ou avec une valeur sous-déclarée, produit `413 {"error":"PAYLOAD_TOO_LARGE"}`. Une taille déclarée au-dessus de la limite est refusée avant lecture, même si le corps réel est petit. L'égalité à la limite est acceptée. Le lecteur annule le flux dès dépassement ; il ne draine pas un flux surdimensionné.

Le refus précède les accès métier, mutations et appels Stripe. Pour Connect, le wrapper conserve la vérification Auth préalable : une requête anonyme reste `401`, et un appel Auth peut précéder le `413`. Aucun quota A8 n'a été ajouté.

JSON malformé, entrée invalide et UUID invalide Connect restent `400 INVALID_ORG_ID`. La lecture webhook fournit directement le texte au vérificateur existant : aucun parsing, trim ou réencodage JSON avant HMAC. Espaces, caractères Unicode fragmentés entre chunks, échappements et notation numérique sont préservés comme avec la lecture texte précédente. Signature absente/invalide et payload webhook signé malformé restent `400 INVALID_SIGNATURE`, sans claim ni mutation. Vérification de mode, association du compte, idempotence et traitement métier webhook restent en place.

## CAPTCHA

La nouvelle garde `assertTurnstileBypassAllowed` s'appuie sur `isRestrictedEnvironment`, mais une restriction de paiement ne constitue pas une autorisation de bypass. La garde est appelée à la résolution de configuration quand `TURNSTILE_BYPASS=1`, puis dans `verifyCaptchaOrThrow` si le bypass est demandé, y compris avec un token ordinaire.

Production déclarée, hostname du projet production (y compris URL avec casse différente, port explicite ou barre finale), URL absente/invalide, environnement inconnu et cible ambiguë : erreur explicite `500 TURNSTILE_BYPASS_FORBIDDEN`, sans appel Turnstile. La garde n'autorise pas implicitement un projet inconnu faute d'`APP_ENV`.

Configurations autorisées : `APP_ENV=staging` et URL HTTPS d'un projet Supabase non production, y compris fixtures synthétiques ; ou URL locale HTTP/HTTPS (`localhost`, `127.0.0.1`, `[::1]`, `kong`) avec environnement absent, `local`, `development` ou `staging`. `kong` préserve le parcours Docker local. Une configuration de test officiellement fournie par Turnstile passe toujours par `siteverify` ; sa clé ne donne aucune permission de bypass. Seul `TEST_BYPASS` avec bypass activé et environnement autorisé évite cet appel. Bypass désactivé et token ordinaire conservent leur traitement précédent.

## Preuves et validations

| Validation | Résultat |
| --- | --- |
| Tests Deno ciblés : HTTP Stripe, bypass, lecteur, lifecycle Stripe | 59 réussis, 0 échec |
| Vitest ciblé `stripeConnectContracts.test.ts` | 2 réussis |
| `npm run check:backend` | Réussi |
| `npm run lint:backend` | Réussi |
| `npm run test:backend` | 209 réussis, 0 échec |
| `npm test` | 133 Vitest (23 fichiers) et 16 Node réussis |
| `npm run build` | Réussi ; avertissement de taille de bundle supérieur à 500 kB |

Tests ajoutés : contrats communs front/backend, entrées valides/invalides, UUID hors contrat, JSON malformé, limites moins un/exacte/plus un, flux sans taille déclarée, sous-déclaration et surdéclaration, arrêt/annulation du flux, signature HMAC sur texte original, altération du texte signé, signatures absentes/invalides, absence d'effets avant validation et configurations CAPTCHA autorisées/interdites. Des refus membership/allowlists/origine/conformité et les trois statuts Connect sont vérifiés explicitement. Les tests lifecycle préexistants continuent à valider les transitions et l'idempotence avec des prestataires simulés.

Preuve discriminante : remplacement temporaire des seuls handlers/configuration concernés par leurs versions HEAD, puis restauration immédiate des octets du workspace. Les nouveaux tests ont produit 13 échecs attendus (limites Connect/webhook et bypass), 20 réussites. Ce contrôle a utilisé `--no-check` car les signatures lifecycle présentes dans le workspace A5 différaient de HEAD ; toutes les validations finales utilisent le typage normal. Les trois variantes d'URL production et le test de refus sans lecture ont ensuite été ajoutés et validés sur le correctif.

Revue finale : aucun contrôle Stripe supprimé par A7 ; aucun nouvel `any`, cast de contournement ou suppression lint ; lecteur unique inchangé ; aucune URL, permission, stratégie de paiement ni quota modifié. L'import inutilisé de la garde d'URL après l'évolution A5 a été retiré pour conserver un lint propre.

## Limites de la preuve

Tests avec fixtures et fetch simulés, sans recette navigateur ni webhook Stripe distant. Les limites choisies devront être confrontées aux payloads légitimes lors d'une publication autorisée. L'authentification préalable Connect demeure volontairement en place. Aucun lint frontend global ni test SQL n'était requis pour le périmètre A7 et n'a été exécuté dans cette intervention.

Aucun commit, push, merge, déploiement, paiement live, e-mail client, accès aux secrets distants ou mutation distante. La résolution métier en environnement déployé n'est pas confirmée.
