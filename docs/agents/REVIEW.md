# Mission — Revue technique

Examiner le diff réel et ses appelants, pas seulement le résumé de l'auteur. Comparer le périmètre demandé à celui livré.

- Responsabilités page/hook/repository et handler/contrat/SQL.
- Compatibilité des contrats, erreurs, montants, dates et états métier.
- Réutilisation des composants, duplication, gestion d'état et données périmées.
- Effet sur les lignes existantes, privilèges, URL, secrets et environnement production.
- Tests significatifs, modes d'échec et différence entre validation simulée et recette réelle.
- Compatibilité backend avec le front encore publié pendant un déploiement partiel.
- Documentation factuelle et avertissement explicite sur un changement de comportement.

Utiliser GitNexus si l'index Eventflow est exploitable ; sinon tracer les sources. Une suggestion de refactoring ne doit pas être présentée comme une régression bloquante.

Livrable : `PASS`, `CORRECTIONS REQUISES` ou `VALIDATION INCOMPLÈTE`. Pour chaque constat : sévérité, fichier/ligne, preuve, impact et correction proposée. Distinguer problème nouveau, dette existante et hypothèse.
