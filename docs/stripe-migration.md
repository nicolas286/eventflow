# Stripe Connect et facturation Eventflow

## Décision d’architecture

Mollie n’est plus utilisé pour créer, modifier ou annuler un paiement. Ses identifiants restent conservés pour l’historique.

Les deux flux financiers sont séparés :

- **billetterie** : Checkout Stripe en mode paiement, sous forme de direct charge sur le compte Stripe Standard de l’organisateur, exclusivement avec Bancontact ;
- **abonnements Eventflow** : facture interne payable par virement dans les 14 jours, sans Stripe Customer, Stripe Billing, Checkout d’abonnement ni Customer Portal.

Le compte bancaire indiqué sur les factures est le compte CBC `BE51 7320 8102 5262`, au nom de `Eventflow - Nicolas Manns`. La communication est `E-<numéro de facture>`.

## Billetterie Stripe Connect

La route publique `orders` crée la commande puis une Checkout Session dans le Connected Account de l’organisateur. Le paramètre `payment_method_configuration`, fourni par `STRIPE_PAYMENT_METHOD_CONFIGURATION_ID`, sélectionne la configuration parente Connect qui doit conserver uniquement Bancontact activé.

Lors de la création d’un nouveau compte Standard, Eventflow demande uniquement `capabilities[bancontact_payments][requested]=true`. La demande ne garantit pas une activation immédiate : Stripe doit rendre la capacité active pour que Bancontact soit disponible. Ce changement ne retire aucune capacité des comptes existants ; leur éventuelle régularisation reste distincte.

Le déploiement est contrôlé par `user_profile.stripe_connect_allowed`, géré uniquement par un opérateur de confiance et à `false` par défaut, y compris pour les nouveaux comptes. Une organisation non autorisée voit une alerte globale et ses billets payants ne sont pas sélectionnables. Quand son owner est explicitement autorisé, l’interface l’invite à refaire l’onboarding Stripe. Un événement payant reste bloqué tant que l’organisateur n’a pas validé ses conditions de vente et que le compte Stripe n’est pas Standard (ou équivalent avec Dashboard complet et responsabilité Stripe), sans exigence en attente, avec les indicateurs `details_submitted`, `charges_enabled` et `payouts_enabled` à `true`. Les inscriptions gratuites restent disponibles.

Le webhook Connect vérifie la signature et le mode live/test, exige un événement lié à un Connected Account et utilise le journal privé `private.payment_webhook_events` pour l’idempotence. Un remboursement total invalide les billets et libère la capacité une seule fois ; un e-mail de remboursement idempotent est envoyé.

La réservation Stripe et la Checkout Session partagent une échéance persistée de
35 minutes à la création. Les retries conservent cette échéance et la même clé
d'idempotence. Le stock reste réservé tant que Stripe indique un paiement ouvert
ou en cours de traitement, même après l'heure prévue. Le webhook d'expiration et
le worker existant `/workers/reminders` rapprochent l'état réel de Stripe avant
de libérer le stock. Le reçu SQL `processed_at` empêche de comptabiliser deux
fois un acompte lors d'une reprise.

Un paiement reçu pour une commande déjà expirée ou annulée ne recrée pas de
réservation : il déclenche le remboursement du montant reçu, avec reprise du
même remboursement en cas d'interruption. Le rapprochement vérifie le compte,
le PaymentIntent, le montant et la devise. Un remboursement partiel ou ambigu
demande une vérification et ne provoque pas un nouveau remboursement intégral.
La planification du worker doit donc rester active ; une indisponibilité Stripe
conserve prudemment le stock jusqu'au prochain rapprochement.

Le virement bancaire de billetterie reste conservé pour l’historique mais est désactivé par le flag global.

Les conditions organisateur par défaut sont créées pour toutes les organisations. Elles doivent être relues et validées par un owner ou admin avec un e-mail public avant onboarding. Leur version et leur snapshot accepté par l’acheteur sont conservés. Une réauthentification dédiée avant validation reste une amélioration future.

## Abonnements et factures internes

Lors d’une souscription ou d’un passage vers un plan supérieur :

1. l’utilisateur complète ses informations de facturation ;
2. la route `subscriptions` vérifie son identité et son rôle dans l’organisation ;
3. la RPC privée `create_manual_subscription_invoice` active le plan et crée atomiquement une facture `issued` ;
4. l’échéance est fixée à 14 jours et le PDF contient les coordonnées de virement ;
5. l’écran d’accueil affiche la facture ouverte jusqu’à son passage au statut `paid` ou `void` ;
6. le PDF est généré immédiatement ; l’envoi Billit reste désactivé dans les environnements restrictifs et est tenté en production.

Un nouvel appel identique pendant la période active réutilise la facture existante. Les anciennes références Mollie sont copiées dans `mollie_legacy_snapshot` lors du premier passage volontaire à la facturation interne, sans être modifiées ni appelées.

Les abonnements Mollie payants encore actifs lors de la migration sont convertis sans appel à Mollie vers le fournisseur `manual`. Leur plan est prolongé gratuitement jusqu’au 1er novembre 2026 à 00:00 (Europe/Brussels). `billing_deferred_until` et un trigger empêchent toute émission anticipée ; la première facture de renouvellement ne peut être créée qu’à partir de cette échéance. Les prix, promotions et identifiants historiques restent conservés.

Le job PostgreSQL `eventflow-manual-subscription-renewals` passe toutes les cinq
minutes et crée de façon idempotente la facture de la période suivante pour les
abonnements manuels arrivés à échéance. Une grâce maximale d'une heure conserve
les droits d'un abonnement manuel actif dont le plan et l'échéance correspondent
à ceux de l'organisation. Pendant cette grâce, la période suivante part de
l'échéance précédente. Après une interruption plus longue, elle repart au
moment de la reprise, sans générer de factures rétroactives. Une résiliation
désactive immédiatement cette grâce et remet l'organisation sur Free.

La facture devient visible dans la notification d'accueil ; son PDF est généré
à la demande s'il ne l'était pas encore. Un échec PDF/Billit après création ne
fait plus échouer la souscription déjà validée : l'écran affiche l'avertissement
et permet de reprendre les erreurs déterministes. Une réponse Billit incertaine
demande un rapprochement préalable pour éviter un doublon. Les détails figurent
dans [Reprise des livraisons de paiement](todo/payment-delivery.md).
Le worker de rappels prend également en charge les nouvelles factures manuelles
créées automatiquement à partir du 1er novembre, sans reprendre en masse les
anciennes factures.

## Variables Edge Functions

À définir séparément en staging et en production :

```text
EVENT_PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_... ou sk_live_...
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...
```

Les clés Stripe live sont refusées dans un environnement staging/restrictif. Aucun secret Stripe Billing ni Price ID Stripe n’est nécessaire.

## Webhook Connect

Staging :

```text
https://cpcmcxerrsnnjncrhldr.supabase.co/functions/v1/stripe-webhook-connect
```

Production :

```text
https://dixirvllhfkvqoahhfqh.supabase.co/functions/v1/stripe-webhook-connect
```

Événements :

```text
account.updated
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
refund.created
refund.updated
```

## Déploiement staging

1. Configurer la clé Stripe test et le secret du webhook Connect dans le projet Supabase staging.
2. Laisser `EVENT_PAYMENT_PROVIDER=disabled` pendant le déploiement initial si les secrets ne sont pas encore prêts.
3. Pousser sur `dev` et laisser le workflow déployer d’abord les migrations et Edge Functions, puis le frontend.
4. Vérifier une souscription interne : plan actif, facture `issued`, échéance à 14 jours, notification d’accueil et PDF.
5. Terminer l’onboarding d’une organisation synthétique dans Stripe test.
6. Passer `EVENT_PAYMENT_PROVIDER=stripe`, réaliser un paiement Bancontact test et vérifier commande, webhook, billet et e-mail capturé.
7. Tester les retries webhook, l’expiration, l’échec et le remboursement.
8. Ne déployer en production qu’après validation humaine du staging.

## Retour arrière

- Mettre `EVENT_PAYMENT_PROVIDER=disabled` pour bloquer les nouveaux paiements de billets.
- Garder le webhook Connect actif afin de finaliser les paiements déjà ouverts.
- Corriger le schéma par une nouvelle migration ; ne jamais faire de `db reset` sur un projet distant.
- Ne pas restaurer Mollie comme fournisseur actif et ne pas supprimer son historique.

## Limites connues

- Le rapprochement d’un virement et le passage de la facture à `paid` restent opérés par le circuit comptable existant.
- Les factures créées par le job de renouvellement sont reprises par le worker existant pour génération du PDF et transmission Billit éventuelle. Aucun envoi Peppol n’est tenté en staging.
- Aucun paiement Stripe réel ne doit être exécuté dans les tests automatisés.
