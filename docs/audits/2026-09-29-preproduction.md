# Audit avant production — 29 septembre 2026

**Verdict : CORRECTIONS REQUISES. Ne pas promouvoir cette version en production en l'état.**

Le build et les suites existantes passent, mais des reproductions supplémentaires mettent en évidence des erreurs de paiement et de renouvellement. L'absence de crash dans les pages visitées ne prouve pas la fiabilité des parcours métier.

## Références et périmètre

- Production versionnée : `origin/main`, `0abc3aea73d063b44268b4e0d881fbf4249951ba`.
- Candidat : `origin/dev`, `98820984c1f3e1f2dd7b46031d98f6a9d859dff7`.
- Au contrôle final du distant, les deux références pointaient toujours vers ces mêmes commits.
- Écart : **299 fichiers**, 20 454 insertions et 9 199 suppressions, dont **6 nouvelles migrations**.
- Dernier déploiement production GitHub réussi : [35209513785](https://github.com/nicolas286/eventflow/actions/runs/35209513785), sur le commit main ci-dessus. Ce constat ne remplace pas un inventaire du schéma et des fonctions réellement présents à distance.
- Travail réalisé dans `C:/Users/jorda/Desktop/Taff/eventflow-audit-20260929`, copie Git isolée au commit candidat. La branche de travail de l'utilisateur reste `dev`.
- Aucun code applicatif corrigé, aucun commit/push/fusion/déploiement. Ce rapport est le seul fichier ajouté dans le dépôt de travail initial. Les autres fichiers d'audit sont conservés dans la copie isolée.

Revue croisée des sources et appelants : commandes publiques/admin, Stripe Connect et webhooks, virements et confirmations, abonnements/factures/PDF/Billit, schéma/RLS/grants, comptes, infrastructure Edge, authentification interne, e-mails, contrats frontend, pages et workflows. Aucun index GitNexus Eventflow disponible ; traçage par sources, `rg`, diff et tests. Les conditions générales ont été examinées comme composant, sans audit juridique.

Les changements de production incluent l'arrêt des nouvelles opérations Mollie, l'introduction de Stripe et du virement, l'activation de plans contre facture interne à échéance de 14 jours, le renouvellement SQL et le remplacement de nombreuses routes HTTP. Il ne s'agit pas uniquement d'un refactoring technique.

## Résultats des vérifications

| Vérification | Résultat et portée |
| --- | --- |
| `npm ci --no-audit --no-fund` | Installation réussie depuis le lockfile |
| `npm test` | **66 tests Vitest + 13 tests Node : tous réussis** |
| `npm run build` | TypeScript et Vite réussis ; gros bundle signalé, environ 2,93 Mo / 866 Ko gzip |
| `npm run check:backend` | Réussi |
| `npm run lint:backend` | Réussi, 169 fichiers vérifiés |
| `npm run test:backend` | **84 tests réussis**, prestataires simulés |
| `npm run lint` | **Échec : 54 erreurs, 2 avertissements** ; occurrences dans les fichiers modifiés préexistantes au diff, majorité des fichiers concernés hors changement |
| `npm audit --json` | 28 alertes, dont 17 élevées, 9 modérées, 2 faibles ; aucune critique. Aucune version de paquet résolue ne change entre main et dev : dette de dépendances existante, exploitabilité non démontrée |
| [CI du candidat](https://github.com/nicolas286/eventflow/actions/runs/36551583861) | Frontend, Edge et **reconstruction de base + baseline SQL réussis** |
| [Déploiement staging du candidat](https://github.com/nicolas286/eventflow/actions/runs/36551584400) | Réussi |
| Reproductions complémentaires | 4 probes frontend, 2 tests de services paiement, scripts SQL PostgreSQL et simulation Billit confirment les défauts décrits ci-dessous |
| HTTP des deux sites | Production et staging répondent 200 ; chaque bundle contient l'URL de son backend et pas celle de l'autre environnement |
| Navigateur Chrome, staging | 5 routes × ordinateur/mobile = **10 cas**, aucun `pageerror`, page vide persistante ou débordement horizontal constaté |
| Accès anonyme staging | **11 refus 401 attendus**, origine CORS staging correcte |

Environnement local : Node 24.19.0, Deno 2.9.7 ; la CI utilise Deno 2.9.6. Docker/PostgreSQL serveur indisponibles localement : la reconstruction complète est attestée par la CI du commit exact. Les reproductions SQL supplémentaires utilisent PGlite, avec les corps SQL du dépôt, des tables synthétiques minimales et des fonctions Auth équivalentes. Elles ne remplacent pas Supabase complet, ses RLS, Storage, PostgREST ou pg_cron.

Routes navigateur : `/admin/login`, `/admin/signup`, `/admin/abonnement` sans session (redirigé vers login), `/cgu`, `/order/<UUID synthétique>` sans token. Largeurs 1440 et 390 pixels. Un premier relevé avait précédé la fin de la redirection Auth ; après attente explicite de l'état final, les dix cas passent. Ce contrôle couvre le chargement et le rendu, pas une recette visuelle exhaustive du back-office.

Refus anonymes vérifiés sur staging : suppression de compte, PDF de facture, commande admin, lecture commande sans token, rappels, expiration, réglages bancaires, démarrage/statut Stripe Connect, création/résiliation d'abonnement. Aucun paiement live, envoi client, inscription Auth ou modification de donnée métier n'a été effectué.

## Défauts prioritaires

### A1 — P1 — Un retry Stripe peut compter deux fois un acompte

**Source :** `supabase/functions/stripe-webhook-connect/index.ts:125` et `:132`. Contrat appelé : `supabase/migrations/20260629090759_apply_order_payment_alignment_for_promocodes.sql:102` et `:164`.

Le handler remet un paiement déjà traité à `pending` avant `apply_order_payment`. La RPC ne reconnaît le traitement antérieur que si le statut est encore `paid` et `processed_at` renseigné. Si le premier traitement a enregistré un acompte mais échoué ensuite sur les billets ou la finalisation du webhook, la relance applique une seconde fois le même montant.

**Reproduction :** commande synthétique de 10 €, paiement synthétique unique de 5 €. Premier appel : 500 centimes enregistrés comme payés. Retry SQL normal : toujours 500, idempotent. Retry avec la mutation du handler : **1 000 centimes, commande soldée**, sans second paiement. Le véritable handler signé et la véritable fonction SQL ont été exercés séparément sur fixtures.

**Correction attendue :** préserver le paiement déjà traité et rendre atomiques l'association au PaymentIntent et l'application, avec idempotence indépendante des transitions de transport. Tester la relance après échec d'émission des billets et les appels concurrents.

### A2 — P1 — Un acheteur peut payer après expiration de sa réservation

**Source :** `supabase/functions/orders/public/stripe-payment-provider.ts:41`, création sans `expires_at`. Réservation : `supabase/migrations/20260629063112_promo_codes_implementation.sql:566` ; expiration : `supabase/functions/workers/expire-orders.ts:18`.

La réservation expire après 20 minutes et le stock est libéré. La session Checkout reste ouverte, sans coordination avec cette expiration. Stripe fixe sa durée par défaut à 24 heures et accepte une échéance configurée de 30 minutes à 24 heures. [Documentation Stripe](https://docs.stripe.com/api/checkout/sessions/create).

**Reproduction :** les vraies fonctions SQL expirent la commande, libèrent son stock, puis rejettent un paiement réussi avec `ORDER_NOT_PAYABLE`. Le débit Stripe tardif n'a pas été effectué ; le risque résulte du contrat prestataire vérifié et du rejet local reproduit. Un acheteur peut ainsi être débité sans recevoir de billet.

**Correction attendue :** coordonner durée de réservation, fermeture Checkout, libération du stock et traitement des paiements tardifs. Fixer simplement une échéance Stripe à 20 minutes serait invalide.

### A3 — P1 — Le renouvellement automatique des abonnements échoue

**Source :** `supabase/migrations/20260928181116_manual_subscription_invoicing.sql:274` et `:385` ; garde appelée : `supabase/migrations/20260324133258_remote_schema.sql:6825`.

Le cron exécute le renouvellement comme postgres sans JWT. Il atteint `rpc_create_invoice_peppol`, dont la garde exige `service_role`. L'erreur `FORBIDDEN` est absorbée et la sous-transaction annulée : pas de facture ni d'extension de période. Le plan effectif peut devenir Free.

**Reproduction SQL :** création initiale avec claim service réussie ; renouvellement postgres sans claim : `renewed:0`, `failed:1`, droits effectifs `free`. Même renouvellement avec le claim service : réussi. La baseline existante appelle ce parcours avec un claim service et masque donc ce défaut.

**Correction attendue :** autoriser correctement l'appel interne du cron sans élargir les droits clients ; tester sous le propriétaire réel du job, sans claim JWT, et vérifier le maintien des droits.

### A4 — P1 — Le parcours de résiliation a disparu

**Source :** `src/app/modules/admin/subscriptions/pages/AdminSubscriptionPage.tsx:520` ; renouvellement automatique : migration de facturation `:330`.

La page n'appelle plus le hook de résiliation ; pour un abonnement manuel actif, elle propose seulement de voir les factures. La route DELETE subsiste, mais aucun bouton ne permet de l'utiliser. Après correction du cron, un organisateur ne peut donc pas arrêter les renouvellements depuis l'application. Le texte continue pourtant à annoncer la possibilité de résilier.

**Reproduction :** rendu React réel avec abonnements manuels et Mollie synthétiques : aucune action de résiliation/retour au plan Free.

**Correction attendue :** restaurer l'action, sa confirmation, l'appel serveur et la mise à jour du bootstrap ; vérifier qu'un abonnement résilié ne se renouvelle plus. Le traitement des anciens contrats Mollie doit faire partie de la migration ci-dessous.

## Autres défauts confirmés

| ID / priorité | Source et scénario | Conséquence / correction attendue |
| --- | --- | --- |
| A5 / P2 | `20260929130000_harden_bank_transfer_payments.sql:841` redéfinit le bootstrap sans `latestOpenInvoice`, prix et remise | Notification facture et affichage des tarifs remisés disparaissent silencieusement ; Zod accepte ces champs manquants. Reproduit en SQL et parsing frontend. Nouvelle migration conservant le contrat complet |
| A6 / P2 | `functions/_shared/services/order-confirmation/index.ts:103` consomme l'idempotence avant l'envoi des instructions de virement | Échec transitoire puis retry : `already_sent`, aucun nouvel envoi. Reproduit avec le vrai service. Distinguer réservation d'envoi, succès et erreur ; prévoir une reprise. Défaut historique du helper réutilisé par cette nouvelle fonctionnalité |
| A7 / P2 | `WidgetPaymentPage.tsx:272` et `:292`, `WidgetConfirmationPage.tsx:137` : ID/token dans le stockage de session mais absents de l'URL consultée par le chargement serveur | Après confirmation ou expiration, le widget peut toujours demander de payer. Probe : aucun fetch, ancien état conservé. Recharger l'état serveur à partir des identifiants disponibles et afficher les instructions uniquement si la commande est payable |
| A8 / P2 | `functions/subscriptions/manual.ts:106` et `:111` attendent Billit après création de la facture ; `start.ts:21` transforme l'erreur en HTTP 500 | Reproduction sans réseau : facture créée et plan actif malgré 500 ; retry 200 `reused:true`, sans renvoi Billit ni avertissement. Isoler les effets externes et prévoir un état durable avec reprise idempotente |
| A9 / P2 | Migration de facturation `:44`, `:333`, `:385` : expiration à l'heure de souscription, renouvellement seulement à 02:15 chaque jour | Même après correction d'A3, interruption possible des droits jusqu'au cron suivant. Le calcul SQL renvoie Free dès expiration. Renouveler avant l'échéance avec des périodes continues, ou définir une tolérance cohérente ; tester la frontière temporelle |
| A10 / P3 | `OrganizationPanel.tsx:301` et `:564` : révéler les coordonnées remplace le formulaire par le fournisseur sauvegardé | Dans Stripe → virement avec ancien IBAN enregistré, le choix non sauvegardé est annulé. Traçage confirmé, contournement possible. Préserver le fournisseur sélectionné lors de la révélation |

Les chemins abrégés `functions/` sont sous `supabase/`. Les détails, consommateurs et reproductions figurent également dans les trois rapports spécialisés conservés dans la copie d'audit.

## Risques propres à la promotion

### R1 — Changement délibéré : virement imposé aux organisations non autorisées Stripe

`20260929123000_gate_stripe_connect_by_user.sql:21` fait passer ces organisations à `bank_transfer`. L'autorisation Stripe vaut false par défaut ; seuls les créateurs de comptes Stripe déjà renseignés sont préautorisés. Dans le schéma production versionné, les colonnes de virement sont nouvelles et restent donc nulles pour les anciennes organisations.

`orders/public/payment-provider.ts:35` rejette alors les nouvelles commandes payantes avec `ORG_BANK_TRANSFER_CONFIGURATION_INCOMPLETE`. L'alerte générale de configuration de paiement a été retirée et la notification Stripe est masquée pour les profils non autorisés.

**Condition avant ouverture :** inventorier les organisations actives, préparer leurs coordonnées bancaires ou leur accès Stripe et vérifier chaque configuration. Sans préparation, cette migration peut interrompre la billetterie payante existante. L'état réel des données production n'a pas pu être consulté ; une préparation distante éventuelle n'est ni confirmée ni exclue.

### R2 — Les anciens abonnements Mollie doivent être traités explicitement

La nouvelle résiliation et la suppression de compte n'annulent plus les abonnements externes ; le passage au fournisseur `manual` conserve les références en historique. Les routes d'abonnement déplacées renvoient 410 aux callbacks Mollie. Cela correspond à la décision documentée de ne plus effectuer de nouvelles opérations Mollie, mais **ne résilie pas les contrats existants chez le prestataire**.

Si des abonnements Mollie sont toujours actifs, les prélèvements peuvent continuer après une résiliation locale ou se cumuler avec les nouvelles factures. Inventorier contrats externes, modes test/live et premiers paiements encore en attente ; définir leur transition et conserver le traitement nécessaire des callbacks. Leur existence réelle en production n'a pas été vérifiée.

### R3 — Anciennes routes, crons et déploiement partiel

Le déploiement des nouvelles fonctions ne supprime pas les anciennes fonctions distantes. La documentation prévoit une migration séparée des consommateurs et leur retrait. Aucun inventaire des fonctions/crons production ni retrait validé n'est disponible dans cet audit.

En particulier, l'ancienne fonction `delete-account` de main vérifie l'organisation de l'utilisateur seulement lorsque `orgId` n'est pas fourni : la correction d'autorisation dans `accounts` ne sécurise pas cette ancienne route tant qu'elle demeure publiée. C'est une dette de sécurité préexistante à traiter dans la bascule ; aucun test offensif production n'a été réalisé.

Il faut rendre explicites le sort des anciens bundles ouverts, les callbacks déjà enregistrés, les crons, le retrait des endpoints et le retour arrière. Le workflow applique SQL, puis les fonctions, puis le frontend, sans transaction globale. Il ne suffit pas de restaurer l'ancien frontend si son backend a changé.

### R4 — Configuration et exploitation non attestées

Les secrets Stripe, abonnements aux événements Connect, version API du compte, activation Bancontact, états d'onboarding, capture des e-mails, configuration Auth et circuit comptable ne sont pas certifiés par les tests simulés. L'API Stripe ne fixe pas explicitement sa version dans ce code : vérifier la version du compte avec une recette sandbox.

Le rapprochement des virements et la transmission des factures renouvelées à Billit relèvent d'un circuit comptable annoncé dans la documentation, non démontré ici. Ce point est une validation restante, pas la preuve que ce circuit externe n'existe pas.

## Limites et conditions de validation finale

L'accès CLI Supabase n'était pas authentifié ; aucun accès administratif staging/production ni compte applicatif de recette n'était disponible dans le workspace. Aucun contenu de secret ou de fichier `.local` n'a été exposé. GitHub a uniquement été interrogé en lecture. Les visites production se limitent au site et à son asset public.

Il reste à réaliser après corrections :

1. Rejouer les scénarios A1–A9 en tests de non-régression et la baseline complète après application de **nouvelles migrations correctives**, sans réécrire l'historique.
2. Faire une recette staging authentifiée sur deux organisations synthétiques avec owner/admin/membre : refus interorganisation, confirmation de virement, double clic, expiration, libération du stock, billets et e-mail capturé.
3. Exécuter le parcours Stripe sandbox complet : onboarding, achat, annulation, expiration, acompte, webhook répété/tardif et remboursement ; vérifier commande, solde, billet et e-mail.
4. Tester souscription interne, facture/PDF, remise, notification, résiliation et renouvellement avec les droits réels du cron, y compris échec puis reprise Billit simulée.
5. Terminer l'inventaire production R1–R4 en lecture seule et préparer un déroulé de promotion/retour arrière compatible avec les clients et callbacks existants.

Le verdict favorable demande ces corrections et preuves. Le présent audit ne confirme aucune résolution métier en production, et aucun déploiement n'a été demandé ou effectué.

## Preuves conservées et commandes de reproduction

Répertoire : `C:/Users/jorda/Desktop/Taff/eventflow-audit-20260929`.

- Rapports spécialisés : `audit-payments.md`, `audit-sql-billing.md`, `audit-frontend.md`.
- Résultats : `audit-github-status.json`, `audit-http-smoke.json`, `audit-staging-negative.json`, `audit-browser-smoke.json`, `audit-eslint.json`, `audit-npm-security.json` et journaux `audit-*.log`.
- Probes locales : fichiers ci-dessous. Elles confirment la présence des défauts actuels ; leur succès n'indique pas que les défauts sont corrigés.

```powershell
Set-Location C:/Users/jorda/Desktop/Taff/eventflow-audit-20260929
npx vitest run tests/unit/auditFrontend.probe.test.ts
deno test --config supabase/functions/deno.json --allow-env audit-payments-repro.test.ts
node audit-payments-sql.mjs
node audit-tools/audit-sql-billing-repro.mjs
deno run --config supabase/functions/deno.json --allow-env --deny-net audit-tools/audit-billing-effects-repro.ts
```

Les bibliothèques de reproduction PGlite et Playwright sont installées uniquement dans les sous-répertoires d'audit, sans modification des dépendances de l'application.

## Suivi des corrections locales A1–A9

Les neuf premiers points ont ensuite été corrigés localement sur `dev` à la
demande de l'utilisateur. Le détail des changements, des tests et des limites
figure dans [le rapport de correction](2026-09-29-corrections.md). Les constats
ci-dessus restent la photographie de l'audit initial ; aucune résolution en
production ni aucun déploiement n'est attesté par ces modifications locales.
