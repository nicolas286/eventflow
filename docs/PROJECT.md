# Eventflow — Produit et repères métier

Eventflow aide de petits organisateurs à publier leurs événements, recueillir les inscriptions, vendre des billets et suivre les participants. Le back-office couvre aussi commandes, formulaires, exports, billets/QR, profil d'organisation et abonnements Eventflow.

Ce document synthétise le code observé ; il ne constitue pas une spécification exhaustive des règles métier.

| Terme | Rôle |
| --- | --- |
| Organisation | Périmètre d'appartenance et d'accès aux données métier |
| Événement | Publication, dates, produits/billets et règles d'inscription |
| Produit d'événement | Élément commandable ; crée ou non des participants selon sa configuration |
| Commande | Inscription ou achat, montants, statut et suivi de paiement |
| Participant | Personne inscrite et réponses au formulaire, distincte de l'acheteur |
| Billet | Droit d'accès émis, PDF et contrôle QR |
| Plan | Offre Eventflow (`free`, `starter`, `pro`), limites dans `plan_limits` |

## Invariants à préserver et vérifier

- Isolation des organisations, y compris RPC, exports, Storage et accès directs.
- Montants monétaires en centimes ; conversions et taux de TVA explicites aux frontières.
- Un retour navigateur ne prouve pas un paiement ; son état doit être vérifié côté serveur.
- Un webhook répété ne doit pas provoquer une nouvelle opération métier injustifiée.
- Distinguer abonnement de l'organisateur à Eventflow et paiement de billets pour son organisation.
- Traiter booking tokens et QR comme des capacités d'accès sensibles.
- Garantir les limites des plans et autorisations côté serveur/base.

Ce sont des critères de revue ; leur couverture exhaustive par les tests historiques n'est pas acquise.

## État au 15 septembre 2026

- Staging et production séparés, CI/CD opérationnelle sur `dev` et `main` (PR #181 déployée).
- PR #182 : `redirect_uri` ajouté au renouvellement OAuth Mollie ; résolution de l'incident confirmée par le propriétaire.
- Staging : fixtures synthétiques, inscription gratuite et PDF validés, capture des e-mails métier et crons propres au projet.
- À terminer : [Mollie staging](todo/mollie-staging.md), e-mails Supabase Auth, puis [refactoring progressif](todo/refactoring.md).

Ne pas déduire le mode Mollie du nom de l'environnement : l'organisation de l'incident production était connectée en mode test.
