# Travaux à reprendre

État au 20 septembre 2026. Les validations effectuées et les travaux restants sont distingués ci-dessous.

## Validé

- [x] [Mollie staging](mollie-staging.md) : secrets configurés, Connect, paiement de billets et souscription fonctionnels en test, confirmés par le propriétaire le 20 septembre 2026.

## À poursuivre

1. Compléter la [recette Mollie](mollie-staging.md) : inspection mail/PDF, cas d'échec/annulation, répétition des webhooks, renouvellement OAuth et limites des plans. Ces contrôles ne sont pas couverts par la seule validation des parcours nominaux.
2. Valider les e-mails Supabase Auth staging (reset de mot de passe, redirections et SMTP), distincts de la capture des e-mails métier.
3. **Priorité : bascule et recette de la [réorganisation backend](backend.md)**. Deno, contrats partagés et API par domaine sont implémentés ; publication staging, consommateurs externes et recette restent à confirmer séparément. Le [frontend](refactoring.md) reste différé, sans promotion production dans cette tranche.
4. Traiter séparément le défaut observé sur les commandes ne créant aucun participant : `p_new_attendees must be > 0`.
5. Améliorer les diagnostics prestataires sans journaliser de secrets ou réponses brutes.
6. Adapter le contrôle HTTP de déploiement à la protection par mot de passe Netlify du staging, sans désactiver cette protection. Le correctif de déconnexion `18a3b79` est publié ; son workflow échoue au contrôle final anonyme (HTTP 401). Sa promotion en production reste distincte.

Lorsqu'une tâche est terminée, noter la preuve (tests, PR, recette), les limites restantes et mettre à jour ce sommaire.
