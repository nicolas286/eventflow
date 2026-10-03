# A8 — Quotas applicatifs des Edge Functions

Date : 2 octobre 2026. **Implémenté et testé localement, sans déploiement.**
Branche `dev`, HEAD `4ef53f40c779b7bdbe65f80630a0d37bc7973574`, inchangés.
Travail limité à A8 ; aucun commit, push, merge, déploiement, mutation distante,
paiement live ou e-mail client. Aucune migration A8 nécessaire.

## État de départ et méthode

Lecture des instructions globales/backend/frontend, du lot A8, du complément
plateforme, des rapports A6/A7, des sources, consommateurs et migrations.
Le checkout contient déjà A1–A7 et des changements UI/auth/paiement : ils sont
préservés. Les tests A7 Connect ont seulement reçu une fixture de consommation
RPC pour les requêtes désormais soumises à quota ; leurs assertions de taille,
signature, origin, allowlist et contrats restent actives. A6 est revalidé par la
suite frontend complète, sans nouvelle modification de session/cache.

GitNexus : `list_repos` ne contient pas Eventflow ; `eventflow-site` est un autre
dépôt. Aucun graphe/PDG/impact/detect_changes revendiqué. Tracé par `rg`, sources,
diff et tests. Le lecteur ancré du skill gitnexus-work n'est pas compatible
Windows ; pas de reçu de provenance revendiqué. Les instructions explicites de
travail local sur dev et d'actualisation A8 priment sur les étapes génériques de
branche/commit et de non-modification du plan. La provenance historique du plan
reste historique ; seuls le statut et la note A8 sont actualisés.

## Inventaire avant A8 et décision par route

| Route/opération | Identité et autorisation existantes | Quota avant A8 ; clé/fenêtre | Coût et erreur existants | Décision A8 |
| --- | --- | --- | --- | --- |
| accounts/delete | Auth vérifiée, puis manager org | Utilisateur, 5/h via consumeRequestRateLimit | Suppression, annulation abonnement ; erreurs propres au handler | Conserver exactement un quota utilisateur |
| orders/public | Public, CAPTCHA, validations événement/parcours | Ingress IP/repli 300/min ; événement+IP/repli 50/10 min par défaut, configurable ; quota SQL create_order_intent en plus | CAPTCHA, stock, Stripe, tickets/mail ; ResponseError | Conserver les deux consommations HTTP distinctes ; ne pas les dupliquer |
| platform-admin | Auth/email, registre privé, MFA/session, step-up selon opération | Utilisateur 180/min avant auth plateforme spécifique | SQL, Auth invitations, campagnes ; contrats plateforme | Conserver exactement un quota utilisateur |
| stripe-connect-start | Auth, manager, origine, allowlists acteur/créateur, conformité vendeur | Aucun quota applicatif | Comptes/liens Stripe, écriture statut ; ResponseError | Ajouter budget restreint avant premier appel Stripe |
| stripe-connect-status | Auth, manager, allowlists, compte configuré | Aucun | Lecture Stripe + écriture statut ; ResponseError | Ajouter budget permettant polling et onglets multiples |
| organization-payment-settings/read | Auth, manager | Aucun | Lecture DB ; erreurs HTTP propres | Budget de lecture généreux |
| organization-payment-settings/update, accept_terms | Auth, manager | SQL transactionnel : update 30/min ; accept 10/min, clé user+org | Mutation, notification IBAN pour update ; rollback SQL possible | Ajouter consommation indépendante, avant RPC métier ; budgets SQL conservés |
| subscriptions/start | Auth, manager | Aucun HTTP | Facture interne, PDF, e-mail, Billit ; anciennes routes Mollie inactives | Ajouter budget avant création facture/livraison |
| subscriptions/cancel | Auth, manager | Aucun HTTP | Annulation interne, pas d'appel Mollie ; erreurs propres | Ajouter budget autorisé avec marge de retry |
| invoices/:id/pdf | Auth, ressource serveur, membership | Aucun HTTP | Génération PDF si absent, stockage/signature ; erreurs propres | Ajouter budget après membership, avant PDF/signature |
| orders/admin | Auth, événement serveur, is_org_member | SQL create_order_intent service/événement 500/min, dans transaction | Intent, paiement offline ; erreurs SQL/API | Ajouter budget user+org après membership, avant mutations |
| orders/admin/:id/mark-paid | Auth, commande serveur, manager | Aucun HTTP | Paiement, audit, tickets et confirmation | Ajouter budget distinct, marge pour replay |
| orders/:id GET | Public, filtre id+booking_token | Aucun | Lectures DB, coordonnées paiement ; DB_ERROR pouvait reprendre le message SQL | Ajouter ingress sur toutes tentatives et ressource après accès ; supprimer détails SQL sensibles |
| platform-config GET | Public ; audience = filtre, pas permission | Aucun | RPC de lecture, contrat validé | Ajouter quota par IP fiable ou repli partagé, sans clé audience |
| stripe-webhook-connect | Signature sur corps borné, vérification prestataire, claims/idempotence | Aucun quota utilisateur | Traitement paiement et reprises prestataire | Aucun quota ajouté : budget partagé pourrait rejeter paiement/retry légitime |
| workers | Secret interne/cron exact, lots et claims | Aucun quota utilisateur | Expiration, livraison/reprise, historique Mollie | Aucun quota ajouté ; préserver contrôle interne et reprises |

Les lectures internes de `platform_public_config` utilisées par les gates métier
ne passent pas par le handler public et ne consomment pas son budget.
Les anciens contrôles SQL `assert_rate_limit` ne sont pas retirés : leur compteur
transactionnel peut être annulé par une erreur métier. A8 couvre cet écart par
un appel HTTP/RPC séparé ; ce n'est pas une migration générale des RPC.

## Matrice réellement appliquée

Source unique : `supabase/functions/_shared/app/config/rate-limits.ts`.
Les nouveaux scopes sont distincts. `user+org` signifie la clé
`user:<identité Auth vérifiée>:org:<organisation autorisée>` : pas un userId
client, pas un compteur d'organisation partagé entre tous ses utilisateurs.
Les valeurs sont des hypothèses conservatrices ajustables, pas des limites de
plan ni une décision commerciale. Fenêtres fixes, limites inclusives.

| Opération | Identité de quota | Limite | Fenêtre | Justification |
| --- | --- | ---: | ---: | --- |
| Connect/start | user+org | 10 | 600 s | Création compte, liens d'onboarding et reprises |
| Connect/status | user+org | 120 | 60 s | Polling et plusieurs onglets, lecture Stripe/persistence |
| Payment settings/read | user+org | 120 | 60 s | Consultation répétée sans coût prestataire |
| Payment settings/update | user+org | 20 | 600 s | Modifications bancaires, notification e-mail |
| Payment settings/accept_terms | user+org | 30 | 600 s | Écritures de preuve, reprises formulaire |
| Subscriptions/start | user+org | 10 | 600 s | Facture/PDF/e-mail/Billit, y compris demande rejouée |
| Subscriptions/cancel | user+org | 10 | 600 s | Mutation interne ; reprise manuelle possible |
| Invoices/pdf | user+org, partagé entre ses factures | 60 | 60 s | Génération PDF et signature Storage |
| Orders/admin-create | user+org, partagé entre ses événements | 120 | 60 s | Rafales de guichet ; intent/paiement SQL |
| Orders/admin-mark-paid | user+org, partagé entre ses commandes | 60 | 60 s | Paiement/tickets/mail ; idempotence conservée |
| Orders/read ingress avec IP fiable | IP normalisée | 180 | 60 s | Toutes tentatives, plusieurs onglets de polling |
| Orders/read ingress sans IP fiable | Un compteur de repli par scope | 6000 | 60 s | Disponibilité bornée, sans UUID/token arbitraire |
| Orders/read ressource | Commande réellement trouvée avec le bon token | 120 | 60 s | Après accès seulement, avant lectures complémentaires |
| Platform-config avec IP fiable | IP normalisée, audiences partagées | 120 | 60 s | Navigation publique |
| Platform-config sans IP fiable | Un compteur de repli par scope | 6000 | 60 s | Configuration disponible avec budget borné |
| Accounts/delete, préexistant | user Auth | 5 | 3600 s | Inchangé |
| Orders/public ingress, préexistant | IP/repli | 300 | 60 s | Inchangé |
| Orders/public registration, préexistant | événement+IP/repli | 50 par défaut | 600 s | REGISTER_RATE_LIMIT_PER_10MIN conservé |
| Platform-admin, préexistant | user Auth | 180 | 60 s | Inchangé |

## Frontière de confiance IP et cardinalité

Le helper applicatif faisait confiance à Cloudflare systématiquement et à une
signature Netlify validant le contexte du site, sans lier l'adresse IP au
payload signé. A8 ignore X-Forwarded-For, X-Real-IP et les headers Netlify dans
le resolver applicatif. Les options du module générique restent disponibles,
mais ne sont pas utilisées pour accorder cette confiance aux routes Eventflow.

**Par défaut, aucune IP fournie par header n'est réputée fiable.**
`RATE_LIMIT_TRUST_CLOUDFLARE_IP=1` est une configuration serveur explicite,
autorisée uniquement après preuve que toute entrée remplace CF-Connecting-IP
et qu'aucune entrée directe/domaine alternatif/proxy/Worker ne contourne cette
frontière. Aucun réglage distant inspecté ou modifié ; cette preuve de déploiement
n'est pas revendiquée. Une valeur malformée, absente, ou uniquement XFF reste
sans IP et consomme le repli. Les tests exercent activation serveur explicite,
normalisation et falsification avec confiance désactivée.

La [documentation Cloudflare](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
décrit les IP à l'origine et des différences avec les sous-requêtes Worker ;
ce contrat ne prouve pas à lui seul la topologie Supabase déployée.
Les [logs Supabase](https://supabase.com/docs/guides/observability/log-field-reference)
peuvent enregistrer CF-Connecting-IP : présence dans les logs ne vaut pas
attestation d'une entrée non contournable. Consultation du changelog Markdown
Supabase tentée, mais rendu web refusé (`Unsupported content-type: text/markdown`).

Changement production explicite : le nouveau défaut s'applique aussi au helper
IP déjà utilisé par orders/public. Sans configuration serveur vérifiée, son
quota ingress existant 300/min devient partagé, et son quota registration
50/10 min devient partagé par événement. Le CAPTCHA ne reçoit plus une IP non
attestée. Aucun quota supplémentaire n'y est branché. Cette incidence doit
être évaluée avec les volumes réels avant toute publication autorisée.

Les replis orders/read et platform-config n'ajoutent chacun qu'une clé fixe par
fenêtre. Une UUID aléatoire ou un token variable n'ajoute aucun compteur de
ressource. Les clés authentifiées proviennent seulement d'identités vérifiées
et de relations autorisées ; le quota facture/admin ne varie pas par UUID de
facture/événement/commande. Le quota ressource de lecture publique n'existe
qu'après correspondance id+token. Les IP sont validées/normalisées puis hachées
avec le sel serveur ; aucun token brut ou hash de token n'est utilisé en clé.
Scopes et fenêtres sont des constantes serveur, pas des paramètres HTTP.

Le repli partagé évite le fail-open et borne les compteurs, mais un attaquant
peut épuiser ce budget et affecter les lecteurs légitimes sans IP attestée.
Ce compromis est explicite et ne touche pas les callbacks paiement. Il ne
remplace ni la protection plateforme en amont ni une frontière IP vérifiée.

## Ordre, erreurs et clients

Routes authentifiées : Auth vérifie l'acteur ; membership/droits et ressource
serveur établissent l'organisation ; consommation ; effet. Connect conserve
aussi origine, allowlists et conformité avant Stripe. Un refus organisation
ne consomme jamais le budget de l'organisation étrangère. Invoices utilise un
callback de consommation obligatoire, exécuté après membership et avant PDF.

Orders/read : ingress avant validation de l'ID/token ; token absent/malformé
→ `401 MISSING_TOKEN`, token non correspondant/commande absente → `404 NOT_FOUND`.
Ces refus ne consultent pas le compteur ressource et ne révèlent pas son état.
Le quota de ressource ne remplace jamais le filtre d'accès. `DB_ERROR` n'expose
plus le message SQL contenant potentiellement le filtre booking_token.
Aucun logging d'URL/token ; les logs quota contiennent scope, compte et délai.

Quota réellement dépassé : `429 {"error":"TOO_MANY_REQUESTS"}` avec
`Retry-After` entier positif, `no-store`, exposition CORS de Retry-After.
RPC en panne, réponse invalide, erreur de hachage ou sel absent :
`503 {"error":"RATE_LIMIT_UNAVAILABLE"}`, `Retry-After: 30`, sans effet.
La réponse RPC est validée par Zod ; délai zéro/non entier/absent sur refus est
une panne contrôlée, pas une autorisation. Les erreurs SQL du limiteur ne sont
ni reprises dans la réponse ni journalisées. Les conventions `{error: code}`
et le wrapper HTTP existants sont conservés.

Les clients Edge utilisant le SDK conservent désormais statut et délai dans
une erreur sans Response/cause/URL sensibles ; message français contrôlé.
Les fetch de commande et widget suivent la même règle. OrderPage suspend ses
requêtes pendant Retry-After et évite chevauchements ; son polling de 1,5 s
pendant 30 s reste compatible avec les budgets. Aucun retry automatique de
mutation ajouté. Le téléchargement PDF affiche l'erreur contrôlée. La bannière
platform-config reste facultative et ne retente pas en boucle.

## Preuves SQL, purge et validations

`consume_rate_limit` réutilisé sans modification SQL : clé primaire
`(key,window_start)`, UPSERT incrément atomique sous verrou PostgreSQL.
Le refus est une valeur retournée, pas une exception qui annule le comptage.
Chaque appel HTTP au RPC est une transaction distincte de l'effet métier.
Les requêtes refusées comptent aussi. À une frontière de fenêtre fixe, deux
budgets peuvent être admis de part et d'autre : pas une fenêtre glissante.

Base jetable isolée `eventflow-security-a8-20261002`, PostgreSQL 17/port 59322,
Supabase CLI 2.75.0, **55 migrations rejouées**, aucun seed/secret/.local copié.
Douze vraies connexions se chevauchent avec une première transaction maintenant
le verrou : exactement cinq autorisations pour un budget cinq ; compteurs
1..12. Une erreur métier division-by-zero dans une transaction ultérieure
conserve le compteur déjà commité. La fenêtre de deux secondes épuisée s'ouvre
réellement après expiration. Les fixtures sont nettoyées, base et volumes A8
supprimés ; les onze conteneurs Eventflow préexistants restent actifs.

`private.prune_rate_limits()` supprime les lignes dont updated_at dépasse sept
jours ; le test conserve les compteurs récents et supprime les anciens.
**Aucun appel périodique versionné ni job cron de purge dans la base reconstruite.**
Les clés sont bornées par les identités/scopes ci-dessus, mais les anciennes
fenêtres peuvent s'accumuler sans exécution de cette primitive. L'exploitation
doit vérifier/organiser cette purge existante avant d'annoncer une rétention
automatique. Aucun nouveau Redis, broker, cron ni infrastructure ajouté à A8.

Commandes SQL exécutées dans le workdir temporaire isolé :

```powershell
supabase db start --workdir $a8SqlDir
Get-Content -Raw -Encoding UTF8 tests/database/rate-limit-regressions.sql |
  docker exec -i supabase_db_eventflow-security-a8-20261002 psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1
node tests/database/rate-limit-concurrency.checks.mjs supabase_db_eventflow-security-a8-20261002
# Chaque tests/database/*.sql : même psql, arrêt dès un exit non nul.
node --check tests/database/rate-limit-concurrency.checks.mjs
supabase stop --project-id eventflow-security-a8-20261002 --no-backup --workdir $a8SqlDir
```

| Validation | Résultat final |
| --- | --- |
| `npm run test:backend -- --filter A8` | **78 réussis**, 210 autres tests filtrés |
| `npm run check:backend` | **Réussi** |
| `npm run lint:backend` | **Réussi**, 189 fichiers |
| `npm run test:backend` | **288 réussis**, zéro échec |
| `npm test` | **171 Vitest** dans 30 fichiers et **16 Node**, zéro échec |
| `npm run build` | **Réussi**, avertissement existant de chunk > 500 kB |
| Tests frontend ciblés, cinq fichiers | **42 réussis** |
| ESLint des onze fichiers frontend/tests A8 | **Réussi**, pas de suppression ajoutée |
| Rejeu SQL jetable | **55 migrations**, **12 suites SQL** réussies |
| Runner concurrence SQL avec vraies connexions | **Réussi**, 12 connexions/5 autorisations, expiration et rollback métier |
| `git diff --check` | **Réussi** |

La suite [application-rate-limit-test.ts](../../supabase/functions/tests/application-rate-limit-test.ts)
teste les dix opérations authentifiées (sous quota, 429 avant effets, panne RPC,
identité invalide, org étrangère), les identités A/B et payload userId falsifié,
trente lectures Connect/status, erreur métier puis dépassement/réouverture,
provenance IP/falsification/repli, tokens absents/invalides et commande absente,
absence de clés/logs sensibles, compteur ressource seulement après accès,
réponses RPC malformées et sel absent. Les trois budgets préexistants ont une
assertion explicite de non-double consommation : accounts = un, platform-admin
= un, orders/public = deux budgets différents.

Les tests HTTP simulent la fenêtre pour vérifier l'orchestration ; les preuves
d'atomicité et d'expiration persistantes sont exécutées séparément par
[rate-limit-regressions.sql](../../tests/database/rate-limit-regressions.sql) et
[rate-limit-concurrency.checks.mjs](../../tests/database/rate-limit-concurrency.checks.mjs).
Les suites existantes de signature Stripe, lifecycle, confirmation/retry et
workers restent vertes, sans nouveaux quotas dans ces chemins.

Tests frontend ciblés exécutés :

```powershell
npx vitest run tests/unit/shared/supabaseEdgeSafe.test.ts tests/unit/shared/edgeRateLimits.test.ts tests/unit/shared/orderRateLimitPolling.test.ts tests/unit/shared/widgetConfirmation.test.ts tests/unit/shared/invoiceRateLimitDownload.test.ts
npx eslint src/shared/errors/edgeRequestError.ts src/shared/errors/errors.ts src/shared/errors/businessErrorMessages.ts src/shared/gateways/supabase/supabaseEdgeSafe.ts src/app/modules/public/register/pages/OrderPage.tsx src/app/modules/public/widget/data/widgetConfirmationRepo.ts src/app/modules/public/widget/hooks/useWidgetConfirmationOrder.ts src/app/modules/admin/subscriptions/components/InvoicesTab.tsx tests/unit/shared/edgeRateLimits.test.ts tests/unit/shared/orderRateLimitPolling.test.ts tests/unit/shared/invoiceRateLimitDownload.test.ts
```

Des fixtures HTTP préexistantes ont dû fournir le nouveau RPC et son sel
synthétique ; les assertions métier n'ont pas été affaiblies. Le test plateforme
ajouté fournit une date d'email vérifié pour atteindre le refus du registre
privé attendu. Le fixture sans email vérifié ne pouvait pas atteindre ce refus ;
il répondait correctement EMAIL_NOT_VERIFIED. Les validations finales ci-dessus
portent sur ces fixtures corrigées et le typage normal, sans `--no-check`.

**Revue finale : PASS sur le périmètre local A8**, par lecture du diff et revue
indépendante sécurité/technique. Autorisation → quota → effet vérifié ; aucun
nouveau `any`, cast de compatibilité ou suppression de lint. Le wrapper SDK
retire également son ancien `any`. Les autres diff Auth/paiement/webhook/worker
du checkout sont les travaux préexistants A4–A7. Leur présence et leurs tests
ne sont pas présentés comme des modifications A8.

## Protections restantes jusqu'à B0–B6

Les budgets Edge ne couvrent pas les appels directs navigateur aux RPC/tables.
Conserver leurs RLS, grants, membership et contrôles transactionnels tant que
leurs consommateurs ne sont pas migrés et que le refus direct n'est pas prouvé.
`assert_rate_limit` reste transactionnel ; A8 ne garantit pas le comptage des
tentatives SQL directes échouées. Conserver quotas SQL et invariants stock,
paiement, organisation/ressource, contrats et idempotence.

Surfaces concrètes encore directes : rpc_list_invoices, billing get/upsert,
organisation/dashboard/événements/produits/formulaires/promos, RPC publiques
d'organisation/événement/conditions, tables events/event_products/form_fields/
form_groups/promo_codes/organization_profile/user_profile. A1/A3 et les ACL
service-only du limiteur restent nécessaires. Fermer grants/default ACL et
overloads domaine par domaine, tester rôles réels et GraphQL/Realtime/Storage,
avant tout retrait de RLS. Aucune permission métier modifiée par A8.

## Limites de la preuve

Prestataires HTTP simulés, données synthétiques ; pas de paiement ni d'e-mail
réel. Tests frontend sur SDK réel avec fetch/timers/hooks contrôlés, sans
recette navigateur. Aucun test de charge massif ni test offensif distant.
Ni les volumes production ni la topologie IP ni les jobs distants ne sont
attestés. Les parcours et reprises sont prouvés localement, pas la résolution
métier d'une publication. Le lint frontend global historique n'est pas revendiqué.
