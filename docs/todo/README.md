# Travaux à reprendre

État au 15 septembre 2026. Ces documents décrivent des tâches futures, pas des fonctionnalités déjà livrées.

1. [Configurer Mollie staging](mollie-staging.md) : OAuth billetterie, clé test des abonnements et recette du renouvellement.
2. Valider les e-mails Supabase Auth staging (reset de mot de passe, redirections et SMTP), distincts de la capture des e-mails métier.
3. [Refactoring progressif](refactoring.md) : caractérisation puis extractions limitées, sans migration globale immédiate.
4. Traiter séparément le défaut observé sur les commandes ne créant aucun participant : `p_new_attendees must be > 0`.
5. Améliorer les diagnostics prestataires sans journaliser de secrets ou réponses brutes.

Lorsqu'une tâche est terminée, noter la preuve (tests, PR, recette), les limites restantes et mettre à jour ce sommaire.
