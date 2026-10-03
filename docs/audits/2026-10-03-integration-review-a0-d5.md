# Revue d'intégration A0–D5 — 3 octobre 2026

## Périmètre et provenance

Revue du diff local complet, fichiers nouveaux compris, après intégration de
`origin/dev` : `4ef53f4` → `879b0603cd57b525ce227cc56f547322439b2c3a`.
Les deux commits distants concernent thème et notifications organisateur.
Le conflit `AdminLayout.tsx` conserve ces apports et la clé de session de l'Outlet.
Le stash `review-before-dev-sync-2026-10-03` reste disponible ; tous ses fichiers
initialement non suivis ont été retrouvés après application.

Revue répartie entre backend, SQL et frontend/contrats, avec intégration et pipeline
relus par l'agent principal. Index GitNexus de ce dépôt absent : preuves issues des
sources, diff, appels et tests ; aucun graphe d'un autre dépôt utilisé.
Publication demandée sur dev/staging seulement. Aucun changement de main.

## Constats et corrections

| Sévérité | Constat vérifié | Correction |
| --- | --- | --- |
| P1 | Un owner/admin pouvait envoyer `status: active` dans `organizations/update` et annuler une suspension plateforme. L'ancien RPC conservait la même permission pendant la transition. | Champ refusé par le contrat strict ; trigger SQL protège le statut contre les JWT navigateur, y compris à travers le RPC SECURITY DEFINER. La plateforme/service conserve son droit. |
| P1 | Le pipeline appliquait D5 avant la nouvelle Edge. Un ancien handler pouvait envoyer un e-mail puis échouer à enregistrer la livraison lorsque l'ancien writer était neutralisé. | Publication temporaire d'une Edge qui refuse uniquement les envois de campagne, vérification de révision et drainage de 420 s avant SQL ; publication normale après migrations. Échec intermédiaire : campagnes restent en pause. Aucun assouplissement des tokens de bail. |
| P2 | UUID majuscules/minuscules désignaient la même organisation en SQL mais des clés de quota différentes. | Canonicalisation des UUID dans les clés issues d'entrées utilisateur, sans altérer les tokens opaques. Test de compteur commun et refus 429 avant mutation. |
| P2 | Chaque refetch du dashboard effaçait son bootstrap et démontait l'Outlet : la création/duplication d'événement perdait sa continuation avant navigation. | Données conservées pendant le rafraîchissement de la même organisation ; ancienne organisation masquée dès résolution d'une autre identité ; nouvelles sessions toujours isolées. Test avec le vrai store parent. |

La revue du wrapper de maintenance a également trouvé un contournement par doubles
slashes ; son découpage reproduit maintenant exactement celui du handler. Les tests
couvrent ces variantes et la restauration des sources après échec du déploiement.
Deux erreurs de lint apportées par le nouveau contrat de facturation ont été retirées
sans modifier la regex acceptée.

## Décision métier complémentaire : suspension

La suspension masquait le catalogue sans bloquer la création depuis un eventId déjà
connu. L'utilisateur a confirmé pendant cette revue qu'elle doit interdire les
nouvelles commandes. La correction couvre les créations publiques et administratives,
ainsi que la voie SQL historique pendant la transition. Les commandes existantes et
leurs paiements/émissions ne sont pas annulés par ce nouveau contrôle.
L'Edge refuse avec `403 ORGANIZATION_SUSPENDED` avant les effets externes ; SQL
prend un verrou partagé sur l'organisation avant les verrous produits/événement.
L'implémentation historique reste inchangée dans une fonction privée derrière le
wrapper public de même signature, et un trigger couvre aussi les insertions directes.
Deux courses réelles vérifient que création puis suspension, ou suspension puis
création, se sérialisent sans commande/stock résiduels en cas de refus.

## Validations

69 migrations et 14 suites SQL réussies après le correctif suspension. Le premier
rejeu à 68 migrations avait également validé 18 recettes Node, dont frontières
B0–B6, vrais rôles, D3/D5 et concurrences. Les courses suspension/création ont été
validées dans les deux directions ; paiement/remboursement existants conservés.
Base jetable uniquement ; stack Eventflow existante préservée.
Quinze recettes ont été revalidées après ajout de la garde. Un effet de bord sur
la suppression d'événement en concurrence a été corrigé : le verrou organisation
refuse immédiatement avec `RESOURCE_BUSY`, comme les verrous enfants existants,
au lieu d'attendre puis supprimer la commande fraîchement créée. Après cette
correction : nouveau rejeu des 69 migrations (empreintes identiques au dépôt),
14 suites SQL, opérations organisateur et concurrences suspension/événements/checkout
réussis. Stack jetable supprimée ; 11 conteneurs de la stack habituelle préservés.

- Frontend : 526 tests Vitest et 22 tests Node de déploiement réussis.
- Backend : 412 tests Deno réussis, contrôle de nouvelles commandes inclus.
- Typecheck backend, lint backend (225 fichiers) et build frontend réussis.
- ESLint ciblé réussi. Le lint global présente une dette de 35 erreurs et 2 avertissements
  dans 12 fichiers inchangés par rapport à `879b060` ; ces fichiers ont été vérifiés
  hors diff. Aucun succès global ESLint revendiqué.
- Contrôle de motifs de secrets sur les fichiers à publier : aucune occurrence des
  motifs de clés Stripe, GitHub ou clés privées testés ; ce scan n'est pas une garantie exhaustive.

## Publication et limites

Les migrations de `supabase/deferred-migrations/` restent hors de `db push`.
La cible ne devient donc pas entièrement Edge-only lors de ce push : accès navigateur
résiduels et RLS restent soumis à la publication séparée B0–B6, adoption du nouveau
frontend, inventaire des consommateurs et droits sur les objets gérés.

La procédure D5 est décrite dans [déploiements](../deploiements.md#transition-des-campagnes-plateforme-d5).
La durée de drainage s'appuie sur la [limite hébergée Supabase](https://supabase.com/docs/guides/functions/limits).
La pause concerne les campagnes plateforme ; les autres routes restent servies.

Pas de test de paiement live, d'envoi client ni de recette visuelle navigateur.
La revue et les tests n'attestent pas l'absence absolue de faille ni la configuration
de production. L'IP d'ingress et les consommateurs externes restent à attester selon B6.
Ce document décrit la revue avant publication ; le résultat du workflow GitHub
du commit publié fait foi pour le déploiement effectif.

**Verdict : PASS pour la publication dev/staging du périmètre actif**, corrections
ci-dessus incluses. Ce verdict n'autorise ni la promotion des fermetures différées
ni une fusion main ; aucune recette hébergée n'est revendiquée avant son workflow.
