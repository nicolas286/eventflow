# Mission — Composants frontend

Lire `src/AGENTS.md`, DESIGN_SYSTEM et COPY_I18N. Chercher d'abord un composant équivalent dans `src/shared/ui/components` et ses usages.

- Garder la présentation dans le composant ; les appels et transformations métier passent par le hook/repository de la feature.
- Garder un composant métier dans son module ; une abstraction partagée doit répondre à plusieurs usages réels.
- Types de props explicites, callbacks lisibles ; pas de couche générique complexe pour économiser quelques lignes.
- Préserver chargement, vide, erreur, validation, soumission, annulation et état non sauvegardé.
- Associer labels et champs ; assurer clavier, focus et erreurs compréhensibles.
- Pour les tableaux/éditeurs, vérifier petits écrans et contenus longs ; ne pas réorganiser les règles métier avec le CSS.

Livrable : fichiers modifiés, comportement avant/après, réutilisation des composants, validations réalisées et limites visuelles. Ne pas annoncer une validation navigateur si seuls les tests unitaires ont tourné.
