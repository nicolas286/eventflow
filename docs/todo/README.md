# Travaux à reprendre

État des sources locales au 3 octobre 2026. Les validations effectuées et les travaux restants sont distingués ci-dessous.

## Validé

- [x] [Mollie staging](mollie-staging.md) : secrets configurés, Connect, paiement de billets et souscription fonctionnels en test, confirmés par le propriétaire le 20 septembre 2026.

## À poursuivre

1. Recetter les parcours actuels Stripe Connect/Checkout, virement et abonnements internes : inspection mail/PDF, échec/annulation, répétition des webhooks et limites des plans, exclusivement sur fixtures et prestataire test. La [recette Mollie](mollie-staging.md) documente une validation historique, pas le parcours nominal actuel.
2. Valider les e-mails Supabase Auth staging (reset de mot de passe, redirections et SMTP), distincts de la capture des e-mails métier.
3. **Priorité : bascule et recette de la [réorganisation backend](backend.md)**. Deno, contrats partagés et API par domaine sont implémentés ; publication staging, consommateurs externes et recette restent à confirmer séparément. Le [frontend](refactoring.md) reste différé, sans promotion production dans cette tranche.
4. Traiter séparément le défaut observé sur les commandes ne créant aucun participant : `p_new_attendees must be > 0`.
5. Améliorer les diagnostics prestataires sans journaliser de secrets ou réponses brutes.
6. Adapter le contrôle HTTP de déploiement à la protection par mot de passe Netlify du staging, sans désactiver cette protection. Le correctif de déconnexion `18a3b79` est publié ; son workflow échoue au contrôle final anonyme (HTTP 401). Sa promotion en production reste distincte.
7. Finaliser les suites hors périmètre du [paiement par virement](bank-transfer.md) : réauthentification, politique de confidentialité et rappels éventuels.
8. Recetter le [back-office plateforme](platform-admin.md) préparé sur `dev` : reconstruction SQL avec Docker, activation TOTP, attribution contrôlée du premier administrateur et tests négatifs. Les invitations Supabase Auth nécessitent un transport SMTP de test dédié ; `MAIL_MODE=capture` ne les intercepte pas. Publication staging et promotion production restent des actions séparées à autoriser.

Lorsqu'une tâche est terminée, noter la preuve (tests, PR, recette), les limites restantes et mettre à jour ce sommaire.
