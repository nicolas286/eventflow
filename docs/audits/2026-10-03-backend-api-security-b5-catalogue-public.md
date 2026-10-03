# B5.2 — Catalogue public et partage

Travail local sur `dev`, HEAD `4ef53f40c779b7bdbe65f80630a0d37bc7973574`.
Diff préexistant A0–B4 conservé. Aucun commit, PR distante, push, fusion,
déploiement ou mutation distante. À relire/publier séparément de B5.1 ; aucun B6.

## Routes, contrats et consommateurs

Trois repositories React (`makePublicOrgRepo`, `makePublicEventsOverviewRepo`,
`makePublicEventDetailRepo`) et `netlify/functions/share-event.js` étaient les
consommateurs réels des quatre RPC publiques. Ils passent exclusivement par les
sous-routes d’`events`, sans fallback. Aucun autre consommateur direct serveur ou
frontend trouvé dans le dépôt ; les clients externes hors dépôt restent à confirmer.

| POST events/public/… | Autorisation de publication | SQL service-only | Ancien accès |
| --- | --- | --- | --- |
| org | slug → profil/org actif | catalog_get_public_org_by_slug | get_public_org_by_slug |
| overview | même org actif ; curseur limité aux événements publiés de cet org | catalog_get_public_org_events_overview, page ≤100 | get_public_org_events_overview |
| detail | org actif → événement du même org, publié | catalog_get_public_event_detail + termes ; produits/champs/groupes actifs | get_public_event_detail + get_public_organization_sales_terms |
| sales-terms | org actif | catalog_get_public_organization_sales_terms, projection légale publique | get_public_organization_sales_terms |
| share | org actif + événement associé/publié | catalog_event_share, métadonnées uniquement | deux anciennes RPC Netlify org/overview |

Ces routes sont intentionnellement anonymes : une session absente ou invalide ne
donne ni ne retire de droit sur une ressource publiée. L’Edge ignore le JWT client,
utilise le client privilégié indépendant et ne lit avant autorisation que les
références minimales. Les SQL revalident org/slug/publication ; aucune dépendance
à RLS. Brouillon, slug croisé et organisation inactive → 404, sans données privées.

Lecteur HTTP ≤4096 octets, entrées strictes (slugs 3–150, curseur UUID, page 1–100),
contrats `shared/schemas/public-catalog*.ts` et DTO associés. Sorties limitées aux
champs UI/publics ; pas de versions d’accords administratifs, ID prestataire,
secret, réponses de participants ou données de commande. Options de formulaire
conservées exactement, sans conversion JSON récursive. Calcul de disponibilité
des ventes payantes repris de la dernière définition SQL, sans règle financière
nouvelle ; historique/paiements Mollie et workers inchangés.

Quota avant parsing/lookup : IP attestée 240/min ou fallback partagé 6000/min ;
après publication vérifiée : ressource/route 240/min, uniquement sur références
DB résolues. Refus 429/Retry-After, panne 503 sans lecture métier. En-têtes IP
falsifiés ne créent pas de nouvelles identités ; l’ingress Cloudflare n’est fiable
que sous la précondition A8 existante. Netlify ne transmet pas d’IP non attestée.
Le fallback reste partagé entre clients : limite de disponibilité documentée,
pas une preuve de quota individuel. Cache-Control no-store pour disponibilité,
publication et termes actuels ; pas de cache qui conserve un événement retiré.

## Pagination, frontend et Netlify

Liste paginée en PostgreSQL par starts_at ASC NULLS LAST, created_at DESC, id DESC.
Curseur = dernier ID ; dates exactes relues dans le scope DB. Le repository assemble
toutes les pages, conserve la forme `{ orgSlug, events }`, refuse doublons/curseur
incohérent et scope de réponse étranger. Aucun filtrage/pagination global JS.
Pas de troncature Data API : réponse SQL JSON paginée, vérifiée sur 205 événements
(7 pages de 37). Ce n’est pas un snapshot MVCC entre requêtes : suppression du
curseur → refus ; modifications du tri concurrentes peuvent déplacer des lignes.

Détail : trois collections SQL bornées à 1001 pour détecter un excès, contrat
maximum 1000 ; dépassement → CATALOG_LIMIT_EXCEEDED, aucune troncature silencieuse.
Le trigger actuel borne les produits à 10 ; le test d’excès simule des données
historiques avec triggers d’insertion contournés dans une transaction annulée,
puis exécute la fonction normalement sous service_role.

Hooks publics conservent chargement/erreurs et ignorent les réponses obsolètes ;
les données d’un ancien slug sont masquées dès le rendu d’un nouveau scope.
Les trois repositories valident la cohérence de la réponse avec leurs slugs.

Netlify lit une seule route share, avec timeout 10 s et contrat partagé. Passage
ESM et bundler esbuild limité à share-event dans netlify.toml pour intégrer le DTO
TypeScript ; bundle ciblant Node 20 construit et exécuté sous Node 24.18.0 contre l’Edge réelle.
Aucune dépendance ajoutée. Échappement HTML, redirection et comportement Facebot
préservés ; 429/503 et Retry-After propagés. Métadonnées utilisent maintenant le
vrai nom/description de l’org : l’ancien code cherchait ces champs au mauvais
niveau du JSON. Le partage ne charge plus toute la liste d’événements.

Changements de visibilité explicites : détail/termes d’organisations inactives
cachés, comme la liste déjà auparavant. Images globales par défaut résolues vers
SUPABASE_URL courant, y compris anciennes valeurs de défaut stockées ; images
personnalisées et données persistantes conservées. Fin du fallback URL de
production fixe. Le contrat historique du détail exige toujours des conditions
de vente d’au moins 200 caractères : profil incomplet refusé au contrat ; pas
de règle commerciale de remplacement fabriquée.

## SQL, fermeture et ordre de publication

Migration additive `20261003115709_public_catalog_edge.sql` : cinq RPC réservées
à service_role. Définitions historiques relues : org (mars), overview/deadline
(25 mars), détail/charte (7 juin), termes/disponibilité (1 octobre). Aucune migration
appliquée modifiée. Fermeture différée B5
`20261003160000_close_public_catalog_browser_access.sql` : tous les overloads des
quatre RPC et des deux helpers de disponibilité (aucun appelant direct hors SQL
trouvé), PUBLIC/anon/authenticated révoqués ; service_role conservé. Les fonctions
SQL d’inscription/paiement les appellent comme propriétaire, donc restent valides.
Tables/colonnes équivalentes révoquées ; aucune vue dépendante trouvée au catalogue
local pour les six tables. RLS conservée ; défauts de grants, GraphQL et inventaire
global restent B6.

Préflights et suites SQL ajoutés aux workflows existants. Pipeline vérifié :
migrations → Edge → préflight → frontend/Netlify. **SQL additive → events Edge →
préflight → frontend ET share Netlify → transition B0 de 24 h → release distincte
promouvant B5**, après adoption des migrations frontend B1/B2 pour les tables
partagées. Confirmer clients externes, onglets/caches et overloads/vues avant
promotion. Ne pas appliquer cette fermeture avant Netlify et le frontend publié.

## Résultats et limites

- 64 migrations rejouées en base jetable B5 ; 12 suites SQL historiques, suites/ACL B0–B5 avec rôles réels et sans RLS, concurrences B3/B4 réussies.
- Catalogue SQL : pages avec dates égales/nulles, curseur étranger, brouillon, org inactive, JSON, champs publics, borne explicite ; fermeture avec grants PUBLIC/colonnes injectés.
- Auth/HTTP/PostgREST/Storage réels factures et HTTP public : cinq familles, sessions anonymes/invalides acceptées seulement sur public, ressources cachées, payloads système rejetés, quotas SQL épuisés, anciens RPC/tables refusés, absence de RLS métier.
- Bundle Netlify réel → Edge réelle → PostgreSQL ; titre/organisation, Facebot et brouillon refusé. Tests unitaires échappement, redirection, quotas, contrat partagé et absence de fallback réussis.
- check:backend, lint:backend (234), test:backend (413), npm test (514 Vitest + 16 Node), build et ESLint ciblé réussis. Avertissement Vite de taille de chunk préexistant.
- Pas de recette visuelle/staging ni de Netlify distant ; ingress IP non attesté ici ; index GitNexus Eventflow absent. Fixtures supprimées, stack habituelle intacte.

**État : implémenté et testé localement ; ancien accès fermé uniquement en base
jetable ; fermeture différée livrée/testée ; non déployé.**
