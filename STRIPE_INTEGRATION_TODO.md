# Stripe Connect — configuration restante

Ce fichier est la source de vérité pour terminer la configuration de la billetterie Stripe Connect. Les abonnements Eventflow sont facturés en interne et ne passent pas par Stripe.

## Values to Replace

**Files containing placeholders:**

- [.env.example](.env.example)

| Field                           | Current Value        | What to Set                                                                                                   |
| ------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`             | `sk_test_replace_me` | Clé secrète Stripe test du compte plateforme dans Supabase staging. Ne jamais utiliser une variable `VITE_*`. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `whsec_replace_me`   | Secret de signature de l’endpoint webhook Connect staging.                                                    |

## Configured Parameters

**File:**

- [supabase/functions/orders/public/stripe-payment-provider.ts](supabase/functions/orders/public/stripe-payment-provider.ts)

| Parameter                         | Value                                           |
| --------------------------------- | ----------------------------------------------- |
| `ui_mode`                         | `hosted_page`                                   |
| `mode`                            | `payment`                                       |
| `payment_method_types[0]`         | `bancontact`                                    |
| `billing_address_collection`      | `auto`                                          |
| `phone_number_collection.enabled` | `false`                                         |
| `automatic_tax.enabled`           | `false`                                         |
| `allow_promotion_codes`           | `false`                                         |
| `submit_type`                     | `auto`                                          |
| `integration_identifier`          | `hosted_web_0001`                               |
| `origin_context`                  | `web`                                           |
| `success_url`                     | URL réelle de retour de la commande             |
| `cancel_url`                      | URL réelle de retour avec annulation            |
| `line_items`                      | `price_data` dynamique de la commande Eventflow |

## Facturation des abonnements

- Aucun Stripe Customer, abonnement Stripe, Price ID, webhook Billing ou Customer Portal n’est utilisé.
- Une souscription ou un upgrade génère une facture interne payable sous 14 jours.
- Le PDF indique `Eventflow - Nicolas Manns`, le compte CBC `BE51 7320 8102 5262` et la communication `E-<numéro de facture>`.
- Une facture ouverte produit une notification sur l’accueil administrateur.
- Les identifiants Mollie existants restent historiques.

## Setup and next steps

1. Configurer l’endpoint Connect staging : `https://cpcmcxerrsnnjncrhldr.supabase.co/functions/v1/stripe-webhook-connect`.
2. Ajouter les événements listés dans [docs/stripe-migration.md](docs/stripe-migration.md).
3. Enregistrer `STRIPE_SECRET_KEY` et `STRIPE_CONNECT_WEBHOOK_SECRET` dans les secrets Supabase staging.
4. Activer `EVENT_PAYMENT_PROVIDER=stripe` uniquement après la configuration des secrets. Le virement bancaire reste disponible indépendamment de cette variable.
5. Autoriser explicitement les utilisateurs pilotes en positionnant `public.user_profile.stripe_connect_allowed = true` avec un accès serveur ou administrateur. Ne jamais exposer ce changement dans le profil utilisateur.
6. Tester un nouvel onboarding Standard et un paiement Bancontact Stripe test. Les comptes déjà onboardés en Express sont conservés et ne sont pas convertis automatiquement.
7. Tester un utilisateur non autorisé : aucune mention ni action Stripe dans l’interface, endpoints Connect refusés, et virement bancaire proposé.
8. Tester une souscription et un upgrade : plan actif, facture, notification, PDF et échéance à 14 jours.
9. Vérifier sur staging que le job `eventflow-manual-subscription-renewals` est présent et qu’un abonnement synthétique arrivé à échéance produit une seule nouvelle facture.
10. Après validation du staging, préparer des secrets et un webhook Connect live distincts pour la production.

## Responsabilité et flux Connect

- Les paiements de billets sont des direct charges : la Checkout Session est créée avec l’en-tête `Stripe-Account` du compte connecté, sans `transfer_data` ni `on_behalf_of`.
- Seul Bancontact est activé ; Stripe indique que ce moyen de paiement ne prend pas en charge les contestations donnant lieu à des chargebacks.
- Les nouveaux comptes sont créés en Standard afin que Stripe, et non Eventflow, assume la responsabilité ultime des soldes négatifs. Un compte Express existant ne change pas de type automatiquement.

Ressources : [Stripe Support](https://support.stripe.com) et [Stripe MCP](https://docs.stripe.com/mcp).
