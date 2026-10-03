# A5 — Reprise des confirmations de commande

Le 2 octobre 2026, sur `dev`, HEAD `4ef53f40c779b7bdbe65f80630a0d37bc7973574`. **Implémenté et testé localement uniquement.** Aucun commit, push, merge, déploiement, paiement live, e-mail client ou mutation distante effectué pour A5. Les modifications préexistantes et celles apparues en parallèle dans le workspace ont été conservées. Ce rapport décrit exclusivement les éditions A5 ; il ne certifie aucun déploiement d'A0–A4.

Le plan A5 et le complément après synchronisation de dev ont été relus. Index GitNexus Eventflow absent dans cette session : traçage par `rg`, sources et tests. Le lecteur de provenance du skill GitNexus Work refuse Windows ; le plan a été lu localement et ses constats revalidés, sans revendication de graphe/PDG.

## Correctif et responsabilités

Les quatre défauts sont confirmés dans les sources initiales : erreurs `{ data, error }` ignorées au marquage, claim sans expiration, absence de reprise après succès du webhook et garde `functionsBase` obsolète. Les RPC du nouveau protocole contrôlent explicitement erreurs et résultats ; `confirmation_email_sent` n'est journalisé qu'après acceptation fournisseur **et** marquage DB réussi. Une erreur de claim ne déclenche aucun envoi et ne libère aucun claim inconnu.

Les appelants actifs sont la commande gratuite, la validation administrative d'un virement, la complétion Stripe par webhook et sa réconciliation. Ils appellent le service local sans `functionsBase`/`edgeServiceToken`. La configuration publique de commande n'exige plus `FUNCTIONS_URL`. Les usages réels de ces paramètres ailleurs, notamment l'authentification du worker, restent en place.

`prepareTicketConfirmation` extrait la préparation existante sans réécrire les templates, le PDF, les QR ni les preuves contractuelles. La préparation ne déclare pas l'e-mail envoyé. Le wrapper historique `sendTicketConfirmation` conserve son comportement. La livraison coordonnée archive dans une table **private** l'enveloppe exacte, avec expéditeur, destinataire, sujet, HTML, tags et octets du PDF avant toute requête fournisseur. Les reprises lisent cette enveloppe ; une modification ultérieure de l'événement ou une régénération du PDF ne change pas la requête.

La migration additive `20261002124005_recover_order_confirmation_delivery.sql` introduit uniquement la coordination de livraison. Les RPC sont réservées à `service_role`, avec `search_path` fixé. La table privée a RLS activée sans nouvelle policy métier ni grant navigateur. L'enveloppe contient des données sensibles et ne doit être exportée ni journalisée ; seuls des codes sûrs et identifiants de commande figurent dans les nouveaux logs.

Les virements et factures existants ont été examinés (`20260929141000_retry_payment_delivery.sql`, services order-confirmation/Billit et worker manual-invoice-delivery). A5 reprend leurs responsabilités utiles : état privé séparé, jeton de claim, service e-mail partagé, cron authentifié et mise en revue d'un résultat fournisseur ambigu. Aucun framework de queue, broker ou refactoring transversal ajouté. Les garanties spécifiques à Resend ne sont pas imposées à Billit.

## Garanties de reprise

- Un trigger inscrit durablement les commandes nouvellement confirmées dans la transaction métier, avant l'appel e-mail. Une erreur ou interruption avant le premier claim laisse donc une livraison à reprendre.
- Éligibilité serveur : commande `paid` ou `partially_paid`, `confirmed_at` présent, destinataire non vide, confirmation non marquée envoyée et billets présents pour toutes les quantités des lignes de commande. Le worker ne crée jamais les billets manquants.
- Acquisition atomique sous verrou de commande puis de livraison. Bail de **5 minutes**, UUID renouvelé à chaque tentative. Préparation, succès et échec exigent ce jeton et un bail encore valide. Un ancien worker ne peut ni marquer ni libérer le claim repris.
- La sélection est bornée : **25** commandes par cron (plafond SQL de 100 même si un autre appel fournit une limite supérieure). La sélection seule ne réserve rien ; l'acquisition revalide sous verrou, donc deux workers sélectionnant la même ligne ne peuvent posséder simultanément son claim.
- Délai après échec : 5, 10, 20, 40 minutes, puis 60 minutes maximum. **Huit tentatives** au total, y compris les claims abandonnés. Après le plafond : `review_required`, code `CONFIRMATION_ATTEMPTS_EXHAUSTED`, exclusion des sélections suivantes. Un dernier claim abandonné est classé lors du passage suivant après expiration.
- Le cron existant `/workers/reminders` reprend exclusivement les livraisons manquantes. Ses modes manuels et son authentification Bearer/legacy autorisé restent inchangés. La réponse cron expose `confirmations: { sent, failed, skipped }`. Les erreurs sont visibles via les logs et `orders.confirmation_email_error`, déjà utilisé par les vues de diagnostic plateforme.
- Une erreur fournisseur ou DB ne transforme pas un paiement validé en échec. Les reprises de livraison n'appellent aucune RPC de paiement, stock ou émission de billets. Un webhook peut terminer à 200 après un échec e-mail : la livraison durable reste indépendante de la complétion du reçu webhook.

## Acceptation fournisseur puis erreur DB

Clé stable : `order-confirmation:<order UUID>`, indépendante du jeton de tentative. Le gateway Resend existant transmet déjà `Idempotency-Key` à `POST /emails`. La [documentation officielle Resend](https://resend.com/docs/dashboard/emails/idempotency-keys), vérifiée pendant cette tâche, annonce une rétention de **24 heures**, un replay de la même requête avec la même réponse et un refus si la clé est réutilisée avec un contenu différent.

La première autorisation de dispatch fixe `first_dispatch_at`, avant la requête. Toute reprise automatique cesse au bout de **23 heures** depuis cette date, avec `CONFIRMATION_IDEMPOTENCY_WINDOW_EXPIRED` et revue requise. Le code refuse de débuter l'envoi dans les 30 dernières secondes de cette fenêtre ; le gateway conserve son timeout de 10 secondes. Le premier horodatage est conservé même après une erreur réseau ou une interruption.

Si le fournisseur accepte puis que le marquage échoue, le code ne journalise aucun succès. Il essaie d'enregistrer `CONFIRMATION_ACCEPTED_MARK_FAILED` avec backoff. Si cette seconde écriture échoue aussi, le claim durable expire. La prochaine tentative reprend la même enveloppe et la même clé dans la fenêtre autorisée. Hors fenêtre, aucune retransmission automatique ; il faut réconcilier le résultat fournisseur.

**Aucune garantie exactly-once de bout en bout.** `sent` signifie accepté par le fournisseur/capturé et enregistré en DB, pas reçu en boîte. Les rebonds et problèmes de réception ne sont pas traités par A5. La déduplication dépend de Resend, de la même identité de compte fournisseur et de sa fenêtre de rétention. Conserver le même compte Resend pendant les reprises ; une rotation de clé dans le même compte est distincte d'un changement de compte. Un worker suspendu arbitrairement entre contrôle final et requête ne peut être annulé par PostgreSQL ; les contrôles de temps et le timeout limitent ce risque sans prouver une livraison exactement une fois.

La capture locale/staging crée un nouvel objet par tentative et ne déduplique pas sur la clé : plusieurs captures sont possibles après un échec de marquage, sans aucun e-mail réel. Les tests du contrat Resend utilisent un fournisseur simulé qui vérifie la clé et les octets du corps ; ils ne constituent pas une recette réelle Resend.

## Claims historiques et compatibilité de publication

La migration inventorie les claims préexistants non marqués envoyés en `legacy_unknown`, visibles sous `LEGACY_CONFIRMATION_OUTCOME_UNKNOWN`. Aucun timestamp global remis à zéro, aucune commande historique simplement non envoyée ajoutée en masse. Une telle commande peut entrer par un appel direct légitime ultérieur ; le cron ne scanne que les livraisons explicitement inscrites.

Les anciennes signatures SQL sont conservées. Un ancien backend peut encore acquérir une commande non revendiquée ; cette acquisition est isolée en `legacy_unknown`. Il peut marquer son propre résultat connu, mais ses anciens marqueurs ne touchent jamais `sending`, `failed`, `review_required` ou `sent` du nouveau protocole. Le verrou initial de migration, la reconnaissance d'un timestamp legacy sur une ligne pending et la reconstruction contrôlée d'une ligne absente couvrent aussi un ancien appel déjà engagé avant l'installation du schéma. Un échec de cet ancien circuit reste en revue, sans renvoi implicite.

Transition opérationnelle ciblée, à réaliser uniquement lors d'une intervention ultérieure autorisée : inventorier `legacy_unknown`/`review_required` par UUID et code, vérifier le résultat dans **le même compte fournisseur**, consigner la preuve. Si accepté, réconcilier l'état de livraison et le marqueur public dans une transaction verrouillant cette seule commande, sans envoi. Si l'absence de toute acceptation est démontrée, une reprise de cette commande peut être explicitement autorisée et son état réarmé de façon ciblée. Si le résultat reste inconnu, conserver la revue requise. Aucun endpoint de remise à zéro ou de renvoi en masse n'est ajouté ; le compteur ne se réinitialise jamais automatiquement.

Ordre de publication nécessaire, **non réalisé** : appliquer la nouvelle migration avant le backend ; puis publier ensemble les appelants orders/Stripe, le service local et workers. Ne pas publier le nouveau backend avant ses RPC : le claim échouerait et la capture durable par trigger ne serait pas encore installée. Pendant l'intervalle schéma nouveau/backend ancien, le bridge garde le protocole legacy isolé ; les erreurs de cet intervalle nécessitent revue. Ne pas supprimer les signatures legacy avant retrait de tous les anciens workers. Vérifier ultérieurement la cible et le fonctionnement réel du cron sans supposer A1 ou A5 déjà déployés.

## Validation locale

| Contrôle | Résultat |
| --- | --- |
| Rejeu complet dans une base Supabase jetable PostgreSQL 17.6 | **55 migrations réussies** |
| Suites `tests/database/*.sql` du workspace au contrôle final | **11 suites réussies** |
| `order-confirmation-delivery.sql` | Nominal, éligibilité/billets manquants, backoff, baux/crash, fencing, payload immuable, acceptation ambiguë, plafond, fenêtre, legacy, ACL réelles anon/authenticated |
| `node tests/database/order-confirmation-concurrency.checks.mjs supabase_db_eventflow-security-a5-20261002` | **Réussi**, deux vrais processus/connexions, transaction chevauchante, un seul claim, reprise et ancien worker refusé |
| Fixtures installées avant migration, puis application de celle-ci | Claim ancien isolé, historique non réclamé non inscrit, aucune sélection massive |
| Nouveaux tests Deno `confirmations-retry-test.ts` | **18 réussis**, mocks stricts/capture simulée sans permission réseau |
| `npm run check:backend` | **Réussi** |
| `npm run lint:backend` | **Réussi**, 188 fichiers |
| `npm run test:backend` | **210 réussis**, 0 échec dans le workspace combiné |
| ESLint ciblé du script de concurrence | **Réussi** |
| `git diff --check` | **Réussi**, avertissements LF/CRLF Git uniquement |

Les tests e-mail couvrent absence de FUNCTIONS_URL, erreurs au claim/dispatch/marquage, échec d'enregistrement d'erreur, refus d'envoi après expiration, replay Resend identique après acceptation, conservation effective du PDF généré et des textes contractuels archivés, confirmation déjà envoyée, plafond visible, worker non authentifié et webhook signé répété après échec e-mail. Les suites SQL Stripe existantes couvrent aussi l'idempotence réelle de paiement/billets/stock ; les tests A5 vérifient que la livraison ne modifie pas ces données.

La base était isolée (`eventflow-security-a5-20261002`, port 56322), sans seed client ni fichier `.local`, avec rollback/nettoyage des fixtures. Son conteneur et ses volumes ont été supprimés après validation ; les onze conteneurs de la stack Eventflow préexistante restent actifs. L'assertion de `sensitive-rpc-acl.sql` concernant l'erreur legacy a été ajustée au code sûr ; ses assertions de refus/grants n'ont pas été affaiblies. Aucune migration historique modifiée. Aucun contrôle frontend global relancé pour A5 : ses fichiers/contrats UI ne sont pas modifiés par ce lot. Les avertissements `punycode` préexistants ne bloquent pas les suites.

Revue indépendante technique/sécurité : **PASS après correction de la course legacy**, puis contrôle final des changements concernés. Aucun état de production ni réception client confirmé.

## Points hors périmètre

- La reprise des virements existante n'a pas les mêmes bornes ni les mêmes garanties de fenêtre idempotente ; A5 ne la réécrit pas. Billit conserve sa procédure de réconciliation propre.
- Des commandes confirmées auxquelles il manque des billets restent hors sélection e-mail. Réparer leur émission relève du parcours de fulfillment existant, pas du worker de livraison.
- Les loaders de contenu existants tolèrent certaines erreurs de lecture de métadonnées facultatives. A5 conserve leur comportement ; une revue de complétude du contenu peut être menée séparément.
- La rétention/volumétrie des enveloppes privées, incluant les PDF, reste à intégrer à la politique existante de conservation. Aucun nouveau mécanisme de purge métier introduit dans ce lot.
