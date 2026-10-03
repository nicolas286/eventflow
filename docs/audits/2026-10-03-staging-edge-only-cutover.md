# Bascule staging vers Edge-only — 3 octobre 2026

Autorisation utilisateur : fermeture des accès directs puis retrait RLS sur staging.
Cible vérifiée : `eventflow-staging`, `cpcmcxerrsnnjncrhldr`, 69 migrations avant bascule.
Le frontend et les Edge A0–D5 avaient été publiés et vérifiés au commit `8c12269`.

## Fermeture préparée

Migration `20261003192000_close_staging_business_browser_access.sql`, limitée à la
cible via sa configuration d'assets exacte. Production et replay local standard
restent inchangés ; une configuration inconnue arrête la migration.

- Permissions tables, colonnes, vues, séquences et routines applicatives retirées
  pour PUBLIC/anon/authenticated ; service conservé.
- USAGE de public et private retiré aux rôles navigateur. Les quatre routines
  managed unaccent restent détenues par supabase_admin, mais sont inaccessibles
  au navigateur, y compris si leurs ACL d'extension sont permissives.
- Wrapper GraphQL managed conservé : extension pg_graphql désactivée sur staging,
  wrapper invoker connu retournant une erreur sans accès métier. La migration
  refuse une modification de cet état ou un objet managed inconnu.
- Policy PDF navigateur et trois policies d'écriture assets retirées ; lecture
  publique des assets et RLS Auth/Storage conservées.
- Aucun consommateur métier Realtime ni publication métier présent au préflight.
- Defaults postgres déjà fermés et recontrôlés. Defaults supabase_admin inchangés,
  protégés dans public par l'absence de schema USAGE navigateur.

Les [métadonnées avant bascule](2026-10-03-staging-boundary-before.json) conservent
ACL et définitions des policies, sans données clients ni secrets, pour l'analyse
et la préparation d'une correction éventuelle.

## Preuves avant publication

70 migrations rejouées dans une stack jetable. Cinq scénarios SQL de fermeture
réussis avec le rôle postgres **non-superuser**, correspondant au rôle hébergé :
skip production/local, cible inconnue refusée, objet managed inconnu refusé,
fermeture réelle répétable, refus anon/authenticated et service/Storage conservés.
Vues propriétaire, grants de colonnes, RPC oubliée, séquence et objets futurs
managed permissifs injectés dans des transactions annulées.

La recette `tests/integration/business-boundary.staging.mjs` teste les Edge
réellement déployées avec deux utilisateurs/organisations synthétiques, leurs
contrats et les refus cross-tenant et REST/RPC/GraphQL/Storage. Elle s'exécute dans
le workflow staging avec ses secrets existants, avant publication frontend.
Fixtures nettoyées dans finally ; aucune réponse avec token ou URL signée affichée.
Pas de paiement prestataire, e-mail client ni réglage global modifié. Les commandes
sont des fixtures service, leurs lectures, modifications, exports et scans passent
par les véritables Edge ; la création publique nominale n'est pas revendiquée.

## Ordre de publication

1. Publier la fermeture ACL staging et exécuter la recette hébergée avec RLS présente.
2. Après réussite, publier une migration distincte de retrait RLS métier public,
   protégée par les assertions de fermeture et la même garde d'environnement.
3. Refaire la recette hébergée et les refus sous anon/authenticated ; inventorier
   les ACL et policies finales sur la cible.

La pause D5 n'est plus nécessaire sur staging, où D5 est déjà déployée ; elle
reste dans le pipeline production. Les scripts différés historiques B0–B6 gardent
leur valeur de référence pour la future bascule production, à adapter aux droits
et à la configuration attestés de cette autre cible.

Ce document décrit la préparation ; les résultats hébergés sont établis par les
workflows des commits de bascule et l'inventaire final, pas par les seuls tests locaux.
