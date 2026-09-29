# API par domaine — migration directe sur dev

Cette tranche réorganise le transport et les contrats sans modifier volontairement les règles de commande, de paiement ou d'abonnement. Elle est destinée à `dev` et au staging. Sa présence dans le dépôt ne prouve ni un déploiement ni une recette métier réussie. La promotion sur `main` reste une étape distincte.

## Contrats et dépendances

`shared/schemas/` à la racine contient les contrats Zod utilisés aux frontières frontend/API. Le frontend les importe via `@contracts` ou des réexports locaux ; Deno les importe par chemin relatif. Le nom nu `zod` est résolu par npm côté frontend et par l'import map Deno côté Edge Functions. Les contrats ne dépendent ni de React ni du client Supabase.

| Contrat | Responsabilité |
| --- | --- |
| `orders-public.ts` | Création publique, acheteur, produits, participants et réponse checkout |
| `orders-admin.ts` | Création administrative et encaissement hors ligne |
| `orders-read.ts` | Identifiant, booking token et consultation publique |
| `subscriptions.ts`, `subscriptions-cancel.ts` | Création/changement et résiliation d'abonnement |
| `invoices.ts` | Demande de lien PDF et réponse |
| `accounts.ts` | Suppression du compte |
| `workers.ts` | Déclenchement des rappels |
| `mollie-connect.ts` | Démarrage de la connexion Mollie |

Les schémas SQL internes et les formats des prestataires restent près de leurs services lorsqu'ils ne constituent pas un contrat frontend/API. Les RPC frontend non concernées par cette tranche ne sont pas annoncées comme migrées.

Les variantes de réponses métier restent compatibles avec leurs consommateurs. Les changements de protocole et la correction d'autorisation de suppression de compte sont détaillés dans [ARCHITECTURE](ARCHITECTURE.md). Cette migration n'impose pas une nouvelle enveloppe unique à tous les endpoints : les réponses de webhook d'acquittement/retry, en particulier, déterminent les tentatives du prestataire.

`supabase/functions/import_map.json` est la source des dépendances Deno. Le fichier `deno.json` la référence pour les contrôles locaux et chaque fonction la référence explicitement dans `supabase/config.toml` pour le déploiement. Cela permet de résoudre `zod` depuis les contrats à la racine : la découverte implicite de la configuration sous `functions` ne suffit pas au bundler distant.

## Routes

Les chemins ci-dessous sont relatifs à `/functions/v1` du projet Supabase de l'environnement.

| Méthode et route | Consommateur et protection | Ancienne route retirée du code |
| --- | --- | --- |
| `POST /orders` | Billetterie publique ; Turnstile et validations existantes | `register-tickets` |
| `POST /orders/admin` | Utilisateur authentifié et droits sur l'événement/organisation | `admin-register` |
| `GET /orders/:orderId?token=…` | Booking token correspondant à la commande ; aucun token dans les logs | `order-public` |
| `POST /subscriptions` | Session valide, rôle owner/admin de l'organisation | `start-subscription` |
| `DELETE /subscriptions/:orgId` | Session valide, rôle owner/admin de l'organisation | `cancel-suscription` |
| `POST /subscriptions/webhooks/first-payment` | Notification Mollie ; paiement relu auprès de Mollie | `payment-first` |
| `POST /subscriptions/webhooks/recurring-payment` | Notification Mollie ; paiement/abonnement relu et mapping SQL | `mollie-subscription-webhook` |
| `GET /invoices/:invoiceId/pdf` | Session et appartenance à l'organisation de la facture | `get-invoice-pdf-url` |
| `DELETE /accounts/me` | Session et vérifications existantes de propriété du compte/organisation | `delete-account` |
| `POST /workers/reminders` | Authentification interne ; mode cron ou manuel | `send-reminder-mail` |
| `POST /workers/expire-orders` | Secret cron vérifié ; exécution de la RPC existante | `expire-orders` |
| `POST /workers/migrate-subscription-webhooks` | Token interne, projet staging exact, clé Mollie test ; maintenance explicite | Nouvelle opération de maintenance |

La création utilise `POST`. La résiliation utilise `DELETE`. Le corps de création conserve ses champs et règles ; le frontend n'envoie plus un corps `{ orgId }` pour résilier, l'identifiant étant dans le chemin.

Les points d'entrée prestataires `mollie-connect-start`, `mollie-connect-callback`, `mollie-webhook` et `mollie-webhook-tickets` conservent leurs noms. Ils servent à l'autorisation OAuth et aux notifications de paiements de billets. Les deux webhooks de billets ne sont pas supposés interchangeables.

`createEdgeHandler` gère les préoccupations HTTP communes. Une option `auth: "none"` sur un routeur ou un webhook ne signifie pas qu'une opération administrative est publique : les opérations d'abonnement conservent leurs contrôles explicites de session et de rôle avant toute mutation. Les workers vérifient leurs propres secrets. La vérification JWT de la plateforme ne remplace pas ces contrôles.

## Services internes et cycle de vie

Les confirmations, rappels, PDF et l'envoi Billit sont des services sous `supabase/functions/_shared/services/`. Ils reçoivent un client serveur et les identifiants nécessaires. Leur code n'est plus exposé comme une Edge Function indépendante.

- Une commande appelle le service de confirmation approprié après son traitement métier.
- Le worker reste le point d'entrée du cron ; le service de rappel porte la sélection et l'envoi.
- Un webhook d'abonnement vérifie le prestataire, applique l'état/facturation puis déclenche PDF et Billit.
- Le téléchargement utilise une URL signée du bucket privé, après autorisation, avec la durée existante de 120 secondes.
- `runInBackground` enregistre le travail asynchrone via `EdgeRuntime.waitUntil`. En Deno local, il attend la tâche. Une simple promesse abandonnée après la réponse ne suffit pas à maintenir une génération PDF en vie.

PDF et Billit restent des effets distincts ; leurs erreurs ne transforment pas automatiquement un paiement réussi en paiement échoué. Le service Billit conserve son traitement du PDF manquant. Ce mécanisme n'est pas une file de travail persistante : une stratégie durable de reprise après interruption du runtime constitue une amélioration séparée.

Les garde-fous staging sont conservés : clé Mollie de test pour les abonnements, mode test OAuth pour les billets, capture des e-mails et refus de Billit réel. Les e-mails Supabase Auth ne passent pas par ces services.

## Limites et invariants

Les limites déjà présentes sont reprises dans les contrats : 50 lignes de produits, quantité 1–100, 500 participants, 200 réponses par participant, texte de réponse limité à 10 000 caractères, nom 120 caractères, e-mail 254 caractères et code promotionnel abonnement 100 caractères. Les schémas sont la référence exacte, notamment pour les champs optionnels et les contraintes croisées.

La lecture HTTP bornée ajoute une limite globale en octets avant le parsing JSON : **2 Mio pour la création de commande**, **64 Kio par défaut** pour les petits corps d'abonnement/compte et les notifications d'abonnement. Le flux est compté même sans `Content-Length`. Un dépassement produit `413 PAYLOAD_TOO_LARGE`. C'est une restriction explicite des entrées extrêmes, à distinguer de la conservation des parcours habituels. Elle ne remplace pas les limites par champ ni les contrôles SQL.

Les montants, codes promotionnels, mandats, règles de changement de plan et réponses de retry ne sont pas redéfinis. Par exemple, une résiliation vérifie l'abonnement chez Mollie, le résilie, puis remet l'organisation en free et retire la ligne d'abonnement. Si le mapping Mollie est invalide, ces mutations SQL ne doivent pas avoir lieu.

Les contrôles d'idempotence existants restent en place. Une facture déjà créée pour un paiement récurrent doit être réutilisée. Les tests de répétition séquentielle ne prouvent pas l'absence de courses concurrentes ; celles-ci restent un sujet de revue métier/SQL.

## Bascule staging sans routes de compatibilité

Aucun adaptateur vers les anciens chemins n'est conservé dans le nouveau code. Cela impose une bascule coordonnée : un ancien bundle frontend ne peut pas continuer à appeler des routes supprimées. Le déploiement backend puis frontend ne constitue pas une transaction atomique.

Avant suppression distante des anciennes fonctions, inventorier leurs consommateurs : frontend publié et caches, crons, appels internes, scripts d'exploitation et URLs déjà enregistrées chez Mollie. Supprimer un dossier local ne supprime pas automatiquement une Edge Function distante.

Les nouveaux paiements et abonnements créés par `subscriptions` utilisent les nouveaux webhooks. Les paiements déjà ouverts et les abonnements existants peuvent toujours référencer `payment-first` ou `mollie-subscription-webhook`. Il faut attendre la fin des paiements concernés et mettre à jour la configuration des abonnements de test, ou les recréer dans le staging. Ne pas supprimer une ancienne cible tant qu'un callback attendu la référence. Ne pas appliquer cette opération à la production dans cette tranche.

La recette staging doit reprendre : commande gratuite, commande payante en test, commande administrative, consultation avec token valide/invalide, abonnement premier paiement et mandat existant, résiliation, répétition de webhook, mail capturé, PDF, rappel cron et isolation entre deux organisations.

### Maintenance des callbacks d'abonnement staging

Le worker `POST /workers/migrate-subscription-webhooks` permet de réconcilier les callbacks sans sortir la clé Mollie de l'environnement Edge. Il requiert un Bearer égal à `EDGE_SERVICE_TOKEN`, `APP_ENV=staging`, le projet `cpcmcxerrsnnjncrhldr` et une clé `MOLLIE_API_KEY` commençant par `test_`. Le projet de production est refusé, même si la variable d'environnement est incorrectement étiquetée staging. Ce worker ne doit pas être ajouté à un cron.

1. Envoyer `{}` pour un inventaire **sans mutation**. La réponse énumère les identifiants candidats et les anciennes/nouvelles URLs, sans clé ni donnée acheteur.
2. Vérifier les candidats, puis envoyer `{ "apply": true }` pour appliquer. Le worker refait l'inventaire, relit chaque ressource avant mutation et n'envoie que `{ "webhookUrl": "…" }` à Mollie.
3. Relancer l'inventaire : aucun candidat ne doit rester. Une réponse d'erreur peut contenir `attempted` et `applied` si Mollie a accepté une partie des opérations ; les PATCH ne constituent pas une transaction. Réinventorier avant toute reprise.

Le périmètre vient des lignes `subscriptions` possédant un client Mollie. Les abonnements actifs/pending/suspended et les paiements open/pending/authorized doivent avoir une metadata d'organisation cohérente et un type d'abonnement attendu. Seules les URLs **exactes**, sur ce backend staging, terminant par `/payment-first` ou `/mollie-subscription-webhook` sont remplacées. Les autres URLs, montants, dates, mandats, plans et statuts sont conservés. Les paiements terminés ne sont pas modifiés : les éventuels retries historiques nécessitent une vérification avant suppression de leurs anciennes cibles.

La pagination des paiements reste limitée à l'API Mollie et au client courant ; aucune redirection HTTP n'est suivie avec la clé. L'inventaire échoue explicitement au-delà de 500 mappings ou de 20 pages par client, avant les PATCH. Un compte Mollie absent/inaccessible doit être diagnostiqué, pas ignoré silencieusement. Un futur remplacement du projet staging demande de modifier explicitement la cible autorisée et ses tests.

La modification de `webhookUrl` est documentée pour [les paiements](https://docs.mollie.com/reference/update-payment) et [les abonnements](https://docs.mollie.com/reference/update-subscription). Mettre à jour un paiement ne déclenche pas à lui seul une notification ; cette maintenance ne remplace pas le traitement métier d'un paiement.

## Retour arrière

| Situation | Action dans le staging |
| --- | --- |
| Échec des checks avant publication | Corriger ou revenir au commit précédent ; aucun changement distant à effectuer |
| Backend publié, frontend encore ancien | Terminer la bascule coordonnée ou republier ensemble backend et frontend du commit précédent |
| Régression après bascule | Republier un couple frontend/backend cohérent ; inventorier les nouvelles URLs de callbacks avant de retirer les nouvelles routes |
| Nouveaux abonnements/paiements de test créés | Terminer/annuler les fixtures autorisées et réconcilier leurs callbacks ; un revert Git ne modifie pas Mollie |
| Changement de cron/configuration distante | Restaurer les cibles staging documentées avec le code correspondant ; ne pas réinitialiser la base |

Aucun rollback ne doit utiliser un reset de base distant ou supprimer des données clients. La migration n'autorise ni fusion sur `main`, ni modification des secrets ou callbacks production.

## Preuves locales et limites

Les tests de domaine couvrent les contrats, les sessions manquantes, le refus d'une autre organisation, la réutilisation d'un abonnement actif, les erreurs de mapping Mollie, l'ordre de résiliation, les notifications à ignorer/réessayer et la réutilisation d'une facture. Des tests spécifiques vérifient la limite en octets et l'enregistrement des tâches internes auprès du runtime.

Ces tests utilisent des fixtures et des réponses prestataires simulées. Ils ne prouvent pas l'acceptation des secrets par Mollie, la livraison d'e-mails, le fonctionnement réel du cron, ni une recette navigateur. Les résultats exacts des checks globaux et du déploiement doivent être consignés séparément après leur exécution.
