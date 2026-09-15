# Mission — Cohérence visuelle

Sources actuelles : `src/shared/ui`, notamment `components`, et les styles colocalisés des modules. Inspecter les variables CSS et le thème existants avant d'introduire de nouvelles valeurs.

- Réutiliser boutons, champs, cartes, modales, messages, toasts et barre de sauvegarde existants.
- Respecter les styles `.desktop.css`, `.mobile.css` ou `.css` du composant touché ; Eventflow n'utilise pas la convention CSS Modules de Nexora comme règle générale.
- Préserver le thème d'organisation et le rendu des pages publiques/widgets.
- Favoriser espacements et couleurs déjà utilisés ; ne pas inventer un second système de tokens dans une feature.
- Vérifier lisibilité, contraste, focus visible, zoom, petit écran et textes longs.
- Une bibliothèque présente dans les dépendances n'est pas une raison de réécrire les styles existants.

Livrable : composants/styles réutilisés, changements visuels intentionnels et vérifications effectuées. Toute refonte du design system relève d'une tâche dédiée.
