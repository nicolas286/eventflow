# B4 — Billets, check-in et QR

Travail local sur `dev`, HEAD `4ef53f40c779b7bdbe65f80630a0d37bc7973574`.
Changements préexistants A0–B3 préservés ; aucun commit, push, fusion,
déploiement ou mutation distante. B5/B6 hors périmètre. Index GitNexus Eventflow
absent : traçage ciblé par sources, migrations et tests.

## Opérations et consommateurs

Les trois consommateurs navigateur réels étaient `makeEventTicketsRepo.ts`,
`markTicketChekedInRepo.ts` et `markTicketCheckedInByQrRepo.ts`. Ils invoquent
désormais exclusivement les routes explicites d’`orders`. Le scanner utilise le
dernier via son hook. Aucun autre consommateur serveur/Netlify/externe trouvé
dans le dépôt ; les clients externes au dépôt restent à confirmer avant fermeture.
Les anciennes définitions viennent de `20260324133258_remote_schema.sql`, avec
privilèges ultérieurement ajustés en septembre ; aucune définition appliquée modifiée.

| Route POST `orders/admin/…` | Autorisation et portée | SQL serveur | Ancien accès |
| --- | --- | --- | --- |
| `tickets-list` | Auth.getUser ; membership owner/admin ; cohérence event/org ; commandes, items et produits associés | `organizer_get_event_tickets_admin` : COUNT/page SQL, tri created_at DESC puis id DESC | `get_event_tickets_admin` : fermeture différée |
| `ticket-check-in` | Même autorisation ; SQL résout billet → commande/item/produit → événement/org ; acteur vérifié fourni exclusivement par l’Edge | `organizer_check_in_ticket` : verrou billet FOR UPDATE, garde statut, UPDATE atomique | `mark_ticket_checked_in` et helper interne : fermeture différée |
| `ticket-check-in-qr` | Même autorisation ; QR limité à l’événement autorisé, puis même chaîne SQL | `organizer_check_in_ticket_by_qr` appelle la même transaction/verrou | `mark_ticket_checked_in_by_qr` : fermeture différée |

Client privilégié existant indépendant du JWT utilisateur, lecteur HTTP ≤4096
octets, schémas stricts dans `shared/schemas/ticket-check-in.ts`, DTO partagé avec
B3, quotas user/org existants (lecture 240/min, écriture 120/min). Aucun acteur,
statut ou champ système fourni par le navigateur n’est accepté. Limites 1–1000,
offset 0–10 000 000 ; QR ≤2048 caractères. Aucune pagination/filtration globale
JavaScript ajoutée. Les filtres UI « utilisés/non utilisés » restent ceux de la
page affichée, comme avant ; recherche B3 inchangée.

Fichiers principaux : `orders/admin/management.ts`, dispatcher `orders/index.ts`,
migration additive `20261003111702_tickets_check_in_edge.sql`, trois repositories,
hooks de lecture/mutation et `SingleEventTicketsSubSection.tsx`. Les lectures
réutilisent le store B3 avec génération/session ; les mutations le store de
mutation existant. Changement de session/événement : réponse périmée ignorée,
scanner remonté pour invalider son feedback/caméra ; changement org/événement :
section remontée. Pas de fallback RPC. Le refus d’un billet annulé est aussi
représenté par le bouton désactivé. Les erreurs courantes restent affichées.

## Transaction et point métier à relire

Le premier scan verrouille puis met à jour uniquement `tickets.status`,
`checked_in_at`, `checked_in_by`. Le second attend le verrou et retourne
`already_checked`, sans réécrire heure/acteur. Aucun trigger de billet versionné
ajoutant un effet externe n’a été trouvé ; stock, paiements, commande et participants
restent inchangés. Le QR conserve la normalisation historique des espaces.
Un QR d’un autre événement retourne maintenant `TICKET_NOT_FOUND`, sans recherche
globale ni révélation de l’événement étranger ; par ID, `EVENT_MISMATCH` est refusé.
Le départage des timestamps égaux rend la pagination déterministe, sans garantir
un snapshot entre requêtes si des billets sont ajoutés/supprimés entre pages.

**Dette existante, règle non confirmée :** le SQL historique refuse `invalid` et
`cancelled`, mais accepte `refunded` et `blocked` et ne consulte pas le statut
financier de la commande. Le CHECK actuel n’autorise d’ailleurs pas `invalid`.
B4 conserve explicitement ces règles ; les tests matérialisent l’acceptation de
`refunded`/`blocked`. Ce lot ne prouve donc pas un refus des billets remboursés.
Faire décider cette règle avant publication ; aucun comportement financier
n’a été inventé. Une ancienne ligne scannée sans acteur valide échoue toujours
au contrat, comme auparavant : aucun acteur de remplacement fabriqué.

## Fermeture et publication

`supabase/deferred-migrations/b4/20261003140000_close_ticket_check_in_browser_access.sql`
révoque tous les overloads des trois anciennes RPC et du helper pour PUBLIC,
anon, authenticated ; service_role conservé. Révocation tickets/table/colonnes,
en complément de B3 ; aucune vue dépendante équivalente trouvée au catalogue local.
Les trois nouvelles fonctions sont déjà réservées à service_role dans la migration
active. RLS conservée. Refus réels vérifiés même sans RLS, avec grants PUBLIC et
colonnes volontairement injectés avant fermeture.

Pipeline vérifié : migrations → Edge → préflight → frontend. Les préflights
incluent les trois nouvelles routes ; les suites SQL/concurrence B4 sont ajoutées
aux deux workflows. Ordre de publication : **SQL additive → Edge orders →
préflight → frontend/scanner → transition B0 de 24 h avec échéance → release
distincte promouvant les fermetures B3/B4**. Confirmer clients externes, vieux
onglets/caches et absence de nouveaux overloads/vues avant promotion. Une
révocation active dans la release initiale casserait le scanner encore publié.
Aucune fermeture distante ni suppression de RLS effectuée.

## Résultats et limites

- 63 migrations rejouées dans la seule stack jetable `eventflow-security-b4-20261003` ; 12 suites SQL historiques réussies en phase additive.
- Suites B1/B2, ACL réelles B1/B2 et deux suites B3 réussies ; tests B4 de pagination, scopes, annulé/remboursé/bloqué, répétition et acteur réussis. Échec SQL injecté : mise à jour annulée ; aucun effet stock/finances/participants.
- Deux connexions PostgreSQL réellement concurrentes : attente `Lock` observée, scan ID puis QR, un `validated`, un `already_checked`. Répétition par un autre admin vérifiée en HTTP : acteur et heure du premier conservés.
- Recette Auth/HTTP/PostgREST réelle sans RLS : trois familles, sessions invalides, tenants/scopes incohérents, QR forgé/étranger, contrats, bornes, ancien accès refusé, quota sans effet métier. Fixtures synthétiques uniquement, supprimées ; stack habituelle intacte.
- `check:backend`, `lint:backend` (228 fichiers), `test:backend` (408), `npm test` (505 Vitest + 16 Node), build et ESLint ciblé réussis. Avertissement Vite de taille de chunk préexistant.
- Recette visuelle/caméra physique et staging non effectuées ; règles financières non confirmées ; fonctionnement des clients externes hors dépôt non attesté.

**Revue : validation technique locale réussie ; publication en attente** de la
relecture métier des statuts remboursé/bloqué et de la transition/révocation.
Accès directs fermés dans la base jetable uniquement ; fermeture différée livrée
et testée ; rien déployé.
