# Stripe Connect et facturation Eventflow

## Décision d’architecture

Mollie n’est plus utilisé pour créer, modifier ou annuler un paiement. Ses identifiants restent conservés pour l’historique.

Les deux flux financiers sont séparés :

- **billetterie** : Checkout Stripe en `payment`, sous forme de direct charge sur le Connected Account Express de l’organisateur, exclusivement avec Bancontact ;
- **abonnements Eventflow** : facture interne payable par virement dans les 14 jours, sans Stripe Customer, Stripe Billing, Checkout d’abonnement ni Customer Portal.

Le compte bancaire indiqué sur les factures est le compte CBC `BE51 7320 8102 5262`, au nom de `Eventflow - Nicolas Manns`. La communication est `E-<numéro de facture>`.

## Billetterie Stripe Connect

La route publique `orders` crée la commande puis une Checkout Session dans le Connected Account de l’organisateur. Le paramètre `payment_method_types[0]=bancontact` empêche Checkout de proposer une carte.

Les organisations anciennement onboardées avec Mollie, en test ou en live, reçoivent une alerte d’onboarding Stripe. Un événement payant reste bloqué tant que le compte Stripe n’a pas ses indicateurs `details_submitted`, `charges_enabled` et `payouts_enabled` à `true`. Les inscriptions gratuites restent disponibles.

Le webhook Connect vérifie la signature, exige un événement lié à un Connected Account et utilise le journal privé `private.payment_webhook_events` pour l’idempotence.

## Abonnements et factures internes

Lors d’une souscription ou d’un passage vers un plan supérieur :

1. l’utilisateur complète ses informations de facturation ;
2. la route `subscriptions` vérifie son identité et son rôle dans l’organisation ;
3. la RPC privée `create_manual_subscription_invoice` active le plan et crée atomiquement une facture `issued` ;
4. l’échéance est fixée à 14 jours et le PDF contient les coordonnées de virement ;
5. l’écran d’accueil affiche la facture ouverte jusqu’à son passage au statut `paid` ou `void` ;
6. le PDF est généré immédiatement ; l’envoi Billit reste désactivé dans les environnements restrictifs et est tenté en production.

Un nouvel appel identique pendant la période active réutilise la facture existante. Les anciennes références Mollie sont copiées dans `mollie_legacy_snapshot` lors du premier passage volontaire à la facturation interne, sans être modifiées ni appelées.

Le job PostgreSQL quotidien `eventflow-manual-subscription-renewals` crée de façon idempotente la facture de la période suivante pour les abonnements manuels arrivés à échéance. La facture devient immédiatement visible dans la notification d’accueil ; son PDF est généré à la demande s’il ne l’était pas encore.

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
- Les factures créées par le job de renouvellement suivent le circuit comptable existant pour leur transmission éventuelle à Billit ; le job ne déclenche pas lui-même cet envoi et aucun envoi Peppol n’est tenté en staging.
- Aucun paiement Stripe réel ne doit être exécuté dans les tests automatisés.
