# Audit du routage Stripe Connect — 29 septembre 2026

## Conclusion

La billetterie crée une **direct charge** sur le compte Connect enregistré pour
`orders.org_id` : la requête de création Checkout porte l'en-tête
`Stripe-Account`. Aucune destination de virement n'est fournie par le client.
L'enregistrement SQL et le webhook refusent un compte différent de celui de
l'organisation de la commande. Les deux organisations synthétiques du test SQL
confirment ces refus.

Il ne s'agit pas d'une attestation des comptes bancaires en production : ni les
associations `organizations.stripe_connected_account_id` de production ni les
destinations de versement configurées dans Stripe n'ont été consultées.

## Chaîne vérifiée

1. `orders/public/db.ts` lit `events.org_id`. La RPC `create_order_intent`
   insère `orders.org_id` depuis le même événement, sans ID d'organisation
   fourni par l'acheteur.
2. `orders/public/payment-provider.ts` lit
   `organizations.stripe_connected_account_id` pour cet ID et exige un compte
   prêt. `stripe-payment-provider.ts` appelle `/v1/checkout/sessions` avec
   `connectedAccountId`. `stripe-api.ts` le place dans `Stripe-Account`.
3. `register_stripe_checkout_payment` vérifie que ce compte est le compte
   courant de `orders.org_id` avant de stocker et de retourner le lien Checkout.
   Le compte est verrouillé pendant cette vérification. Un Checkout réutilisé
   est également filtré sur l'ID Connect courant.
4. Le webhook vérifie signature et mode, utilise `event.account`, puis
   `apply_stripe_checkout_payment` compare commande, compte, session,
   PaymentIntent, montant et devise avec le paiement enregistré.
5. Un index unique empêche deux organisations de porter simultanément le
   même `stripe_connected_account_id`. Les rôles `anon` et `authenticated`
   ne peuvent pas modifier directement `organizations` ni appeler les RPC
   Stripe privilégiées.

Les métadonnées Stripe `eventflow_org_id` servent à la traçabilité ; l'en-tête
`Stripe-Account` et les contrôles SQL déterminent le compte de paiement.

## Écart corrigé

La rotation d'un compte pendant un Checkout ouvert pouvait laisser un paiement
sur l'ancien compte sans traitement, car le webhook exigeait le compte courant.
La migration `20260929160000_guard_stripe_account_rotation.sql` bloque maintenant
la rotation tant qu'un Checkout non traité est ouvert, et sérialise son
enregistrement avec la rotation. `persistStripeAccountStatus` refuse une mise à
jour de statut fondée sur un ID Connect devenu ancien.

## Preuves exécutées

- `npm run check:backend` : réussi.
- `npm run lint:backend` : 172 fichiers vérifiés.
- `npm run test:backend` : 103 tests réussis, dont l'en-tête Connect à la
  création de Checkout, le filtrage d'un Checkout réutilisé et le refus d'une
  mise à jour de statut périmée.
- Test SQL `tests/database/stripe-checkout-regressions.sql` avec la nouvelle
  migration dans une seule transaction locale annulée : réussi. Deux
  organisations et deux comptes synthétiques ; refus à l'enregistrement et
  à l'application d'un paiement croisé ; refus de rotation pendant un Checkout
  ouvert ; vérification des grants des rôles réels.

Aucun paiement Stripe réel, test staging, vérification de production ou
déploiement n'a été effectué. Avant d'affirmer que chaque versement réel arrive
au bon bénéficiaire, rapprocher en lecture seule chaque organisation active,
son `acct_...`, l'identité du compte Stripe et ses coordonnées de versement,
puis tester une commande synthétique en mode test sur le staging visé.
