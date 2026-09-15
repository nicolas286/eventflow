# Eventflow — Frontend

Hérite de [../AGENTS.md](../AGENTS.md). Consulter [l'architecture](../docs/ARCHITECTURE.md) et les fiches composants/design pour les changements UI.

## Organisation actuelle

- `app/routes`, `app/layouts`, `app/providers` : navigation, composition et session.
- `app/modules/admin` et `app/modules/public` : pages, composants, hooks, repositories et schémas par fonctionnalité.
- `shared/ui` : composants et thème ; `shared/gateways/supabase` : client et wrappers d'accès.
- `shared/models`, `shared/helpers`, `shared/errors`, `shared/hooks` : responsabilités transversales.

## Changements frontend

- Viser `page → hook → repository → wrapper Supabase`, sans déplacer globalement les modules existants.
- Les composants de présentation reçoivent données et callbacks. Ne pas y introduire d'appels Supabase.
- Réutiliser `shared/gateways/supabase/supabaseClient.ts` et les wrappers `supabaseSafe`, `supabaseEdgeSafe`, `supabaseStorageSafe` selon l'opération.
- Réutiliser les schémas et normalisations ; la validation frontend ne remplace pas celle du serveur.
- Recharger ou nettoyer les données lors d'un changement de session/organisation ; une route masquée n'est pas une autorisation.
- Utiliser `getPublicOrigin()` pour les liens partage/widget ; pas d'URL production comme fallback staging.
- Préserver les états chargement, vide, erreur, sauvegarde, succès et saisie non enregistrée.
- Conserver le CSS colocalisé existant, notamment `.desktop.css`/`.mobile.css`. Pas de conversion globale en CSS Modules.
- TanStack Query et une couche i18n ne sont pas supposés disponibles ; leur introduction relève d'une tâche dédiée.

Validation : suivre [TESTING](../docs/agents/TESTING.md). Pour un formulaire, vérifier erreurs, annulation, saisie non sauvegardée, clavier et petit écran. Rapporter les vérifications visuelles non effectuées.
