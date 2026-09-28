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

- [supabase/functions/register-tickets/stripe-payment-provider.ts](supabase/functions/register-tickets/stripe-payment-provider.ts)

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
4. Activer `EVENT_PAYMENT_PROVIDER=stripe` uniquement après la configuration des secrets.
5. Tester un onboarding Express et un paiement Bancontact Stripe test.
6. Tester une souscription et un upgrade : plan actif, facture, notification, PDF et échéance à 14 jours.
7. Vérifier sur staging que le job `eventflow-manual-subscription-renewals` est présent et qu’un abonnement synthétique arrivé à échéance produit une seule nouvelle facture.
8. Après validation du staging, préparer des secrets et un webhook Connect live distincts pour la production.

Ressources : [Stripe Support](https://support.stripe.com) et [Stripe MCP](https://docs.stripe.com/mcp).
