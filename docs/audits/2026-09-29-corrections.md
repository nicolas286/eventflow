# Corrections A1–A9 de l'audit préproduction

Travail local sur `dev`, à partir de `98820984c1f3e1f2dd7b46031d98f6a9d859dff7`.
Ce rapport décrit la validation locale avant le commit et le push sur `dev`
autorisés ensuite par l'utilisateur. La production reste exclue de cette publication.
Périmètre demandé : uniquement les neuf premiers points de
[l'audit initial](2026-09-29-preproduction.md). A10 et les conditions de promotion
R1–R4 restent hors de cette correction. Aucun commit, push ou déploiement effectué.

## Changements réalisés

| Point | Correction | Preuve principale |
| --- | --- | --- |
| A1 — Acompte Stripe compté plusieurs fois | Association session/PaymentIntent et application SQL sous verrou ; reçu durable indépendant de l'ordre des webhooks ; un retry après annulation ne délivre pas de billets. | SQL : deux applications et événement terminal désordonné, montant inchangé. Backend : webhook signé interrompu puis repris. |
| A2 — Paiement après libération du stock | Échéance Checkout/réservation commune, état Stripe vérifié avant expiration, reprise par worker. Réception tardive sur commande fermée remboursée sans reprise du stock. | SQL : réservation préservée, libération unique et solde réception/remboursement à zéro. Backend : Stripe indisponible, paiement en cours, remboursement repris et remboursement partiel refusé. |
| A3 — Renouvellement refusé au cron | Création de l'état Peppol dans la transaction autorisée de facture ; plus d'appel imbriqué exigeant un JWT absent du cron. | SQL : renouvellement sous rôle postgres sans JWT, service_role autorisé, anon/authenticated refusés. |
| A4 — Résiliation absente | Action pour abonnement manuel, confirmation du passage immédiat à Free, état de chargement, erreur et reprise. | Tests de rendu et navigateur : abandon sans requête, double clic bloqué, échec puis succès et actualisation. |
| A5 — Bootstrap incomplet | Restauration facture ouverte manuelle, tarification et promotion, avec contrôle d'organisation et masquage bancaire existant conservé. | SQL : deux organisations, contrat bootstrap, exclusion des anciennes factures sans le contrat manuel. |
| A6 — E-mail de virement non retentable | Journal de livraison avec bail, statut envoyé après succès et reprises des échecs par le worker de rappels. | SQL : baux et rôles. Backend : échec, reprise, concurrence simulée et même clé prestataire. |
| A7 — Confirmation fondée sur le cache | Lecture serveur systématique ; coordonnées de virement visibles seulement pour l'état actuel payable. Le cache ne décide plus du statut. | Tests et navigateur : attente, commande payée/expirée, 403, réseau, reprise, credentials URL incomplets. |
| A8 — Erreur Billit après souscription validée | Succès métier conservé, avertissements séparés, reprise des effets manquants sur facture réutilisée, bail de transmission exclusif. | Backend/SQL : erreur PDF, erreurs déterministes et incertaines, facture déjà envoyée. Navigateur : reprise même payload, erreurs et garde de période expirée. |
| A9 — Interruption de droits au renouvellement | Cron toutes les cinq minutes, grâce bornée à une heure pour abonnement manuel actif cohérent, sans grâce après résiliation. | SQL : frontières temporelles, retard de deux mois sans arriérés, idempotence, abonnement annulé ou incohérent. |

Trois nouvelles migrations portent les changements de base : `20260929140000`,
`20260929141000` et `20260929142000`. Aucune migration historique n'a été réécrite.
Les workflows exécutent désormais tous les fichiers de `tests/database/*.sql`
après reconstruction de la base jetable.

## Validation locale

- Frontend : 97 tests Vitest et 13 tests de déploiement réussis.
- Backend : 100 tests Deno réussis ; vérification de types et lint backend réussis.
- Compilation `npm run build` réussie ; avertissement existant de taille du bundle.
- Navigateur Chrome : 15 scénarios avec fixtures réseau sur ordinateur et mobile,
  sans erreur de page ni débordement horizontal sur les écrans vérifiés.
- Trois suites SQL correctives exécutées sous PostgreSQL embarqué PGlite, avec
  vrais rôles et fonctions migrées. La suite Stripe inclut les contraintes des
  tables concernées et le vrai trigger du journal financier.
- `git diff --check` réussi. Le lint global conserve les 54 erreurs et 2
  avertissements préexistants ; aucun nettoyage hors périmètre n'a été entrepris.

Les journaux et harnesses locaux sont conservés dans
`C:/Users/jorda/Desktop/Taff/eventflow-audit-20260929` : `fix-*.log`,
`audit-tools/*fixes-regression.mjs`, `audit-tools/subscription-fixes-regression.mjs`
et `audit-frontend-fix-smoke.mjs`.

## Limites et recette distante

Docker/Supabase local complet n'était pas disponible. PGlite valide les fonctions
et contrats concernés avec tables de support synthétiques ; cela ne remplace pas
la reconstruction complète de toutes les migrations ni un test concurrent sur
plusieurs connexions. Les workflows contiennent ces suites, mais aucune nouvelle
exécution GitHub n'a été déclenchée.

Aucun paiement Stripe sandbox réel, e-mail client ou envoi Billit n'a été effectué.
Les migrations ne sont pas appliquées au staging ni à la production. La recette
staging, les secrets et les conditions R1–R4 de l'audit initial restent à valider.
Le worker `/workers/reminders` doit être effectivement planifié pour les reprises
d'e-mails et le rapprochement Stripe. Les anciens envois de virement au résultat
inconnu restent `legacy_unknown`, sans réexpédition générale.

La reprise Billit depuis l'écran est disponible pendant la session de page. Après
rechargement, le PDF reste téléchargeable ; l'interface ne reconstitue pas un état
de transmission Billit que son contrat actuel de liste des factures ne fournit
pas. Toute réponse Billit ambiguë nécessite un rapprochement avant retransmission.

Les paramètres Stripe ont été recoupés avec la documentation officielle :
[Checkout](https://docs.stripe.com/api/checkout/sessions/create),
[idempotence](https://docs.stripe.com/api/idempotent_requests) et
[liste des remboursements](https://docs.stripe.com/api/refunds/list).
