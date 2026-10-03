# Audit approfondi backend et frontière frontend — Eventflow dev

> **Revue d'intégration du 3 octobre 2026 — A0 à D5.** Les implémentations et rapports
> de ces lots sont présents. Les deux commits distants `2fd80e5` et `879b060` ont été
> intégrés ; le conflit `AdminLayout` conserve notifications/thème et isolation de session.
> La revue corrige la réactivation d'une organisation suspendue, les clés de quotas UUID,
> le démontage des pages lors d'un rafraîchissement dashboard et la transition des campagnes D5.
> L'utilisateur a également confirmé le blocage des nouvelles commandes d'une organisation suspendue.
> Voir le [rapport de revue et ses validations](../audits/2026-10-03-integration-review-a0-d5.md).
> La publication autorisée vise **dev/staging**, pas `main` ni production.
> **Bascule staging du 3 octobre : fermeture déployée et recette hébergée réussie**
> au commit `97c5599` (70 migrations). Tables/colonnes/RPC métier et accès aux schémas
> `public`/`private` fermés aux rôles navigateur ; Auth et lecture publique des assets conservées.
> Le retrait RLS métier est préparé dans une migration staging distincte, avec recette
> hébergée répétée après application. Les fermetures production restent différées.
> Voir le [rapport de bascule staging](../audits/2026-10-03-staging-edge-only-cutover.md)
> pour distinguer préparation, déploiement et preuves finales.
> Les mentions et empreintes du 2 octobre ci-dessous constituent la provenance historique.

> **Actualisation après synchronisation de dev, le 2 octobre 2026.** Les 20 commits distants entre `34cde6d` et `4ef53f4` ont été intégrés localement. Le dashboard plateforme existe désormais dans le périmètre examiné. Lire le complément `docs/audits/2026-10-02-dev-sync-platform-security-review.md` avant d'exécuter une tâche. L'ancien rapport A0–A3 reste une preuve historique, pas l'état du code courant.
>
> **Ordre révisé :** A0/A1 déjà traités dans les sources à jour ; A2/A3 implémentés localement et validés après intégration. Ne pas les réimplémenter. Traiter en priorité D1 (mauvaise cible UI), D2 (succès formulaire) et D3 (concurrence onboarding), puis reprendre A4–A8 et B0–B6. Aucune publication distante n'a été effectuée.

> Date : 2 octobre 2026. Audit initial à 34cde6d ; actualisation des sources à HEAD 4ef53f40c779b7bdbe65f80630a0d37bc7973574, avec modifications locales inventoriées.
> GitNexus : index eventflow-front absent ; eventflow-site est un autre dépôt. Analyse des sources et migrations, sans graphe ni PDG.
> Provenance schema 2 ; digest global 2e9f3ca96b1dfe2d5182b214fd5a4a33c12398033d34962128d19af33a0f25a6 ; 71 chemins cites (actualisation).
> Audit initial en lecture seule ; actualisation après intégration locale des commits distants et préservation d'A0–A3. Corrections limitées aux conflits, à une fixture SQL et aux documents. Aucune publication, aucun paiement ni mutation distante pendant cette intégration.

## 1. Objectif

### État d'avancement après intégration de origin/dev

« Fait localement » signifie code présent et validation locale indiquée ; cela ne signifie jamais déployé. L'observation distante de Sol est datée de son rapport A0, sans nouvelle inspection distante pendant cette synchronisation.

| Lot / sujet | État au 2 octobre 2026 | Ce qui reste |
| --- | --- | --- |
| Synchronisation dev | **Fait** : 20 commits intégrés, HEAD 4ef53f4 aligné origin/dev, conflits résolus, stash de sauvegarde conservé | Aucun push ni déploiement effectué |
| A0 — inventaire | **Fait** : catalogue local/staging/production inspecté par Sol ; écart de code réconcilié après synchronisation | Actualiser les observations de cible au moment d'une publication autorisée |
| A1 — RPC internes | **Déjà intégré dans dev distant**, et migration locale équivalente conservée ; tests de refus réussis | Publication production séparée ; ne pas recréer le correctif |
| A2 — groupes de formulaires | **Implémenté et testé localement** : FK composite et suppression préservant le champ | Préflight des données de la cible, puis publication autorisée |
| A3 — compteurs produits | **Implémenté et testé localement** : grants table/colonne corrigés et TRUNCATE fermé | Publication ; validations métier des colonnes restantes à traiter dans B2/B6 |
| A4 — état paiement admin | **Implémenté/testé localement** | Résultat SQL validé, échéance distinguée du solde, tests HTTP mockés et PostgreSQL local ; aucun déploiement. Preuves : [audit A4](../audits/2026-10-02-backend-api-security-a4.md) |
| A5 — confirmations e-mail | **Implémenté et testé localement** : erreurs RPC, bail avec jeton, reprise bornée et enveloppe immuable | Publication séparée ; claims historiques ambigus en revue, aucune garantie exactly-once |
| A6 — session/cache | **Implémenté et testé localement**, organisateur et plateforme | Client unique, persistance conforme au choix, invalidation identité/session/org et rejet des réponses tardives ; recette navigateur restante, aucun déploiement. Preuves : [audit A6](../audits/2026-10-02-backend-api-security-a6.md) |
| A7 — entrées HTTP | **Implémenté/testé localement, sans déploiement** | Contrats Connect partagés, Connect borné à 4 Kio, webhook à 1 Mio, bypass CAPTCHA refusé en production/configuration ambiguë. Preuves : [audit A7](../audits/2026-10-02-backend-api-security-a7.md) |
| A8 — quotas | **Implémenté/testé localement, sans déploiement** | Matrice par opération, autorisation avant quotas user+org, tentatives publiques bornées, panne 503 et clients 429. Frontière IP à attester et purge existante non planifiée ; accès directs hors budgets Edge jusqu'à B0–B6. Preuves : [audit A8](../audits/2026-10-02-backend-api-security-a8.md) |
| B0–B6 — migration métier Edge-only | **B0–B6 implémentés/testés localement ; fermetures différées livrées/testées, non publiées** ; plateforme déjà derrière Edge | Publication en phases, intervention supabase_admin et revue high du retrait RLS requises ; schémas/consommateurs hébergés non attestés. Suppression B3 et statuts B4 restent à relire. Preuves : [B6](../audits/2026-10-03-backend-api-security-b6.md), [B3](../audits/2026-10-03-backend-api-security-b3.md), [B4](../audits/2026-10-03-backend-api-security-b4.md), [B5 factures](../audits/2026-10-03-backend-api-security-b5-invoices.md), [B5 catalogue](../audits/2026-10-03-backend-api-security-b5-catalogue-public.md) et [B1/B2](../audits/2026-10-03-backend-api-security-b1-b2.md) |
| C1 — code mort | **Trois sous-lots implémentés/testés localement, non publiés** | Frontend orphelin, modules Mollie tests-only et dépendances npm retirés ; worker routé et historique conservés. Preuve : [C1](../audits/2026-10-03-backend-api-security-c1.md) |
| C2 — contrats/Markdown/docs | **Partiel** : contrats plateforme et redaction centralisée déjà intégrés ; plan actualisé | DTO/mappings, Markdown et documentation restante |
| D0 — socle plateforme | **Déjà implémenté dans dev** : routes, registre privé, MFA, step-up, audit, onboarding, communications | Ne pas recréer ; traiter D1–D5 |
| D1–D5 — corrections plateforme | **À faire** : identifiées par la nouvelle revue | Priorité D1/D2, puis D3/D4 et reprise campagnes |

Validation d'intégration : **54 migrations, neuf suites SQL, 121 tests Vitest, 16 tests Node et 136 tests Deno réussis** ; typage/lint backend et build réussis. Les résultats ne constituent pas une recette production.

Décision explicite du propriétaire : migrer d'une autorisation métier RLS vers une autorisation métier exclusivement dans les Edge Functions. Sécuriser et simplifier le backend avant de faire des Edge Functions l'entrée de toutes les opérations métier du navigateur. Produire des lots suffisamment bornés pour Sol light, medium et high. Conserver les transactions et invariants dans PostgreSQL. Éviter une réécriture globale, un framework de permissions, une fonction HTTP par RPC et une nouvelle infrastructure de queues.

Verdict : CORRECTIONS REQUISES dans le code ; VALIDATION INCOMPLÈTE pour les ACL effectives, le déploiement et l'exploitation distante. Aucun incident de fuite de clé Stripe démontré.

Les tags [verified] désignent des faits lus dans les sources, [inferred] leurs conséquences statiques, [assumed] les éléments qui nécessitent une preuve runtime ou distante.

## 2. Comportement actuel

[verified] Le frontend appelle maintenant 32 RPC distinctes (28 administratives, 4 publiques). Les deux nouvelles sont update_organization_seller_identity et accept_organization_platform_agreements. Les sept tables directes restent présentes. Les anciens comptes 13 functions.invoke/11 patrons ne décrivent plus la surface actuelle : le repository plateforme utilise un helper dynamique pour platform-admin/* et platform-config. Deux fetch lisent orders/:id. Auth et Storage sont aussi utilisés directement.

Tables : events, event_products, event_form_fields, event_form_field_groups, promo_codes, organization_profile, user_profile.

[verified] Onze points d'entrée Edge sont présents : accounts, invoices, orders, organization-payment-settings, subscriptions, workers, stripe-connect-start, stripe-connect-status, stripe-webhook-connect, platform-admin et platform-config. Netlify possède également share-event.js. Aucun endpoint déployable ne peut être classé mort à partir de sa seule absence d'import TypeScript.

[verified] Le fournisseur de billetterie actif accepte Stripe et la branche virement conditionnée par feature flag. Les routes webhook Mollie de subscriptions répondent 410 ; les anciens modules correspondants existent encore et sont testés directement. Sources : orders/public/payment-provider.ts:59 ; subscriptions/index.ts:18.

[verified] Le code possède déjà shared/schemas, createEdgeHandler, des services internes, des contrôles Stripe et des tests SQL/Edge. Il faut prolonger ce socle.

## 3. Architecture cible simple

Frontend → repository métier → Edge de domaine → identité vérifiée + autorisation explicite → client serveur privilégié → opération SQL atomique / prestataire → réponse validée.

Cible : aucune policy RLS nécessaire à l'autorisation métier des domaines migrés. Les grants SQL sont la fermeture de l'accès navigateur à la base, pas un second moteur de permissions métier. Les données restent inaccessibles directement avec une clé publique et un JWT utilisateur.

- Un DTO d'entrée et de sortie par opération dans shared/schemas, sans dépendance React/Deno.
- Une petite fonction de contrôle de membership owner/admin, réutilisée là où la même règle s'applique. Les ressources sont résolues côté serveur ; un orgId reçu ne prouve rien.
- PostgreSQL conserve contraintes, stock, idempotence, transitions de paiement, contraintes uniques et atomicité.
- Les services e-mail/PDF/Billit restent internes.
- Les webhooks restent séparés des routes utilisateur ; ne pas les soumettre à une session navigateur.
- Auth Supabase directe conservée par défaut. Pour Storage : Edge autorise et borne l'upload ; transfert direct signé acceptable et explicitement documenté.
- Toutes les opérations métier visées passent à terme par HTTP ; les accès directs restants sont recensés et justifiés.

Modèle fixé pour les domaines migrés :
1. L'Edge vérifie le JWT avec Auth, puis lit en base l'appartenance et le rôle applicables. Aucune confiance dans un orgId/userId du payload ou dans user_metadata.
2. Le repository serveur utilise un client service_role créé sans reprendre le header Authorization utilisateur. La clé reste dans les secrets backend.
3. Les lectures et mutations sont explicitement bornées par organisation ET ressource autorisée. L'absence de RLS rend une omission de filtre dangereuse ; les tests négatifs portent donc sur chaque route et sous-route.
4. Les RPC métier transactionnelles restent internes, EXECUTE réservé au serveur. Adapter celles dépendant de auth.uid() : l'Edge fournit l'acteur qu'elle vient de vérifier, uniquement via un canal serveur inaccessible aux rôles navigateur. Les vérifications d'intégrité relationnelle restent en SQL ; les règles de permission utilisateur résident dans l'Edge.
5. Retirer les droits directs PUBLIC, anon et authenticated sur tables, vues, séquences et fonctions métier concernées, y compris grants de colonnes, overloads et privilèges par défaut des rôles créateurs. Vérifier GraphQL et toute exposition Realtime. Ne pas créer de route SQL/RPC générique.
6. Après migration des consommateurs et preuve du refus direct, retirer les policies RLS métier devenues inutiles et désactiver RLS sur les tables concernées dans une migration dédiée. Les domaines non encore migrés conservent temporairement leurs protections actuelles.
7. La Data API peut rester active comme transport interne des Edge via supabase-js .from/.rpc. La désactiver globalement casserait également ces appels serveur ; un accès PostgreSQL direct n'est pas requis par la cible et n'est pas proposé ici.

Exceptions techniques précises : Auth peut toujours émettre/renouveler les sessions directement ; chaque opération métier revérifie son identité côté Edge. Storage peut recevoir un upload via URL signée par une Edge autorisée, sans autorisation navigateur générale sur le bucket. Le contrôle des chemins/MIME/taille et de la portée du jeton est côté serveur. Le retrait des policies applicatives ne signifie pas modifier aveuglément les schémas Supabase auth/storage gérés par la plateforme. Aucun accès Realtime métier direct ne doit rester sans analyse et solution explicite.

La documentation Supabase distingue les grants (objets accessibles) de RLS (lignes accessibles). La cible retient les grants pour fermer la base aux navigateurs, et les Edge pour les permissions métier :
https://supabase.com/docs/guides/api/securing-your-api
https://supabase.com/docs/guides/functions/auth

## 4. Constats et preuves — mode source, sans GitNexus

### S01 — P0 de vérification : RPC privilégiées, révocations incomplètes

**Statut actualisé : corrigé dans dev par 20260930181500_harden_internal_function_privileges.sql.** Cette migration récupérée révoque explicitement les cinq RPC et d'autres fonctions internes. A1 locale réapplique une partie de ces révocations sans conflit ; elle est conservée, pas à réécrire. Le rapport A0 a observé l'exposition en production par catalogue, contrairement au staging. Cette observation distante antérieure n'a pas été répétée ici et aucune correction distante n'a été appliquée. Les paragraphes suivants décrivent l'ancien état ayant motivé A0/A1.

[verified] admin_grant_subscription est SECURITY DEFINER sans garde utilisateur et modifie l'abonnement d'une organisation arbitraire : supabase/migrations/20260324133258_remote_schema.sql:1594.
[verified] claim_order_confirmation_email est sans garde, modifie la commande et retourne buyer_email + booking_token : même fichier:2562.
[verified] log_email_once et mark_order_confirmation_email_error/sent ont des propriétés similaires : même fichier:6327,6347,6359.
[verified] La migration 20260915160000_reconcile_production_privileges.sql:51,61,80 révoque PUBLIC seulement pour ces fonctions. Elle révoque explicitement anon/authenticated pour d'autres RPC.
[inferred] Si des droits directs hérités des default ACL existent pour anon/authenticated, REVOKE PUBLIC ne les enlève pas : attribution de plan ou fuite de booking token possible.
[assumed] Les ACL effectives locales reconstituées et distantes n'ont pas été observées. Il ne s'agit pas d'une fuite distante confirmée.

Action : interroger proacl, pg_default_acl et has_function_privilege, puis rendre les fonctions internes explicitement service-only par nouvelle migration. Vérifier tous les overloads et rôles hérités. Ne pas appeler les RPC mutantes en production pour prouver l'exposition.

### S02 — P1 : accès table contournant validations et compteurs de stock

**Statut actualisé : compteurs protégés localement par A3, validée sur les 54 migrations intégrées.** Le contournement des validations métier sur les colonnes encore autorisées subsiste jusqu'à B2/B6 ; ne pas considérer toute la frontière Data API comme fermée.

[verified] remote_schema.sql:9447 accorde UPDATE event_products ; policy:10239 contrôle l'appartenance à l'événement, pas les colonnes. reserved_qty et sold_qty sont accessibles (:115).
[verified] La RPC update_event_product impose des contrôles de débit et de plan : 20260616083043_update_event_product_refactor.sql:146,242.
[inferred] Un membre de sa propre organisation peut réinitialiser des compteurs ou contourner une validation métier via Data API, même s'il ne peut pas lire une autre organisation.
Action : interdire immédiatement les colonnes système aux clients ; migrer les mutations légitimes avant révocation complète. Les compteurs restent contrôlés transactionnellement par PostgreSQL.

### S03 — P1 : rattachement de champ à un groupe d'un autre événement

**Statut actualisé : corrigé localement par A2 et ses tests SQL.** Déploiement distant non effectué ; conserver les exigences de préflight sur données existantes.

[verified] FK group_id simple dans remote_schema.sql:766 ; policies INSERT/UPDATE vérifient seulement event_id (:10171,10200), avec grants :9401,9411.
[verified] La RPC create_event_form_field refuse un groupe étranger (20260616182119_refactor_create_event_form_field_rpc.sql:131), mais le frontend modifie directement la table (src/app/modules/admin/forms/data/updateEventFormFieldRepo.ts:63).
[inferred] Un champ de A peut référencer un groupe connu de B, y compris d'une autre organisation.
Action : contrainte de cohérence DB, après inventaire des lignes incohérentes. Préserver la suppression d'un groupe qui met seulement group_id à NULL, sans effacer event_id ni les champs.

### S04 — P1 : état API faux après paiement administratif partiel

[verified] orders/admin/handler.ts:226 reçoit payRes de apply_order_payment, puis :264 renvoie systématiquement paid et dueNowCents:0.
[verified] La fonction SQL conserve partially_paid si le paiement est inférieur au total (remote_schema.sql, apply_order_payment).
Exemple : total 100 EUR, versement custom 10 EUR → base partially_paid, réponse paid.
Action : dériver état et montants du résultat SQL validé. Définir dueNowCents précisément : ne pas le confondre automatiquement avec solde total après un acompte.

### S05 — P1 : confirmations e-mail sans reprise fiable

[verified] orders/public/emails.ts:48 ignore le champ error renvoyé par mark_order_confirmation_email_sent.
[verified] Le claim SQL exige claimed_at IS NULL et n'a pas de bail expirant (remote_schema.sql:2575).
[inferred] Crash après claim → blocage permanent ; erreur de marquage → faux journal de succès ; erreur d'envoi absorbée → webhook terminé sans garantie de reprise.
[verified] stripe-checkout-lifecycle.ts:125 exige encore functionsBase alors que l'envoi est un appel de service local.
Action : contrôle des erreurs RPC, claim récupérable avec propriétaire/fencing pour éviter double worker, reprise bornée dans workers existant et idempotence fournisseur. Réutiliser les mécanismes de livraison existants, sans nouveau bus.

### S06 — P1/P2 : session persistante malgré « ne pas rester connecté »

[verified] authRepo.ts:30 choisit le client sessionStorage, puis :36 copie la session dans le client principal persistant ; supabaseClient.ts:10 utilise les valeurs de persistance par défaut.
Action : une stratégie de stockage cohérente ; préserver récupération de session, refresh et logout. La fermeture d'onglet/navigateur doit être testée réellement.

### S07 — P2 : protections HTTP incomplètes

[verified] Budgets applicatifs définis pour accounts/delete, orders/public et désormais platform-admin. Le quota plateforme ne supprime pas les manques identifiés sur Stripe Connect, settings de paiement, subscriptions, invoices, orders/read et création admin ; platform-config reste également à évaluer.
[verified] stripe-connect-start/index.ts:60 et stripe-connect-status/index.ts:47 utilisent req.json sans taille bornée ; stripe-webhook-connect/index.ts:223 charge req.text avant signature.
[verified] private.assert_rate_limit incrémente dans la transaction métier : une exception ultérieure annule aussi le compteur. consume_rate_limit fournit déjà une opération séparée (20260915214500_add_consumable_rate_limit.sql).
Action : quotas utilisateur/organisation/opération avant effets externes ; borne de corps en streaming ; pas de token brut dans clés ou logs ; maintien exact du corps signé Stripe.

### S08 — P2 conditionnel : bypass CAPTCHA

[verified] orders/public/config.ts:42 active TURNSTILE_BYPASS indépendamment de l'environnement.
[assumed] Aucune preuve que le bypass soit configuré à distance.
Action : interdire la configuration bypass en production et tester les deux environnements. Vérifier également la confiance réelle accordée aux headers IP proxy avant d'en faire une clé de sécurité.

### S09 — P2 : frontière HTML et cache identité

[verified] MarkdownText.tsx:20 active rehypeRaw sans assainissement explicite. Descriptions et charte organisateur utilisent ce rendu.
[inferred] HTML non maîtrisé ; exécution JavaScript/XSS non démontrée. Préférer Markdown sans HTML brut ou allowlist minimale testée, selon contenu existant.
[verified] useAdminDashboardData.ts:78 construit un store lié au client singleton, pas à user.id.
[inferred] Changement d'identité sans démontage : possibilité de données anciennes affichées ; le logout normal recharge la page. Ce n'est pas une preuve de lecture serveur cross-tenant.
Action : clé identité + remise à zéro + rejet des réponses tardives de l'ancienne session.

### S10 — P2 : contrats et invariants à compléter

[verified] Stripe Connect possède des schémas frontend séparés des validations backend. OrderPage.tsx:24 redéfinit le DTO ; orders-read.ts accepte cancelled, non traité comme terminal dans la page (:65,78).
[inferred] Les conversions récursives snake/camel des repositories peuvent modifier les clés arbitraires JSON ; fixer le contrat des answers, ne pas transformer récursivement tout JSON métier.
[verified] Plusieurs relations orders/items/attendees/tickets utilisent des FK individuelles, sans démontrer à elles seules la même chaîne org/événement. Pas d'exploitation client universelle démontrée.
Action : DTO explicites, états canoniques, mappings bornés et invariants SQL ciblés au fil des migrations. Les types DB générés peuvent aider ; ils ne remplacent ni validation runtime ni DTO.

## 5. Chemins sensibles et contraintes d'ordre

PDG indisponible, analyse manuelle :

1. HTTP → taille/méthode → session ou signature → ressource/organisation → droit → quota → effet. Les rejets doivent précéder appel Stripe, mutation ou mail.
2. Paiement Stripe → vérification compte/session/montant/devise/mode → transaction de paiement → émission idempotente de billets → livraison récupérable.
3. Front produit/formulaire → écriture directe actuelle : aucune garde Edge ne couvre ce chemin tant que grants/policies le permettent.
4. Retrait RPC navigateur → vérifier aussi Edge appelant avec JWT utilisateur, Netlify, cron, webhooks externes et front déjà publié.
5. Quota consommé par requête SQL séparée : une erreur métier suivante ne doit pas annuler le comptage des tentatives.
6. Réorganisation de fichiers et changement de comportement sont séparés pour rendre la revue et le rollback lisibles.

Protections observées à préserver : auth.getUser, membership côté serveur, secrets Stripe serveur, signature HMAC et fenêtre temporelle, contrôle test/live, idempotence SQL, staging/capture mail et trigger protégeant stripe_connect_allowed (20260929123000_gate_stripe_connect_by_user.sql:34).

## 6. Regroupements et suppressions proposés

### Regrouper au fil des lots

- Une Edge events pour événements/produits/formulaires/promos ; sous-routes métier explicites.
- Une Edge organizations pour bootstrap/profil/billing/branding ; éviter un endpoint générique qui reçoit table/action.
- Étendre orders et invoices existants pour leurs opérations manquantes.
- Une petite API publique de catalogue ; inclure le consommateur Netlify.
- Regrouper Stripe start/status/settings dans le domaine paiements d'organisation seulement après stabilisation ; garder stripe-webhook-connect indépendant et ses URL compatibles.
- Un helper de rôle organisation, un lecteur HTTP borné, une enveloppe d'erreur et un mécanisme de quota existants ou minimes.
- Un repository de lecture de commande partagé entre page publique et widget ; conserver AbortSignal, no-store et validation de l'ID.
- Garder _shared/modules, _shared/app et _shared/services si leurs responsabilités restent distinctes. Réduire le nombre de dossiers n'est pas un objectif autonome.

### Code mort local à retirer par petits lots

Haute confiance par recherche des importateurs, sans preuve des consommateurs externes :
- Front : useStartMollieConnect et sa chaîne repository/tests devenue sans consommateur actif ; TextAreaWithToolbar → useMarkdownTextarea → applyMarkdown.
- Dépendances npm nodemailer et xlsx sans import trouvé ; exports participants utilisent exceljs. Supprimer via npm, mettre à jour package-lock.
- Backend : orders/public/mollie-auth.ts, mollie-payments.ts ; orders/admin/errors.ts ; accounts/mollie.ts ; subscriptions/first-payment.ts, recurring-payment.ts, env.ts, mollie.ts, subscription.ts. Plusieurs ne subsistent que parce que les tests les importent.
- _shared/encryption.ts : retirer seulement après preuve qu'aucun consommateur actif de déchiffrement ne subsiste.
- sendOrderConfirmation sans appelant actif : ne pas supprimer son dossier complet, qui porte aussi les instructions virement.
- Worker migrate-subscription-webhooks : encore routé ; il n'est pas mort, mais sa cible est désormais 410. Inventorier dépendances avant retrait.

Ne pas supprimer données Mollie, factures, colonnes historiques, RPC historiques ou endpoints distants avec le seul résultat Knip. Knip n'est pas configuré pour toutes les entrées Deno/Netlify ; ses faux positifs sont nombreux.

[verified] .github/workflows/deploy-environment.yml:104 déploie les fonctions locales sans inventaire explicite de suppression. Une ancienne suppression staging est documentée, pas un inventaire distant actuel. Comparer la liste réellement déployée aux neuf endpoints locaux et vérifier crons/callbacks.

## 7. Séquence exécutable par priorité

Règle : une tâche = une PR cohérente. Chaque lot termine avec code + tests + preuve des permissions avant/après. Ne pas faire exécuter l'intégralité de ce document dans une seule session de modèle.

### A0 — Inventaire effectif des ACL et dépendances — P0 — Sol high

**État : réalisé par Sol ; réconcilié avec dev à jour.** Conserver le rapport A0–A3 daté de son ancien HEAD. Actualiser les observations distantes uniquement lors d'une inspection explicitement ciblée ; ne pas rejouer tout le lot pour chaque tâche suivante.

Dépendance : aucune. Lire S01 et tests/database/baseline.sql.
Livrer un script de métadonnées sans valeurs sensibles : droits anon/authenticated/service_role, default ACL, SECURITY DEFINER, search_path, RLS/policies, endpoints déployés, crons et noms d'URL callbacks.
Rejouer migrations dans DB jetable ; lecture distante uniquement avec cible vérifiée. Rapport séparé dev/staging/prod.
Acceptation : statut exposé/non exposé/inconnu pour chaque RPC S01, pas seulement nom d'une policy. En cas d'exposition, A1 avant toute réorganisation.

### A1 — Fermer les RPC internes historiques — P0 si exposition, sinon P1 — Sol high

**État : déjà présent dans les commits distants intégrés ; migration locale additive conservée et replay validé.** Ne pas créer une troisième migration de révocation identique. La publication production reste une opération séparée non réalisée.

Dépendance : A0 ; pas de dépendance à la migration générale.
Nouvelle migration : REVOKE PUBLIC, anon, authenticated sur fonctions internes identifiées ; GRANT service_role seulement si nécessaire. Inventorier appelants et overloads. admin_grant_subscription reste strictement opérateur ou est retirée si absence d'usage prouvée.
Tests SQL réels : anon et utilisateur A refusés même avec UUID de B ; service peut réaliser l'opération attendue. Pas de fuite de booking token ni de changement de plan.
Stop : tout consommateur légitime exigeant un grant retiré doit être traité explicitement ; ne pas rouvrir globalement.

### A2 — Intégrité des groupes de formulaire — P1 — Sol high

**État : implémenté localement, suite SQL réussie après intégration.** Pas de réimplémentation ; préflight distant et publication restent distincts.

Dépendance : aucune après A0 ; lecture des trois sources S03.
Nouvelle migration de contrainte, inventaire des incohérences préexistantes sans correction silencieuse ; préserver SET NULL de group_id.
Tests SQL dans nouveau tests/database/form-scope-regressions.sql : A/A accepté, A/B refusé par INSERT et UPDATE, y compris B d'une autre organisation ; suppression groupe préserve champ.
Ne pas refondre toutes les FK du modèle dans cette tâche.

### A3 — Protéger les compteurs produit — P1 — Sol high

**État : implémenté localement, suite SQL réussie après adaptation de fixture.** Le test ouvre registrations_open seulement dans sa transaction annulée, pour satisfaire la nouvelle configuration plateforme. Aucun garde-fou de production n'est désactivé.

Dépendance : A0.
Recenser les colonnes réellement écrites par le front ; retirer capacité de modifier reserved_qty/sold_qty et autres champs système via Data API, tout en maintenant les champs légitimes jusqu'à B2.
Tests : membre A ne peut pas remettre stock à zéro directement ; achat/expiration/remboursement légitimes fonctionnent ; un autre tenant reste refusé.
Correction par privilèges de colonnes/guard ciblé à choisir après replay, pas un revoke global qui casse le front.

### A4 — Réponse paiement admin fidèle — P1 — Sol medium

Dépendance : aucune.
Modifier orders/admin/handler.ts et shared/schemas/orders-admin.ts uniquement si nécessaire ; parser payRes et retourner l'état calculé, définir échéance vs solde.
Tests dans tests Edge orders-routes-test.ts ou nouveau orders-admin-payment-test.ts : 100 EUR/10 EUR = partially_paid, full = paid, acompte = état SQL, devise/erreur/retry. Vérifier affichage du consommateur.
Ne pas changer les règles d'acompte dans cette correction.

Statut au 2 octobre 2026 : implémenté et testé localement uniquement. Le handler retourne désormais `partially_paid` pour un versement inférieur au total SQL effectif ; `dueNowCents` représente la part impayée de l'échéance initiale SQL. Les résultats invalides ne produisent plus de succès. Aucun push, merge, déploiement ni mutation distante. Voir [le compte rendu A4](../audits/2026-10-02-backend-api-security-a4.md) pour les preuves et limites, notamment l'idempotence HTTP préexistante.

### A5 — Livraison confirmations récupérable — P1 — Sol high

Dépendance : A1 pour droits internes.
Sous-lot 1 : traiter toutes les erreurs RPC et retirer garde functionsBase obsolète ; tests d'erreur de marquage.
Sous-lot 2 : bail récupérable SQL et tentative identifiable, idempotence fournisseur, reprise bornée dans workers ; réutiliser architecture de livraison déjà présente.
Tests : crash après claim, erreur fournisseur, erreur mark_sent, deux workers, retry webhook, email déjà envoyé ; aucun double paiement/billet.
Si les garanties fournisseur ne permettent pas exactly-once, documenter la limite explicitement.

Statut au 2 octobre 2026 : **les deux sous-lots A5 sont implémentés et testés localement uniquement**. Nouvelle migration additive, bail de 5 minutes avec fencing, plafond de 8 tentatives/backoff, reprise dans le cron authentifié existant, clé Resend stable et enveloppe/PDF/preuves contractuelles archivés avant envoi. Reprise automatique limitée à 23 heures (rétention fournisseur de 24 heures) ; anciens claims isolés en `legacy_unknown`, sans renvoi massif. Paiement, émission des billets et livraison restent distincts. Validation : 55 migrations, 11 suites SQL, deux connexions concurrentes réelles, 18 nouveaux tests e-mail et suites backend (210 tests) réussis. Aucun push, merge, déploiement ni mutation distante A5. Voir [le rapport A5](../audits/2026-10-02-backend-api-security-a5.md) pour garanties, limites, transition historique et ordre de publication.

### A6 — Persistance de session et cache — P1/P2 — Sol medium

**Statut d'exécution au 2 octobre 2026 : implémenté et testé localement, non déployé.** Les deux sous-lots sont présents dans le correctif local ; aucun commit/PR créé. Tests ciblés Auth/stockage/cache/logout/MFA : 33 réussis ; suite complète : 148 Vitest + 16 Node ; build et lint ciblé réussis. Les tests de hooks sont contrôlés, sans montage navigateur ; fermeture/restauration réelle, Web Locks et MFA réels restent à recetter. La partie session/cache D4 et le rejet de requêtes organisation du hook partagé sont couverts ; D1/D4 ne sont pas déclarés entièrement terminés. Voir [rapport A6 et contrat multi-onglets](../audits/2026-10-02-backend-api-security-a6.md).

Deux PR séparées.
1. authRepo/supabaseClient : respecter rememberMe sans copier vers stockage persistant. Tests session/localStorage, refresh, logout, deux onglets ; recette fermeture navigateur.
2. useAdminDashboardData : invalidation sur identité/org, annulation ou rejet des réponses tardives. A lent puis B connecté ne doit jamais afficher les données A.
Préserver les changements locaux AdminSignUpPage ; ne pas les écraser.

### A7 — Durcir les entrées HTTP — P2 — Sol medium

**Statut au 2 octobre 2026 : implémenté et testé localement, sans déploiement.** Rapport : [audit A7](../audits/2026-10-02-backend-api-security-a7.md). Limites inclusives en octets : Connect 4 096, webhook 1 048 576 ; dépassement → `413 PAYLOAD_TOO_LARGE`, sans traitement métier ni appel Stripe. Contrats et contrôles Stripe conservés ; bypass interdit en production et configuration ambiguë. Aucun quota A8 ni changement d'URL.

Dépendance : aucune.
Partager contrats Stripe Connect, remplacer req.json/text par lecteurs bornés, préserver le corps brut signé ; interdire TURNSTILE_BYPASS production.
Tests : JSON invalide, UUID invalide, gros flux sans Content-Length → 413 avant effet ; signature Stripe valide inchangée ; bypass autorisé seulement environnement prévu.
Ne pas changer les URL Stripe dans ce lot.

### A8 — Quotas homogènes — P2 — Sol high pour règle, medium pour branchements

**Statut au 2 octobre 2026 : implémenté et testé localement, sans déploiement.** Rapport et matrice réellement appliquée : [audit A8](../audits/2026-10-02-backend-api-security-a8.md). Quotas indépendants avant effets, tentatives de lecture avec token absent/invalide incluses, ressource seulement après accès, fail-closed `503 RATE_LIMIT_UNAVAILABLE` distinct de `429 TOO_MANY_REQUESTS`. Accounts/orders-public/platform-admin conservés sans double consommation ; webhooks et workers non soumis aux budgets utilisateur. IP fiable désactivée par défaut et repli partagé borné ; attestation d'entrée requise avant activation. Purge sept jours existante testée mais sans appel périodique versionné ; aucun nouveau SQL/cron/infrastructure. B0–B6 restent nécessaires pour fermer les accès directs.

Dépendance : A7.
Définir une petite matrice par opération, brancher consume_rate_limit avant coût externe. Clés user/org/opération ; lecture publique IP vérifiée + budget ressource, jamais token brut.
Tests 429 et Retry-After avant Stripe/mail/SQL métier ; une erreur métier consomme le quota ; A ne consomme pas le quota utilisateur de B ; panne limiteur échoue de façon explicite.
Séparer protection abus webhook et mécanisme de retry fournisseur ; ne pas casser les callbacks légitimes.

### B0 — Patron de migration d'un domaine — P2 — Sol high

**Statut au 2 octobre 2026 : tranche verticale implémentée et validée localement, fermeture différée livrée et testée ; aucun déploiement, B0 non clôturé sur les environnements publiés.** Pilote `POST invoices/list` (historique paginé), repository frontend migré, DTO minimal, membership owner/admin depuis session Auth, client serveur sans JWT utilisateur, filtres org/curseur, quotas. Migration différée hors `supabase/migrations` ferme RPC/surcharges, table/colonnes et policy Storage applicative équivalente après transition. Preuves SQL réelles dans transaction annulée avec/sans RLS et recette HTTP Auth/PostgREST/Storage sans RLS métier ; 15 tests frontend ciblés, 9 Deno ciblés. Le résumé bootstrap `latestOpenInvoice` reste un accès distinct hors pilote ; aucune suppression globale de policies RLS ni implémentation de B1–B6. Rapport, résultats globaux et séquence route → frontend → fermeture à échéance explicite : [audit B0](../audits/2026-10-02-backend-api-security-b0.md).

Dépendances : A1–A4.
Créer uniquement le petit patron nécessaire : contrat partagé, garde org, repository serveur avec filtre org/ressource, mapper de sortie et tests A/B/anon. Fixer le modèle service_role interne de la section 3 ; aucune nouvelle autorisation métier ne doit être ajoutée en RLS.
Utiliser une opération simple pour démontrer de bout en bout le modèle final, y compris refus de l'ancien accès direct.
Adapter explicitement les RPC utilisant auth.uid au contexte serveur ; l'acteur vient de l'identité authentifiée dans l'Edge. Interdire userId de confiance depuis le payload. Tester qu'aucun client privilégié ne reprend le JWT utilisateur. Vérifier la révocation des droits même lorsque RLS est désactivée dans la DB de test.
Ne pas introduire un router générique, DI framework ou nouveau monorepo.

### B1 — Organisations et facturation de profil — P2 — Sol medium après B0

**B1.1 au 3 octobre 2026 : implémenté/testé localement, sans déploiement.**
Bootstrap, création/update organisation, profils utilisateur/branding, identité vendeur
et acceptations migrés vers `organizations`. Fermeture tables/colonnes/RPC livrée hors
pipeline et testée avec/sans RLS ; application différée après backend/frontend.
13 tests Edge, 14 tests repositories, SQL atomique/preuves et build réussis.
B1.2 : routes, repository, contrats et transaction implémentés/testés localement
(9 Edge, 20 repository, SQL normalisation/partial/ACL et recette HTTP réelle sans
RLS) ; fermeture livrée/testée, différée. Garde cache session/org lecture/écriture
validée (33 tests repository/hook). B1.3 implémenté, 11 tests Edge et 20 tests
repository réussis ; recette Auth/HTTP/PostgREST/Storage locale avec fermetures
différées et RLS métier désactivée réussie. Revue B1 passée après correction de
la continuation abonnement (26 tests caller/hook/cancellation). Aucun déploiement.
Fermetures toujours différées ; exceptions paiement/conditions de vente B6 et
policies des domaines partagés consignées dans le rapport B1/B2.
[Rapport B1/B2](../audits/2026-10-03-backend-api-security-b1-b2.md).

Sous-lots, une opération ou famille étroite par PR :
- bootstrap + profil : get_dashboard_bootstrap, create_organization, update_organization, accès organization_profile/user_profile ;
- billing organisation : rpc_get_organization_billing, rpc_upsert_organization_billing ;
- assets : autorisation Edge d'upload, chemins imposés, MIME/taille, refus d'écrasement cross-org ; transfert signé direct documenté.
Acceptation : contrats, tests A/B/anon, erreurs UI, aucun mass assignment de rôle/plan/stripe_connect_allowed.
Préserver création atomique organisation + propriétaire.

### B2 — Événements, produits, formulaires, promos — P2 — Sol medium, revue high des droits

**B2.1 au 3 octobre 2026 : implémenté et testé localement, non déployé.**
Six routes events et cinq repositories migrés, contrats partagés et gardes A6.
15 tests Edge, 37 tests frontend, SQL réel et recette Auth/HTTP/PostgREST avec
fermeture/RLS off réussis. Duplication batch et quotas payants avant insertion
corrigés ; deux scénarios SQL concurrents prouvent le verrou et l'absence d'état
partiel. Fermeture RPC/table/colonnes livrée/testée, différée jusqu'aux consommateurs
produits/formulaires ; RLS partagée B3–B5 conservée.

**B2.2 : implémenté/testé localement, sans déploiement.** 15 tests Edge, 47 tests
frontend contrats/repositories/editor (60 avec gardes événements réutilisées),
SQL et recette réelle RLS off réussis. Stock 0/NULL distingué, compteurs et snapshots
préservés. Revue des verrous corrigée et cinq scénarios checkout/expiration réels
concurrents passent ; quotas payants inter-domaines sérialisés. Fermeture produits
table/colonnes/RPC livrée/testée et différée, RLS partagée B3 conservée.

**B2.3 : implémenté/testé localement, sans déploiement.** Neuf routes formulaires,
sept RPC internes, sept repos/hooks ; 20 tests Edge et 69 tests frontend ciblés,
SQL et HTTP réels avec RLS off passent. Options JSON exactes, A2 et snapshots
préservés, reorder transactionnel ; trois scénarios concurrents de quota réel et
d'ordre combiné passent. Limite obsolète de 30 non réintroduite. Fermeture
table/colonnes/RPC livrée/testée et différée ; RLS partagée B3/B5 conservée.
Revue indépendante favorable : conservation du panneau au refresh/erreur et
invalidations des retours d'ordre obsolètes validées dans la composition réelle.

**B2.4 : implémenté/testé localement, sans déploiement.** Cinq routes promotions,
trois RPC service-only, CRUD frontend et cache/callers A6 migrés. 16 tests Edge,
80 tests frontend ciblés, SQL et HTTP réels avec RLS off passent ; trois scénarios
checkout concurrents préservent compteur, snapshot et dernière utilisation.
Remises, dates partielles, code legacy, unicité et refus FK conservés, aucune
restriction de plan nouvelle. Relations legacy incohérentes refusées sans correction
automatique, y compris cascade événement. Revue indépendante favorable ; fermeture
table/colonnes livrée/testée et différée, RLS partagée B3 conservée.

**Validation finale B1/B2 au 3 octobre :** replay frais des 61 migrations actives,
12 suites SQL existantes, 7 suites B1/B2 et preuves ACL B0/B1/B2 réussis ; cinq
recettes concurrentes (16 scénarios) et HTTP Auth/PostgREST/Storage réel réussis.
`check:backend`, `lint:backend`, `test:backend` (396 tests), `npm test` (486 Vitest
+ 16 Node) et `npm run build` passent. Stack jetable arrêtée. Matrice complète,
exceptions non migrées, limites et ordre de publication dans
[le rapport B1/B2](../audits/2026-10-03-backend-api-security-b1-b2.md).
Aucun commit/push/déploiement ni mutation distante ; fermetures différées.

Sous-lots successifs :
- événements : get_events_overview, get_event_detail_admin_core, create_event, update_event, duplicate_event et suppression directe ;
- produits : create_event_product, update_event_product et lectures/suppressions directes ;
- formulaires : create_event_form_field, create_event_form_field_group et modifications/suppressions directes ;
- promos : CRUD direct promo_codes.
Chaque sous-lot livre endpoints events, front migré, contraintes de plan et tests négatifs, puis fermeture des accès directs concernés.
Tests supplémentaires : stock 0/null explicite, formulaires JSON inchangés, groupe étranger, quotas, duplication transactionnelle, code promo tenant étranger.
Aucune payload ne contient compteurs système ou orgId modifiable librement.

### B3 — Commandes et participants — P2 — Sol high

**Au 3 octobre 2026 : B3.1–B3.5 implémentés et testés localement, sans déploiement.**
Les anciennes voies sont fermées dans les tests sur base jetable ; leur fermeture
est livrée hors pipeline et reste **différée** sur les environnements publiés.
Rapport et limites : [audit B3](../audits/2026-10-03-backend-api-security-b3.md).

| Sous-lot | Implémenté | Testé | Accès direct fermé | Fermeture différée | Déployé |
| --- | --- | --- | --- | --- | --- |
| B3.1 — Listes/recherches | Oui : trois routes orders, pagination/filtres SQL | Edge, repositories, SQL et HTTP réels | Base jetable seulement | Oui : RPC/tables/colonnes | Non |
| B3.2 — Export participants | Oui : pages SQL ≤100 commandes, curseur UUID/borne/timestamp | 1005 commandes sur 11 pages, XLSX texte, isolation | Base jetable seulement | Oui | Non |
| B3.3 — Modification participant | Oui : answers stricts, acteur/chaîne serveur, JSON inchangé | Contrats, SQL et HTTP ; références étrangères rejetées | Base jetable seulement | Oui | Non |
| B3.4 — Suppression commande | Oui : transaction/cascades historiques conservées ; règle métier à relire | Stock/billets/paiements/logs, rollback et répétition/concurrence | Base jetable seulement | Oui ; revue classification stock/historique avant publication | Non |
| B3.5 — Suivi/expiration virement | Oui : résumés paginés, expiration atomique existante | Paiement/expiration dans les deux ordres, répétition, quotas/isolation | Base jetable seulement | Oui | Non |

La suppression ne comporte pas de restriction par statut ; expired/partially_paid
restent classés en stock réservé comme historiquement. Risque de libération
incorrecte et disparition de l'historique payé documentés, sans règle financière
inventée. Export sans snapshot MVCC inter-pages ; suppression concurrente peut
retirer une ligne ou invalider un curseur. Aucun check-in/QR B4 migré.
Validation : 62 migrations rejouées, suites SQL existantes/B1–B3, vrais rôles
avec/sans RLS, concurrence PostgreSQL et recette Auth/PostgREST ; contrôles backend,
tests frontend et build réussis. Fermeture SQL après Edge/frontend et transition
B0 de 24 h, dans une release distincte. Aucun push/fusion/publication.

Étendre orders. Sous-lots : recherche/liste ; export paginé ; modification participant ; suppression ; suivi/expiration virement.
RPC : search_event_admin_orders_view, search_event_admin_tickets_view, get_event_admin_orders_view, get_event_admin_participants_export_data, admin_update_order_attendee, admin_delete_order, get_bank_transfer_admin_summaries, expire_bank_transfer_order.
Tests : organisation étrangère, modification prix/statut refusée, JSON answers préservé, export borné, effets stock/tickets corrects, reprise suppression conforme au contrat.
Préserver atomicité SQL ; pas de transaction reconstruite en suite de requêtes JS.

### B4 — Billets et check-in — P2 — Sol high

**Actualisation du 3 octobre 2026 : implémenté/testé localement, non déployé.**
Rapport : [B4](../audits/2026-10-03-backend-api-security-b4.md).

| Sous-lot | Implémenté | Testé | Accès direct fermé | Fermeture différée | Déployé |
| --- | --- | --- | --- | --- | --- |
| B4.1 — Liste billets | Oui : orders/admin/tickets-list, page SQL bornée et tri déterministe | SQL, Auth/HTTP réel, DTO, repository et identité | Base jetable uniquement | RPC/table/colonnes livrées/testées | Non |
| B4.2 — Check-in ID | Oui : orders/admin/ticket-check-in, chaîne serveur et acteur vérifié | Refus scopes/annulé, répétition, rollback, quotas, double scan concurrent réel | Base jetable uniquement | Ancienne RPC + helper livrés/testés | Non |
| B4.3 — Check-in QR/scanner | Oui : orders/admin/ticket-check-in-qr ; scanner migré et réponses obsolètes ignorées | QR forgé/étranger, Auth/HTTP, acteur du premier scan conservé | Base jetable uniquement | Ancienne RPC livrée/testée, après scanner et transition B0 | Non |

**Règle métier non confirmée :** le SQL historique accepte les billets `refunded`
et `blocked` et ne vérifie pas le statut financier de leur commande. Comportement
conservé et prouvé, sans nouvelle règle financière supposée. Le refus de billets
remboursés n'est pas acquis ; relecture/décision avant publication. Recette caméra
physique non faite. 63 migrations rejouées, suites SQL historiques/B1–B4 et ACL
sans RLS, concurrence PostgreSQL, HTTP réel ; contrôles backend, tests et build
réussis. Publication additive Edge/frontend puis fermeture dans une autre release
après transition B0 de 24 h. Aucun push/fusion/déploiement.

get_event_tickets_admin, mark_ticket_checked_in, mark_ticket_checked_in_by_qr ; sous-routes du domaine events ou orders choisi dans B0.
Tests double scan concurrent, QR falsifié, ticket autre événement/org, statut annulé/remboursé, répétition sûre et acteur de scan fiable.
Fermer le chemin RPC navigateur seulement après migration du scanner.

### B5 — Factures et catalogue public — P2 — Sol medium

**Actualisation du 3 octobre 2026 : implémenté/testé localement, non déployé.**
Deux changements à relire/publier séparément, aucun commit/PR distante créé :
[factures](../audits/2026-10-03-backend-api-security-b5-invoices.md) et
[catalogue public](../audits/2026-10-03-backend-api-security-b5-catalogue-public.md).

| Sous-lot | Implémenté | Testé | Accès direct fermé | Fermeture différée | Déployé |
| --- | --- | --- | --- | --- | --- |
| B5.1 — Factures | Historique B0 réutilisé ; PDF autorisé avec membership central/client serveur | SQL, rôles réels, Auth/Storage ; A/B, pagination, sessions et quotas ; RPC membership révoquée localement | Base jetable seulement | B0 réutilisée, livrée/testée | Non |
| B5.2 — Catalogue public | Cinq routes events/public, DTO minimaux, pagination SQL et quotas ; Netlify migré | 205 événements/7 pages, ressources cachées, JSON, HTTP/SQL sans RLS, bundle Netlify réel et anciens accès refusés | Base jetable seulement | B5 RPC/helpers/tables/colonnes livrées/testées ; après frontend ET Netlify et transition B0 | Non |

64 migrations rejouées, suites SQL/ACL B0–B5 et concurrences B3/B4, 413 tests
backend, 514 Vitest + 16 Node, build et lint ciblé réussis. Historique Mollie et
règles financières inchangés. Organisations inactives cachées sur détail/termes,
images par défaut de l'environnement courant, réponses no-store. Pagination sans
snapshot MVCC inter-pages ; ingress IP non attesté ; profil sans conditions ≥200
caractères conserve la limite du contrat existant. Aucune recette visuelle/staging
ni publication. B6 reste hors périmètre de ce lot.

Deux PR séparées.
- invoices : rpc_list_invoices, pagination et lien PDF déjà protégé ; test facture A refusée à B.
- catalogue public : get_public_org_by_slug, get_public_org_events_overview, get_public_event_detail, get_public_organization_sales_terms ; sorties minimales, événements non publiés cachés, quotas/cache appropriés.
Migrer également netlify/functions/share-event.js ; il est un consommateur externe au front React.
Conserver l'historique factures Mollie.

### B6 — Fermer la frontière et contrôler les régressions — P2 — Sol high

**Statut au 3 octobre : implémenté/testé localement ; accès directs fermés seulement
en base jetable ; fermetures et retrait RLS différés, non déployés.** Scanner AST
CI avec allowlist Auth explicite/Storage vide ; derniers RPC serveur de paramètres
de paiement adaptés à l’acteur/client privilégié, création administrative sans
RPC membership utilisateur ; defaults postgres corrigés.
65 migrations, vrais rôles/GraphQL sans RLS, sept recettes HTTP B0–B6 et concurrences
réussies. Fermeture complète et defaults supabase_admin nécessitent le créateur
géré : pas de promotion par simple db push postgres ni d’escalade de membership.
Revue high, attestation distante des schémas/créateurs/consommateurs, transition B0
et publication distincte du retrait RLS restent requises. [Rapport B6](../audits/2026-10-03-backend-api-security-b6.md).

Dépendances : B1–B5.
Inventaire final des usages RPC/.from dans src et Netlify ; allowlist explicite des seules exceptions Auth/Storage.
Grants restants, RPC internes, vues, séquences, GraphQL, éventuel Realtime et schémas exposés vérifiés par tests SQL/API directs sous anon/authenticated. Corriger les default privileges des rôles créateurs pour que les objets futurs soient fermés par défaut.
Ajouter contrôle CI borné sur nouveaux accès métier directs ; pas une regex aveugle qui confond Storage et DB.
Backend et ancien front : déploiement compatible en phases. Ajouter route avec autorisation Edge → migrer front et consommateurs externes → attendre adoption/fin fenêtre → révoquer accès directs → prouver le refus sans RLS → retirer policies et désactiver RLS métier du domaine. Le retrait de RLS est une migration séparée avec tests d'accès direct et revue high. Les fenêtres d'urgence sécurité doivent être nommées et traitées séparément.

### C1 — Nettoyage local démontré — P3 — Sol light

**Statut au 3 octobre : les trois sous-lots sont implémentés/testés localement,
sans commit ni publication.** 21 fichiers morts et deux dépendances retirés ;
routes historiques réelles 410 testées, circuits Stripe/interne et instructions
virement conservés. Worker routé, données et fonctions distantes conservés.
Les trois ensembles restent à relire/committer séparément. [Rapport C1](../audits/2026-10-03-backend-api-security-c1.md).

Dépendance : A0 pour les éléments avec consommateurs externes ; le code UI purement orphelin peut partir avant.
Une PR frontend mort, une PR modules Mollie tests-only, une PR dépendances npm.
Retirer tests testant uniquement du code retiré ; ajouter ou préserver tests des routes réelles 410 et parcours Stripe/interne.
Aucun retrait de données historiques ni de fonctions distantes sans inventaire.

### C2 — Contrats, Markdown et documentation — P2/P3 — Sol light / medium

**État local au 3 octobre : implémenté et testé ; non déployé.** Lecteur commun page/widget, normalisation des annulations, Markdown sans HTML brut, documentation Stripe/interne, mappings SQL plateforme bornés préservant le JSON imbriqué. Rendu HTML testé ; recette visuelle navigateur non effectuée. Voir [rapport C2–D5](../audits/2026-10-03-backend-api-security-c2-d5.md).

PR indépendantes :
- light : OrderPage utilise contrat partagé, normalisation canceled/cancelled, repository lecture commun page/widget ; tests cas annulé ;
- medium : Markdown sans HTML brut ou allowlist et tests de non-régression visuelle/contenu ;
- light : documentation architecture et TODO mise à jour pour Stripe/abonnement interne, suppression des consignes Mollie devenues inactives ;
- medium : mappings explicites des champs transport, couverture JSON imbriqué.
Ne pas appliquer une conversion snake/camel globale sur tous les payloads.

### D0 — Socle plateforme déjà livré dans dev — terminé, ne pas recréer

**Remplacé : ne pas recréer le socle.** Les commits intégrés contiennent /platform, platform-admin, platform-config, le registre privé, les contrats, MFA et step-up. La revue statique confirme JWT vérifié, session active et administrateur recontrôlés, AAL2, token de step-up lié acteur/session/action/cible et usage unique. Les RPC plateforme sont fermées aux rôles navigateur. Les autorisations restent actuellement également vérifiées dans des helpers SQL serveur : la cible Edge-only ne justifie pas leur retrait précipité.

### D1 — Empêcher une action sur la mauvaise organisation — P1 — Sol medium

**État local : implémenté et testé ; non déployé.** Protections de session/génération déjà présentes conservées ; trois mutations verrouillées sur l’identité chargée et l’URL. Tests B puis A, refus des identités incohérentes et cibles exactes.

Sources : src/app/modules/platform/hooks/usePlatformQuery.ts:11 et pages/PlatformOrganizationPage.tsx:13,22.
Une réponse A tardive peut remplacer les données affichées après navigation B, alors que les mutations ciblent B depuis l'URL. Ajouter génération de requête/annulation, remise à zéro au changement de clé et verrou des actions tant que l'identité chargée ne correspond pas à l'identité courante. Tester deux promesses résolues B puis A, et la cible exacte de chaque mutation. Aucun changement de permissions serveur requis.

### D2 — Ne pas afficher une erreur après une mutation réussie — P1/P2 — Sol medium

**État local : implémenté et testé ; non déployé.** Références formulaire capturées avant attente ; tests différés de reset, succès sans faux échec et conservation de la clé après échec.

Sources : src/app/modules/platform/pages/PlatformOnboardingPage.tsx:35 et PlatformAdminsPage.tsx:17.
Capturer la référence formulaire avant await : event.currentTarget est remis à null après dispatch React. Après succès onboarding, le code renouvelle actuellement la clé puis échoue au reset ; il peut afficher succès et erreur avec les champs encore remplis. Tester résolution différée, formulaire vidé, absence de faux échec et conservation de la même clé tant que le succès n'est pas confirmé. Un deuxième onboarding séquentiel est normalement refusé par le contrôle de membership : ne pas affirmer un doublon systématique.

### D3 — Onboarding atomiquement idempotent — P2 — Sol high

**État local : implémenté ; migrations rejouées et concurrence SQL réelle testée ; accès navigateur déjà fermé ; non déployé.** Nouvelle migration `20261003190000` : verrou avant replay/membership et création de l’autorisation avec conflit atomique. Deux connexions `service_role` réussissent, une organisation et un seul audit métier. Invitations Auth testées séparément via SMTP local.

Source : supabase/migrations/20260930174530_platform_admin_backoffice.sql:1197–1274. L'opération est lue sans FOR UPDATE et les préconditions précèdent l'UPDATE qui bloque le concurrent. Reproduction réelle : le premier appel réussit, le second reçoit 23505 organizations_one_per_creator ; un retry séquentiel renvoie replayed:true. **La contrainte empêche le doublon : le défaut confirmé est un échec de replay concurrent, pas une double création.** Ajouter une nouvelle migration verrouillant l'opération avant lecture de completed_at/membership ; préserver acteur, payload hash, session et contrainte d'unicité. Tester deux connexions concurrentes même clé : une organisation et deux réponses de succès dont une rejouée. Ne pas modifier la migration déjà appliquée.

### D4 — Session plateforme, MFA et tests SQL réels — P2 — Sol medium/high

**État local : protections de session existantes revalidées, consigne corrigée, procédure et tests SQL/Auth locaux livrés ; non déployé.** Expiration, action/cible/session étrangères, révocation, concurrence et replay testés avec vrais rôles. Récupération TOTP réelle locale, sessions révoquées et invitation SMTP capturée : [procédure opérateur](../runbooks/platform-mfa-recovery.md). Vérification humaine d’identité et recette hébergée restent opérateur.

Étendre A6 : PlatformAccessGate.tsx:15 doit invalider l'état allowed lors du changement d'identité ; les caches plateforme doivent être liés à la session et refuser les réponses tardives. Tester admin A → utilisateur B sans démontage, sans fuite d'affichage.
Corriger la consigne PlatformMfaPage.tsx:243 : retirer/réattribuer le rôle ne réinitialise pas le facteur Auth perdu. Écrire une procédure de récupération contrôlée et testée ; ne pas improviser un endpoint de reset.
Compléter les tests SQL de step-up réel : expiration, replay, autre cible/action/session, révocation admin et concurrence. Les tests Deno mockés et les assertions catalogue existantes ne prouvent pas ces parcours de bout en bout.

### D5 — Reprise des campagnes et versions légales — P2/P3 — Sol medium/light

**État local : implémenté ; migration rejouée, concurrence/permissions SQL et erreurs fournisseur simulées testées ; ancien writer neutralisé ; non déployé.** Reprise explicite de la même campagne/payload : trois tentatives, délai d’une minute, bail de dix minutes, fenêtre de 23 heures et clés prestataire stables. Champs/clé frontend conservés après échec partiel. Constantes communes pour affichage/acceptation juridique. La bascule SQL/Edge campagnes doit être coordonnée ; aucun nouvel accès navigateur et aucune publication réelle.

Deux PR : (1) définir une reprise bornée et idempotente des livraisons failed, aujourd'hui exclues de la sélection pending ; tester erreurs fournisseur, retry, concurrence et journalisation ; (2) réutiliser les constantes shared/legal/documents.ts dans les payloads actuellement codés en dur, avec tests version affichée = version acceptée.
Les invitations Auth de l'onboarding ne passent pas par MAIL_MODE=capture : fixtures et transport Auth de test obligatoires. L'audience organizer de platform-config est sélectionnable anonymement ; les annonces correspondantes ne sont pas des données confidentielles.

### Brief commun à copier pour chaque tâche

« Exécute uniquement [ID/sous-lot] de ce plan sur dev. Revalide HEAD et les sources citées, préserve les changements locaux. Lis les AGENTS applicables. Implémente le plus petit changement cohérent. N'effectue aucun push, merge, déploiement, paiement live ou test sur données clients. Ajoute les scénarios indiqués et prouve les refus avec de vrais rôles DB lorsque SQL est touché. La cible est une autorisation métier uniquement Edge. Ne retire les policies RLS d'un domaine qu'après migration des consommateurs, fermeture des grants directs et tests de refus. N'applique pas un remplacement mécanique par service_role sans garde d'identité, organisation et ressource. Rapporte fichiers, comportement modifié, commandes/résultats et limites. Arrête-toi après ce lot. »

Pour Sol light : fournir liste fermée de fichiers et comportement à préserver ; aucune décision de permissions.
Pour Sol medium : une route/famille bornée, contrat et scénarios déjà décidés.
Pour Sol high : frontières d'autorisation, migrations/grants, transactions, concurrence, paiements et reprises.

## 8. Validation

Validation initiale sur l'ancien HEAD (conservée pour historique) :
- npm test : 92 tests Vitest + 16 tests Node réussis ;
- npm run test:backend : 110 réussis ;
- npm run check:backend : réussi ;
- npm run lint:backend : réussi, 172 fichiers vérifiés ;
- npm run build : réussi ; avertissement chunk JS proche de 2,97 MB minifié ;
- Knip local : exit 1 pour signalements ; sorties filtrées manuellement, pas une preuve autonome de code mort.

Actualisation après synchronisation : npm test = 121 Vitest + 16 Node réussis ; test:backend = 136 réussis ; check:backend et lint:backend réussis (182 fichiers) ; build réussi avec avertissement de chunk de 3,06 MB minifié. Rejeu des 54 migrations et neuf suites SQL effectué sur une base jetable distincte, avec adaptation de la fixture A3 à registrations_open. Aucun test navigateur d'exploitation, aucune mutation distante et aucun lint frontend global revendiqués. Voir le rapport complémentaire pour les limites et les preuves de concurrence.

Tests SQL existants à conserver : tests/database/baseline.sql et suites payment-delivery/stripe-checkout/stripe-webhook-retries/subscription-renewal.
Tests Edge existants : orders-routes-test.ts, payment-delivery-test.ts, stripe-checkout-lifecycle-test.ts et tests auth/rate-limit/worker.
Nouveaux tests ciblés : sensitive-rpc-acl.sql, form-scope-regressions.sql, product-system-columns.sql, orders-admin-payment-test.ts, confirmations-retry-test.ts ; noms proposés, pas fichiers déjà présents.

Matrice minimale pour chaque nouvelle route : anonyme, jeton invalide/expiré, utilisateur A, owner/admin A, utilisateur B, ressource B, payload malformé/surdimensionné, quota dépassé, retry/concurrence selon effets.
Vérifier aussi le chemin Data API direct : une route correctement protégée ne prouve pas la fermeture de l'ancienne API.

## 9. Risques de migration et impact

- Revocations prématurées cassent front publié, RPC invoquées au JWT, Storage ou Netlify.
- Le modèle cible ne repose plus sur RLS : un oubli d'autorisation ou de filtre avec service_role peut traverser les tenants. Garde serveur, repositories bornés et tests A/B sont obligatoires. Les contraintes d'intégrité DB restent conservées, sans dupliquer les permissions utilisateur.
- Le passage SQL→JS ne doit pas casser atomicité stock/commande/tickets.
- Anciennes URL peuvent être enregistrées hors dépôt ; inspecter callbacks/crons et fonctions distantes.
- Une contrainte ajoutée peut échouer sur données existantes ; inventaire et correction métier séparée.
- Une réponse paid corrigée peut changer affichage/flux frontend : c'est un changement production réel.
- Regrouper start/status Stripe implique migration URL ; ne pas le mélanger au correctif sécurité.
- Suppression Mollie vise code inactif ; conservation légale/métier des factures et paiements n'est pas modifiée.
- Les changements locaux préexistants touchent déploiement et inscription production ; ils n'ont pas été intégrés, annulés ni publiés par cet audit.

## 10. Fichiers attendus selon les lots

- A0/A1/A2/A3 : nouvelles migrations uniquement, tests/database, script d'inventaire métadonnées.
- A4 : orders/admin/handler.ts, contrat orders-admin et tests Edge.
- A5 : orders/public/emails.ts, stripe-checkout-lifecycle.ts, worker existant, nouvelle migration claim, tests.
- A6 : authRepo.ts, supabaseClient.ts, useAdminDashboardData.ts et tests ciblés.
- A7/A8 : Stripe endpoints, shared/schemas, helpers body/rate-limit existants, tests.
- B1/B2 : nouveaux domaines Edge organizations/events et repositories frontend correspondants ; pas déplacement global modules.
- B3/B4/B5 : orders/invoices et domaines choisis, repositories existants, netlify/functions/share-event.js.
- C1/C2 : seulement fichiers morts confirmés, package.json/package-lock et documentation/DTO concernés.
- D0 : domaine platform-admin et registre privé nouveaux si ce produit est engagé ; ne pas transformer user_profile en source de privilèges éditable.

## 11. Contexte réutilisable

```json
{
  "implementation_context": {
    "task_summary": "Migration vers autorisation métier uniquement Edge Functions, sans dépendance RLS, avec Data API métier fermée aux clients",
    "acceptance_criteria": [
      "refus cross-tenant API et accès direct",
      "contrats partagés",
      "invariants SQL conservés",
      "lots indépendants",
      "Refus accès directs prouvé avec RLS désactivée",
      "Permissions métier exclusivement Edge",
      "Default privileges fermés et policies métier retirées"
    ],
    "evidence_provenance": {
      "schema_version": 2,
      "head_commit": "4ef53f40c779b7bdbe65f80630a0d37bc7973574",
      "generated_plan_path": "docs/plans/2026-10-02-gitnexus-plan-backend-api-security-audit.md",
      "global_dirty_digest": {
        "algorithm": "sha256",
        "canonicalization": "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records",
        "value": "2e9f3ca96b1dfe2d5182b214fd5a4a33c12398033d34962128d19af33a0f25a6"
      },
      "cited_path_manifest": [
        {
          "path": ".github/workflows/deploy-environment.yml",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:46f92d7652132df74e7ad5351bae0cf97aa2ce79a1203c1993849b867d98f596",
          "index_digest": "sha256:46f92d7652132df74e7ad5351bae0cf97aa2ce79a1203c1993849b867d98f596",
          "worktree_digest": "sha256:e04b524cf1a25e571675ed3bf1e8be808dd15cc6354cfb77b7051959090267f4",
          "untracked_digest": "absent"
        },
        {
          "path": "docs/ARCHITECTURE.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:1a07d33890159072019b25a7c291c5e03aca8ecedd9c4f5eb058b7aee39a2330",
          "index_digest": "sha256:1a07d33890159072019b25a7c291c5e03aca8ecedd9c4f5eb058b7aee39a2330",
          "worktree_digest": "sha256:7ef03b5f528df042d88bd61bc89a0a4ea9ab00fae9713362a590395f7249dc51",
          "untracked_digest": "absent"
        },
        {
          "path": "docs/audits/2026-10-02-backend-api-security-a0-a3.md",
          "object_kind": {
            "head": "absent",
            "index": "absent",
            "worktree": "absent",
            "untracked": "regular"
          },
          "state": "untracked",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "absent",
          "index_digest": "absent",
          "worktree_digest": "absent",
          "untracked_digest": "sha256:01b12b1042e9c018fe1f60358ad31dbd0f79d956fd0bbb45992ca29dd738e45f"
        },
        {
          "path": "docs/audits/2026-10-02-backend-api-security-remote-metadata.json",
          "object_kind": {
            "head": "absent",
            "index": "absent",
            "worktree": "absent",
            "untracked": "regular"
          },
          "state": "untracked",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "absent",
          "index_digest": "absent",
          "worktree_digest": "absent",
          "untracked_digest": "sha256:14e629d2de38be37106d80009a3aeb5261a0141ff445da3bbc10a7e78833be73"
        },
        {
          "path": "docs/audits/2026-10-02-dev-sync-platform-security-review.md",
          "object_kind": {
            "head": "absent",
            "index": "absent",
            "worktree": "absent",
            "untracked": "regular"
          },
          "state": "untracked",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "absent",
          "index_digest": "absent",
          "worktree_digest": "absent",
          "untracked_digest": "sha256:fe79b60bb143f1d28467fdbe39387909b5c554651d792fdfae32f1df47a5f2b2"
        },
        {
          "path": "docs/todo/platform-admin.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:3117f66984e9fefd6dc8fd5034d23bf9fbcbdb6c2db5a8db8d83afefc3ea1649",
          "index_digest": "sha256:3117f66984e9fefd6dc8fd5034d23bf9fbcbdb6c2db5a8db8d83afefc3ea1649",
          "worktree_digest": "sha256:4c015155076ce79674f8c0d4758bc526436c18b820a574a4c54b2417d4dd54ea",
          "untracked_digest": "absent"
        },
        {
          "path": "netlify/functions/share-event.js",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:1eac369408a6209a59e650f4a9b619dcd317427ce168b475c0f1611e141020f9",
          "index_digest": "sha256:1eac369408a6209a59e650f4a9b619dcd317427ce168b475c0f1611e141020f9",
          "worktree_digest": "sha256:268a0c119f909b627a66e56bcd43be79808ecbe9fabc8cc49327f5ce0281f388",
          "untracked_digest": "absent"
        },
        {
          "path": "package.json",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:74a47e6a9886084cb0c0baa4a59f850540a64351f778f0c66f5449f1a949b56b",
          "index_digest": "sha256:74a47e6a9886084cb0c0baa4a59f850540a64351f778f0c66f5449f1a949b56b",
          "worktree_digest": "sha256:c37c2388db500f128f6ebb149da6b9ede41d498f1f7d3ef23a2562740c51d206",
          "untracked_digest": "absent"
        },
        {
          "path": "shared/legal/documents.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:b879fcd9a6e823ab31662f5fa14c2417abf319c38f8d7cafa13d6681c4c5c18d",
          "index_digest": "sha256:b879fcd9a6e823ab31662f5fa14c2417abf319c38f8d7cafa13d6681c4c5c18d",
          "worktree_digest": "sha256:9e62cb749642b7eaefcb74a786b4283447c0e8231571ced7eb55b0504c7722b9",
          "untracked_digest": "absent"
        },
        {
          "path": "shared/schemas/orders-admin.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:bc7198b535fae12668fdf585a898749deabb523544ae2218e13471951ab9708c",
          "index_digest": "sha256:bc7198b535fae12668fdf585a898749deabb523544ae2218e13471951ab9708c",
          "worktree_digest": "sha256:0618ff959e373a0712060358947c2819501a82abd91e0f67392d7fe23d22fc93",
          "untracked_digest": "absent"
        },
        {
          "path": "shared/schemas/orders-read.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:96fd6567919e9cd24021651ae7a919dd7e3ebf3b490285d60f29fc5a219b7f1d",
          "index_digest": "sha256:96fd6567919e9cd24021651ae7a919dd7e3ebf3b490285d60f29fc5a219b7f1d",
          "worktree_digest": "sha256:77c85c57fcb5040c7045909fc37300071b031e4a7e9031397eee1359b712d41c",
          "untracked_digest": "absent"
        },
        {
          "path": "shared/schemas/organization-sales-terms.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:b23c640eb7b0600164d21b9cb52f65e438e1ed680559a48b5f88772272ebdcea",
          "index_digest": "sha256:b23c640eb7b0600164d21b9cb52f65e438e1ed680559a48b5f88772272ebdcea",
          "worktree_digest": "sha256:d932bf06e2f0cb090d8868bdc3ff676ef68271916ca2cbf4942e528cfb0217cf",
          "untracked_digest": "absent"
        },
        {
          "path": "shared/schemas/platform-admin.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:3549c47a2aac1daa96f5f278f672353f24192094d1cc2c7b58266b8ebffc6401",
          "index_digest": "sha256:3549c47a2aac1daa96f5f278f672353f24192094d1cc2c7b58266b8ebffc6401",
          "worktree_digest": "sha256:d2a50eacc8fa51afb1ba94803bed832914e33875608d2c863011602e1dec7591",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/modules/admin/auth/data/authRepo.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:9c70e943db97db948b186ba20c8dd6cb3d7139f8fc1454f426772aad4ff2b4c4",
          "index_digest": "sha256:9c70e943db97db948b186ba20c8dd6cb3d7139f8fc1454f426772aad4ff2b4c4",
          "worktree_digest": "sha256:ab94cf9203f23e6dc7753b73c7754831fa9b86157c15ea33c9925084f44bd4af",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/modules/admin/dashboard/hooks/useAdminDashboardData.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:c37c70d5e6d220bbcdc653cae28434717e14432a12335682c88ae41aa533d124",
          "index_digest": "sha256:c37c70d5e6d220bbcdc653cae28434717e14432a12335682c88ae41aa533d124",
          "worktree_digest": "sha256:15d7b6ddf8e694bad303129803c89e0d18a6a32d8848c0d5529dadff57ae4d50",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/modules/admin/forms/data/updateEventFormFieldRepo.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:33a62db9116872a32ee745e97c08eb48030d097be710f31b7d874dce4d3c8f28",
          "index_digest": "sha256:33a62db9116872a32ee745e97c08eb48030d097be710f31b7d874dce4d3c8f28",
          "worktree_digest": "sha256:8facd443a6b07ebebde5332356559511b6b4c7294bc710944ab191a6d220be99",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/modules/admin/organization/data/sellerComplianceRepo.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:f61bb305b5db215b32e4489791b7d1556fcd2642ce2add48f43467d80926a91d",
          "index_digest": "sha256:f61bb305b5db215b32e4489791b7d1556fcd2642ce2add48f43467d80926a91d",
          "worktree_digest": "sha256:4df0562652026d1f7e64f6a61c766358adc9135df7994e99baef727da6d67b44",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/modules/platform/auth/PlatformAccessGate.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:fa381620b9ba18f896e561b0bb15ca0ec9f64a77ab726a079dc39f2d6e5aafa1",
          "index_digest": "sha256:fa381620b9ba18f896e561b0bb15ca0ec9f64a77ab726a079dc39f2d6e5aafa1",
          "worktree_digest": "sha256:3036c011c2f00439143e9ad71c07794f4d0261aba6422ad1128f5a4e78e18ec2",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/modules/platform/auth/PlatformMfaPage.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:15044db9b8133a77060a8ed41898f685fcf3670ef137905ebbb50e05b1583478",
          "index_digest": "sha256:15044db9b8133a77060a8ed41898f685fcf3670ef137905ebbb50e05b1583478",
          "worktree_digest": "sha256:b0e97845da1c2e723627eff32bdf9285f82cf0395cb5359d36703fc49c485c43",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/modules/platform/data/platformAdminRepo.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:a5a650ebbeaf59d5ef951cd2ce10a0d97bd52534abbb873c928fd0905ff955c4",
          "index_digest": "sha256:a5a650ebbeaf59d5ef951cd2ce10a0d97bd52534abbb873c928fd0905ff955c4",
          "worktree_digest": "sha256:e4522418ea68b35b6b30b169a2896f5f742e8cccdf65a14c2d87afe76fcb1e83",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/modules/platform/hooks/usePlatformQuery.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:0d74f73a37c56483f953578cec6faa44c46f651ef7d2a52c2a31a19e33c191f6",
          "index_digest": "sha256:0d74f73a37c56483f953578cec6faa44c46f651ef7d2a52c2a31a19e33c191f6",
          "worktree_digest": "sha256:f1a32ceef705086a0c30f79fe7d43715067f68c481d646f4122585af4eff765e",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/modules/platform/pages/PlatformAdminsPage.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:7b928af7b119921a9c20161fb7f9fd0d20ea506bf2ddd60f5afd438d4a224dcc",
          "index_digest": "sha256:7b928af7b119921a9c20161fb7f9fd0d20ea506bf2ddd60f5afd438d4a224dcc",
          "worktree_digest": "sha256:76cdc16699aaabf1b59bb90180b40e8a4a6d669ec7f6aee011eabec895b73a04",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/modules/platform/pages/PlatformOnboardingPage.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:9010b9220f008c02fa1b3507d020c10058c4185c07f3da193f53fc0f3784d8c3",
          "index_digest": "sha256:9010b9220f008c02fa1b3507d020c10058c4185c07f3da193f53fc0f3784d8c3",
          "worktree_digest": "sha256:8d631e3aa46e548093e79a5ce99238606077274b25aacc0a79ef04e0aa9b3219",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/modules/platform/pages/PlatformOrganizationPage.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:0c652f0d86110c014c6005223dda1e063fcbbec99346ec43bffe12b6890c5ab4",
          "index_digest": "sha256:0c652f0d86110c014c6005223dda1e063fcbbec99346ec43bffe12b6890c5ab4",
          "worktree_digest": "sha256:c41b852c9e7094772c39253ddb9c98dbd709e2feedea4cb86579c2c81c349e3b",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/modules/platform/security/PlatformSecurity.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:e93fc03608922ad13e892105f69a6438227d39d9956f3b40cbb015f8ca86c595",
          "index_digest": "sha256:e93fc03608922ad13e892105f69a6438227d39d9956f3b40cbb015f8ca86c595",
          "worktree_digest": "sha256:0ffa9f477e23d5603387a4225fa617cf810970809510e508d4a3ff6f675ef6ab",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/modules/public/register/pages/EventPaymentPage.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:7327c5fd407aae68a6472fea0e9cd29e6dfae19921bfe0e7041dae98de29d09f",
          "index_digest": "sha256:7327c5fd407aae68a6472fea0e9cd29e6dfae19921bfe0e7041dae98de29d09f",
          "worktree_digest": "sha256:76b0076a6e91151488071e1e6020c40a5507d8141197293885e4e4abf5e0b02d",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/modules/public/register/pages/OrderPage.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:92f60478de1555f427d69327453936d3f3385ec844e81c262a02e893f81155d3",
          "index_digest": "sha256:92f60478de1555f427d69327453936d3f3385ec844e81c262a02e893f81155d3",
          "worktree_digest": "sha256:ba6173fe3f6c2624503a247bef00f6820a268821326e628f1608b53fc649033f",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/modules/public/widget/pages/WidgetPaymentPage.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:7a70d2b45ad470bc772f2bc19e1f3d6bfb09d78bc5dcbef48f2e716d0900e025",
          "index_digest": "sha256:7a70d2b45ad470bc772f2bc19e1f3d6bfb09d78bc5dcbef48f2e716d0900e025",
          "worktree_digest": "sha256:e2c39c571996e731203805e595a98357374a022bd6072617e75903ef855756a9",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/routes/PlatformRoutes.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:867db30f3ac9df2c1aefa9ec271ba36adfacaeb6739e9149258658e70d33340b",
          "index_digest": "sha256:867db30f3ac9df2c1aefa9ec271ba36adfacaeb6739e9149258658e70d33340b",
          "worktree_digest": "sha256:3a74c0117b6871d44364c8a8bed57af615f3283c51b7b60ff4be87d6b75cc07c",
          "untracked_digest": "absent"
        },
        {
          "path": "src/shared/gateways/supabase/repositories/dashboard/uploadOrgAssets.repo.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:555926a07b1c474214ff9084fe6e54accf1bc751b2d1e4013cba5763abf630d4",
          "index_digest": "sha256:555926a07b1c474214ff9084fe6e54accf1bc751b2d1e4013cba5763abf630d4",
          "worktree_digest": "sha256:9afe9580bc0dc049ed30f0078730f776b9b2d5cff01ee35ee8ea0805a49f4aca",
          "untracked_digest": "absent"
        },
        {
          "path": "src/shared/gateways/supabase/supabaseClient.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:b5a74adcb1d9af8699efadedd14bbe8eaeb1a124494584f4d6c80bac6635721e",
          "index_digest": "sha256:b5a74adcb1d9af8699efadedd14bbe8eaeb1a124494584f4d6c80bac6635721e",
          "worktree_digest": "sha256:75c134980551a79c306c25d51c9e0bcf339143891a931cd3d5c4c645cdc88449",
          "untracked_digest": "absent"
        },
        {
          "path": "src/shared/ui/components/markdowntext/MarkdownText.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:3201f46f7bcd281fa2044b2f12873f84a4b0d6eae7e420c652ade9a90d7964b1",
          "index_digest": "sha256:3201f46f7bcd281fa2044b2f12873f84a4b0d6eae7e420c652ade9a90d7964b1",
          "worktree_digest": "sha256:61e57df477186a03784f553a84986d0695f20b8c51e1e18d800943a7eb218c7e",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/config.toml",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:5ba8a724dc14da010a983b2ffb54017b907ee0b23910ae97e3bbdabe325bcc5f",
          "index_digest": "sha256:5ba8a724dc14da010a983b2ffb54017b907ee0b23910ae97e3bbdabe325bcc5f",
          "worktree_digest": "sha256:7bce3d68aa8a5323b9e930a90b1921dcd80ffdb31b79e6da09df42085057c696",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/_shared/app/config/rate-limits.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:a8edd3ea0fdcbb92bf4e6ae1ce1465a093e103c37e7a8a45d35674480ecbb59b",
          "index_digest": "sha256:a8edd3ea0fdcbb92bf4e6ae1ce1465a093e103c37e7a8a45d35674480ecbb59b",
          "worktree_digest": "sha256:d46a41a8d39dd14a04b376bbac0d761d06a1d823ce47e980b38f11beb9f30750",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/_shared/app/edge-handler/create-edge-handler.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:bb7e0e28f9de93065b5bee350dba84a682e566e3b85001003cf7bb30e68763b0",
          "index_digest": "sha256:bb7e0e28f9de93065b5bee350dba84a682e566e3b85001003cf7bb30e68763b0",
          "worktree_digest": "sha256:7c27643af6c33663224d73e9de046d8668c754782c2e06d88268d25aa58c5a1a",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/_shared/modules/logger/console-logger.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:2e180c5200300350b630dbe86ae6614854e1db82e31158ec42c5693d804b3772",
          "index_digest": "sha256:2e180c5200300350b630dbe86ae6614854e1db82e31158ec42c5693d804b3772",
          "worktree_digest": "sha256:4e030cec5df012f1fb60957a8912a088be2eb91fb3968d785f4499475532aa5f",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/_shared/modules/logger/serialize-error.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:08db381a515796da3d9c17852ac3fa5688e5d03ff0c16535525e735542c7052a",
          "index_digest": "sha256:08db381a515796da3d9c17852ac3fa5688e5d03ff0c16535525e735542c7052a",
          "worktree_digest": "sha256:9b1bb49b36534384fda31f4feaceb4f986af00d6d991145018b7d589c85b1ba3",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/_shared/payments/stripe-checkout-lifecycle.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:781a749007f4cbf662864f4f82f01853579949c41b901740a79a839e06cf4df1",
          "index_digest": "sha256:781a749007f4cbf662864f4f82f01853579949c41b901740a79a839e06cf4df1",
          "worktree_digest": "sha256:1e7f49f031ffbb6f0e7917f0d77b2a44228854856cc5fcae4719162d8eb859a2",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/orders/admin/handler.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:a4dae7e18243b28fff44c5a5e6fed6f3d0a1442900a93e64b15d69dd30f7a8e5",
          "index_digest": "sha256:a4dae7e18243b28fff44c5a5e6fed6f3d0a1442900a93e64b15d69dd30f7a8e5",
          "worktree_digest": "sha256:2e1843bec2ec3aed5d64bd3c61bb1e3c1dc0d9d6430bd60b275a46bdb43b6542",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/orders/public/config.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:0cd766e1dc42a8c6ac13543152b6eb31d387c59a6f475f445d2e51e42743b4c9",
          "index_digest": "sha256:0cd766e1dc42a8c6ac13543152b6eb31d387c59a6f475f445d2e51e42743b4c9",
          "worktree_digest": "sha256:345e20c21bbca3e8eec93c736b18b20d051997d3cb7364fbf9bc635687867293",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/orders/public/emails.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:4cee8d1271bff41e47c3ef6f40f3439d8f457856ead8dc3850c44fd98fade8c2",
          "index_digest": "sha256:4cee8d1271bff41e47c3ef6f40f3439d8f457856ead8dc3850c44fd98fade8c2",
          "worktree_digest": "sha256:75b80007356a4ad8ca479873cb1c641790a5ad5846cfff0ad4a4f74154fb523a",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/orders/public/payment-provider.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:7ef8ab0ee2f330c8d7e39147da0a71ea6178d1123456fb18bba2e3a00223492f",
          "index_digest": "sha256:7ef8ab0ee2f330c8d7e39147da0a71ea6178d1123456fb18bba2e3a00223492f",
          "worktree_digest": "sha256:b43ead313cd7a4bd65a1896c72e3340ee993945db116dfd64684d1cbd496247d",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/platform-admin/auth.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:b8ba05d2b9372e29e509a6c4444b77f7e606993707d8fbf90e94211e529e4ccc",
          "index_digest": "sha256:b8ba05d2b9372e29e509a6c4444b77f7e606993707d8fbf90e94211e529e4ccc",
          "worktree_digest": "sha256:e6a7b5fa68b478eb1e54b2e81033ddca7ae3d1db854e2cd0177de94aff909986",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/platform-admin/index.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:401dfd2591a5bdbf5dd912fc5569f51a9ad00a15678a6961d9583b7d49dc1fd7",
          "index_digest": "sha256:401dfd2591a5bdbf5dd912fc5569f51a9ad00a15678a6961d9583b7d49dc1fd7",
          "worktree_digest": "sha256:3d506bca732a817b4c33d72bc99a7880943af1700e9b60a1d2c023b30f39fe1f",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/platform-config/index.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:a36fca0554205e0912e62d08a60568e5377ee651fb073d2ef6e2377480df53d0",
          "index_digest": "sha256:a36fca0554205e0912e62d08a60568e5377ee651fb073d2ef6e2377480df53d0",
          "worktree_digest": "sha256:8909b5a0d861a54668470ee615d5442ec8cdb8fc5a5c8b12849e81a7e41ad073",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/stripe-connect-start/index.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:7502b8d19892762bca8255763afc7e797179b98c741d48b7c6cfa3c24fe520b6",
          "index_digest": "sha256:7502b8d19892762bca8255763afc7e797179b98c741d48b7c6cfa3c24fe520b6",
          "worktree_digest": "sha256:c381951592acc528271bd65293d8c1b1c50c753189d4db1b7163268d37fcab8b",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/stripe-connect-status/index.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:a13ffa782e7ef9407032d87ba80aa608f85e5c4c752868205188cda0eab8a02a",
          "index_digest": "sha256:a13ffa782e7ef9407032d87ba80aa608f85e5c4c752868205188cda0eab8a02a",
          "worktree_digest": "sha256:077ce6866a83c4b1f0fd12ee55851f5b55681f5b91d451b603fd8969a9c8d6c3",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/stripe-webhook-connect/index.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:c23aac2cc97aa0aa07ece267d62de1c1eea48f74189ddafb5f6cf4eef12516f7",
          "index_digest": "sha256:c23aac2cc97aa0aa07ece267d62de1c1eea48f74189ddafb5f6cf4eef12516f7",
          "worktree_digest": "sha256:24994790167cce6b09084cf63a2eb2bbf23be47f3c1c24d930c8f2dc1995a8f2",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/subscriptions/index.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:826f6c8da0e7eaa30a6c7420d66b70b118c8e2e1c5395d496295a8ea50d9bc2d",
          "index_digest": "sha256:826f6c8da0e7eaa30a6c7420d66b70b118c8e2e1c5395d496295a8ea50d9bc2d",
          "worktree_digest": "sha256:38ee017d8a7dbb004355a2f86c0852c12370c09eebfe2b8998d104d1eba5f0e8",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/tests/orders-routes-test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:3e4be324635b9f6ae42ef15392c064e379341172588b0000eef9ace4e963454d",
          "index_digest": "sha256:3e4be324635b9f6ae42ef15392c064e379341172588b0000eef9ace4e963454d",
          "worktree_digest": "sha256:b8f967594a60c96a9a3b8725ec0af05fbb4d85e4ce1af006ae21a56e8691dd70",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/tests/payment-delivery-test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:a05a83d5e18de9f8550a27449685977fe61d9498d05d34ddc08f5f48310d0493",
          "index_digest": "sha256:a05a83d5e18de9f8550a27449685977fe61d9498d05d34ddc08f5f48310d0493",
          "worktree_digest": "sha256:ccd2a9bee05b0b2868fcaeab85846e3757ce953e8e12ed4e3038e7e248ea8ff6",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/tests/platform-admin-security-test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:3b4fd71187d22b67083a58779b4e951bdacaf35b3567b976b9d133d2a4291fee",
          "index_digest": "sha256:3b4fd71187d22b67083a58779b4e951bdacaf35b3567b976b9d133d2a4291fee",
          "worktree_digest": "sha256:01e37b1189e1484403986146187104fa42c13d33ea32a6db5d3bd40df14d9309",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/tests/stripe-checkout-lifecycle-test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:cbac10873631c571fb5788de991ce4ad3a95d0ad3fafe616fe69e2f6cf6ee1a7",
          "index_digest": "sha256:cbac10873631c571fb5788de991ce4ad3a95d0ad3fafe616fe69e2f6cf6ee1a7",
          "worktree_digest": "sha256:ed9b3b6a5b0722b7d42d97761cdfd7c7de7536512bcfbcdf7742fb7408c11205",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/functions/workers/index.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:6d63f15c0ca9f5c1d93dd07f5c5e0ee74d2d3f90b7328e5b771e3302b0e65ac9",
          "index_digest": "sha256:6d63f15c0ca9f5c1d93dd07f5c5e0ee74d2d3f90b7328e5b771e3302b0e65ac9",
          "worktree_digest": "sha256:95719e0d83ed85e1f1101cc0afdf06d9d6d569f1353bc88eead3b908bf89505b",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/migrations/20260324133258_remote_schema.sql",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:58e7d6e468722d74d253187538e1d1b37a2a73bb027491fd721c916276592107",
          "index_digest": "sha256:58e7d6e468722d74d253187538e1d1b37a2a73bb027491fd721c916276592107",
          "worktree_digest": "sha256:6c139a4a86e765963f32a68457eac489ea752059f86f8d3fe30fef626b11d44d",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/migrations/20260616083043_update_event_product_refactor.sql",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:c756099879d4f1ca24010107d4c5379a0a7ac540041171c8716e8cf5d2adf4a1",
          "index_digest": "sha256:c756099879d4f1ca24010107d4c5379a0a7ac540041171c8716e8cf5d2adf4a1",
          "worktree_digest": "sha256:87c723357ce020d53360cef6b5083140feb00b0ade80a4fecac3e41ec36c2c2b",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/migrations/20260616182119_refactor_create_event_form_field_rpc.sql",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:16e5fbe31b7543cd421cde90a389fe58fe6e437fcf30a64469310365f1348a1e",
          "index_digest": "sha256:16e5fbe31b7543cd421cde90a389fe58fe6e437fcf30a64469310365f1348a1e",
          "worktree_digest": "sha256:00a5189c464a771e4a253a10fd13ec542c6c28a9eaf9efd12b03a54bcf4cd105",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/migrations/20260915160000_reconcile_production_privileges.sql",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:3a34dc622557c1366078ab57be9ad2d3e7278e2a9bb69faa7209d18435e14e96",
          "index_digest": "sha256:3a34dc622557c1366078ab57be9ad2d3e7278e2a9bb69faa7209d18435e14e96",
          "worktree_digest": "sha256:859ef2093998eddbbc7ab1c4ad93aa1021626e57dc035428ddaac72cb563feaf",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/migrations/20260915214500_add_consumable_rate_limit.sql",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:5caa4b904f31708516a75f56a99c7b5811e7e6d15c8bf88ddc4ba328683cc923",
          "index_digest": "sha256:5caa4b904f31708516a75f56a99c7b5811e7e6d15c8bf88ddc4ba328683cc923",
          "worktree_digest": "sha256:2899f1d23d7efc731618da7b71bc6b00754b2f47e2e60ef1f0b04ce97462f128",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/migrations/20260929123000_gate_stripe_connect_by_user.sql",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:85e1819000186aa4eb1e1740e2cc313fb598ddb810918fc5dd0ab203ab9d298e",
          "index_digest": "sha256:85e1819000186aa4eb1e1740e2cc313fb598ddb810918fc5dd0ab203ab9d298e",
          "worktree_digest": "sha256:c77b82aebcbd318521941a7df1932810a59479193a47df17db52c0445555f61c",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/migrations/20260930174530_platform_admin_backoffice.sql",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:617ba5b5b9b0bd195db61b9c57bb90c4b6f1fa72fae48541cb8ea56d7490831b",
          "index_digest": "sha256:617ba5b5b9b0bd195db61b9c57bb90c4b6f1fa72fae48541cb8ea56d7490831b",
          "worktree_digest": "sha256:2c7585d724c5bb23e2ccf3529e562b75d6c9d84869f79a0ca623d660b0078e75",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/migrations/20260930181500_harden_internal_function_privileges.sql",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:58ba4e8e11d78fd0a51cd1327d8d31413d552e840129cdc6604839009d58ca5b",
          "index_digest": "sha256:58ba4e8e11d78fd0a51cd1327d8d31413d552e840129cdc6604839009d58ca5b",
          "worktree_digest": "sha256:b47971ee73ea097773dc98148fb7b930ddd66143bd44bb1be84a4dfb1a2c09eb",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/migrations/20260930211708_platform_admin_communications.sql",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:0569503200be568b2e3d8f5fb9f256cdc1cbcd8a438ccb1d45e8a483e96e8e72",
          "index_digest": "sha256:0569503200be568b2e3d8f5fb9f256cdc1cbcd8a438ccb1d45e8a483e96e8e72",
          "worktree_digest": "sha256:c3acded49c5ca28c13dceba781ef6b49b7efc7502ee61a14dabc6cb44d8ccd0c",
          "untracked_digest": "absent"
        },
        {
          "path": "supabase/migrations/20261002121507_restrict_sensitive_internal_rpcs.sql",
          "object_kind": {
            "head": "absent",
            "index": "absent",
            "worktree": "absent",
            "untracked": "regular"
          },
          "state": "untracked",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "absent",
          "index_digest": "absent",
          "worktree_digest": "absent",
          "untracked_digest": "sha256:0fef2ff084e6d3b58984b1436bbdd2734311c2c0cf56825a91bc816454044a7b"
        },
        {
          "path": "supabase/migrations/20261002121531_enforce_form_group_event_scope.sql",
          "object_kind": {
            "head": "absent",
            "index": "absent",
            "worktree": "absent",
            "untracked": "regular"
          },
          "state": "untracked",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "absent",
          "index_digest": "absent",
          "worktree_digest": "absent",
          "untracked_digest": "sha256:eb0a33812644626e02f9fec324f7c9a6c1e56a419e158b608e04beda47241c43"
        },
        {
          "path": "supabase/migrations/20261002121709_protect_product_system_columns.sql",
          "object_kind": {
            "head": "absent",
            "index": "absent",
            "worktree": "absent",
            "untracked": "regular"
          },
          "state": "untracked",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "absent",
          "index_digest": "absent",
          "worktree_digest": "absent",
          "untracked_digest": "sha256:9027752fbf08937f2560e0c9291ca7e1b0150f7ebce17746af1be846533265f7"
        },
        {
          "path": "tests/database/baseline.sql",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:3de544b68165756f9d64a8c59d1eb40a7b431da0311afbe916748fc713020a32",
          "index_digest": "sha256:3de544b68165756f9d64a8c59d1eb40a7b431da0311afbe916748fc713020a32",
          "worktree_digest": "sha256:8754274cc917dca4fb4f29d38079df8d2adf44fadc1f61e4b49a692d85b1273a",
          "untracked_digest": "absent"
        },
        {
          "path": "tests/database/contract-acceptance-regressions.sql",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:97c680306eda4b44674424fc649e28f797794c68ec5b572c6ca0e93ea9da6e38",
          "index_digest": "sha256:97c680306eda4b44674424fc649e28f797794c68ec5b572c6ca0e93ea9da6e38",
          "worktree_digest": "sha256:02a0019ae76d23fe468b5fb858547e8792dc364210f0814683d5ecda31cd0d83",
          "untracked_digest": "absent"
        },
        {
          "path": "tests/database/form-scope-regressions.sql",
          "object_kind": {
            "head": "absent",
            "index": "absent",
            "worktree": "absent",
            "untracked": "regular"
          },
          "state": "untracked",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "absent",
          "index_digest": "absent",
          "worktree_digest": "absent",
          "untracked_digest": "sha256:c2bc79fd7766ad3c6b48032554559bfac2edfc24b4368aae63232bb26df7d8ec"
        },
        {
          "path": "tests/database/product-system-columns.sql",
          "object_kind": {
            "head": "absent",
            "index": "absent",
            "worktree": "absent",
            "untracked": "regular"
          },
          "state": "untracked",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "absent",
          "index_digest": "absent",
          "worktree_digest": "absent",
          "untracked_digest": "sha256:ebae6f225628d3d9f9da8f5ec01eba70ed40da5e35f5bfc5f4a021a8fce5a979"
        },
        {
          "path": "tests/database/sensitive-rpc-acl.sql",
          "object_kind": {
            "head": "absent",
            "index": "absent",
            "worktree": "absent",
            "untracked": "regular"
          },
          "state": "untracked",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "absent",
          "index_digest": "absent",
          "worktree_digest": "absent",
          "untracked_digest": "sha256:691f4924fd26721a78bc8e51a792058fdd54ca5898a703d349a2eeb0660ada04"
        }
      ]
    },
    "primary_symbols": [
      {
        "symbol": "admin_grant_subscription",
        "file": "supabase/migrations/20260324133258_remote_schema.sql",
        "lines": "1594",
        "role": "RPC privilégiée à verrouiller"
      },
      {
        "symbol": "claim_order_confirmation_email",
        "file": "supabase/migrations/20260324133258_remote_schema.sql",
        "lines": "2562",
        "role": "ACL et reprise livraison"
      },
      {
        "symbol": "createEdgeHandler",
        "file": "supabase/functions/_shared/app/edge-handler/create-edge-handler.ts",
        "role": "transport et auth explicite"
      },
      {
        "symbol": "usePlatformQuery",
        "file": "src/app/modules/platform/hooks/usePlatformQuery.ts",
        "lines": "11-22",
        "role": "stale response protection"
      },
      {
        "symbol": "platform_admin_mutate",
        "file": "supabase/migrations/20260930174530_platform_admin_backoffice.sql",
        "lines": "1197-1274",
        "role": "concurrent onboarding replay"
      }
    ],
    "related_symbols": [
      {
        "symbol": "consumeRequestRateLimit",
        "relationship": "appel partagé",
        "relevance": "quotas hors transaction métier"
      },
      {
        "symbol": "completeTicketPayment",
        "relationship": "orchestration paiement",
        "relevance": "livraison après commit"
      }
    ],
    "execution_path": [
      "frontend repository",
      "Edge auth et autorisation org",
      "SQL atomique ou fournisseur",
      "DTO validé et reprise effets"
    ],
    "pdg_constraints": [],
    "architectural_patterns": [
      {
        "pattern": "contrats indépendants Zod",
        "example_location": "shared/schemas/orders-admin.ts",
        "usage_guidance": "entrée et réponse explicites"
      },
      {
        "pattern": "services internes",
        "example_location": "supabase/functions/orders/public/emails.ts",
        "usage_guidance": "réutiliser sans URL HTTP interne"
      }
    ],
    "files_to_modify": [
      {
        "file": "supabase/functions/orders/admin/handler.ts",
        "symbols": [],
        "intended_change": "état API fidèle au résultat SQL"
      },
      {
        "file": "supabase/functions/orders/public/emails.ts",
        "symbols": [
          "sendConfirmationEmailForOrderSafe"
        ],
        "intended_change": "erreurs RPC et livraison récupérable"
      },
      {
        "file": "src/app/modules/platform/hooks/usePlatformQuery.ts",
        "symbols": [
          "usePlatformQuery"
        ],
        "intended_change": "reject stale results and scope data to identity and query key"
      },
      {
        "file": "src/app/modules/platform/pages/PlatformOnboardingPage.tsx",
        "symbols": [],
        "intended_change": "capture form before await and preserve idempotent retry semantics"
      }
    ],
    "tests": [
      {
        "file": "tests/database/baseline.sql",
        "scenarios": [
          "refus RPC internes anon/authenticated"
        ]
      },
      {
        "file": "tests/database/form-scope-regressions.sql",
        "scenarios": [
          "nouveau fichier : champ A/groupe B refusé"
        ]
      },
      {
        "file": "supabase/functions/tests/orders-admin-payment-test.ts",
        "scenarios": [
          "nouveau fichier : 100 EUR/10 EUR => partially_paid"
        ]
      },
      {
        "file": "tests/database/product-system-columns.sql",
        "scenarios": [
          "passed after registrations_open fixture setup"
        ]
      },
      {
        "file": "src/app/modules/platform/hooks/usePlatformQuery.test.ts",
        "scenarios": [
          "proposed new test: resolve B before A and assert visible data and mutation target remain B"
        ]
      }
    ],
    "verification_commands": [
      "npm test",
      "npm run test:backend",
      "npm run check:backend",
      "npm run lint:backend",
      "npm run build"
    ],
    "risks": [
      "Absence de RLS : oubli de filtre serveur entraîne risque cross-tenant",
      "revocation casse RPC JWT",
      "compatibilité front déjà publié",
      "transactions paiements et stock"
    ],
    "assumptions": [
      "Remote catalogue observations are historical A0 evidence; no remote mutation in integration",
      "Current HEAD matches origin/dev at fetch time, not proof of deployment",
      "A1 duplicate revocations replay successfully; do not reimplement",
      "SQL tests use disposable fixtures, including registrations_open within rollback"
    ],
    "open_questions": [
      "Current production deployment and ACLs at future authorized publication",
      "Platform SQL step-up/revocation/campaign behavior tests still needed",
      "Existing HTML content compatibility before sanitization"
    ],
    "avoid": [
      "Ne pas répéter toute l'investigation",
      "Ne pas écraser changements utilisateur",
      "Ne pas modifier migrations appliquées",
      "Aucun push/merge/deploy dans un lot non autorisé",
      "Aucun paiement live ou email client",
      "Ne pas supprimer historique Mollie",
      "Ne pas proxyfier Auth sans besoin",
      "Ne retirer RLS métier qu'après fermeture grants et tests du domaine",
      "Ne pas désactiver Data API tant que les Edge utilisent supabase-js .from/.rpc",
      "Ne pas accepter orgId/userId comme preuve d'autorisation"
    ],
    "completed_lots": [
      "A0: inventory performed, historical remote observations retained",
      "A1: already in updated dev; additive local migration retained",
      "A2: implemented locally; SQL tests passed",
      "A3: implemented locally; fixture adapted and SQL tests passed",
      "D0: platform console already implemented in updated dev"
    ],
    "next_lots": [
      "D1: stale organization response and wrong mutation target",
      "D2: async form currentTarget failure",
      "D3: concurrent onboarding must return replay instead of 23505",
      "A4-A8 and B0-B6 per updated plan"
    ],
    "verification_results": {
      "migrations": 54,
      "sql_suites": 9,
      "vitest": 121,
      "node": 16,
      "deno": 136,
      "build": "pass",
      "backend_check": "pass",
      "backend_lint": "pass",
      "platform_concurrency": "first call success; second 23505 organizations_one_per_creator; sequential retry replayed:true; no duplicate"
    }
  }
}
```

## 12. Questions ouvertes et limites

- ACL effectives : A0 a confirmé l'exposition des cinq RPC en production et leur fermeture staging par catalogue, au moment de son inspection. Dev à jour contient le correctif ; aucune nouvelle inspection ni application distante pendant l'intégration.
- État actuel des fonctions déployées, crons et callbacks : pas d'inspection distante effectuée.
- Dashboard plateforme : présent depuis les commits intégrés ; findings D1–D5 et couverture SQL à compléter. Le précédent constat d'absence concernait uniquement l'ancien checkout.
- Auth settings distants, MFA et session revocation : config.toml local ne prouve pas la configuration hébergée.
- Absence de clé Stripe privée détectée dans les sources applicatives scannées n'est pas un audit de secrets complet. .local et valeurs distantes n'ont pas été lus.
- XSS exécutable, spoof IP et fuite cache A→B demandent des scénarios dynamiques ; ne pas présenter comme incidents observés.
- Données contradictoires avant contraintes : inconnues tant que l'inventaire n'a pas été exécuté.
- Périmètre actualisé : HEAD dev local 4ef53f4 aligné origin/dev lors du fetch, plus modifications locales décrites. Cet alignement ne prouve pas une publication distante.
- La recherche de changelog Markdown Supabase n'a pas pu être rendue par le navigateur ; les guides officiels API/auth ont été consultés. Aucun nouveau mécanisme Supabase implémenté.
- Différé : refonte frontend globale, nouveau state manager, monorepo, système de rôles générique, remplacement de toutes les RPC SQL internes, connexion PostgreSQL directe et suppression des historiques. L'autorisation Edge-only demandée remplace toute recommandation antérieure de maintenir RLS comme moteur de permissions métier.

## 13. Définition de terminé

L'audit est livré lorsque constats/preuves/incertitudes, inventaire de frontière, candidats morts et lots déléguables sont disponibles.
La migration sera terminée quand : opérations métier passent par Edge ; autorisation métier exclusivement dans ces Edge ; anciens accès directs sont refusés par grants même sans RLS ; policies métier retirées pour les domaines migrés ; toutes les routes ont contrat, identité et scope ressource ; invariants SQL et idempotence préservés ; tests A/B/anon + refus Data API/GraphQL et exceptions Storage passent ; default privileges fermés ; crons/webhooks/Netlify migrés ; déploiement et recette prouvés séparément.
Ne pas confondre un build vert, un déploiement réussi et une résolution métier confirmée.
