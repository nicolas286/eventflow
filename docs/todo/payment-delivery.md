# Reprise des livraisons de paiement

Les instructions de virement utilisent `private.bank_transfer_email_deliveries` :
une tentative réserve un bail de cinq minutes ; seul un envoi terminé passe à
`sent`. Un échec devient `failed`, éligible au prochain passage du worker de
rappels après cinq minutes. Le worker `/workers/reminders` existant reprend au
maximum 25 commandes encore en attente de paiement par passage. Sa planification
doit rester active dans chaque environnement ; aucun cron supplémentaire n'est
créé. La même clé d'idempotence est transmise à Resend à chaque tentative. En
staging, les e-mails restent capturés.

Les anciennes entrées `order_email_logs` ne permettent pas de distinguer un envoi
réussi d'un échec. La migration les conserve comme `legacy_unknown`, sans les
déclarer livrées ni provoquer une réexpédition générale. Avant une reprise
manuelle, rapprocher l'identifiant de commande avec les traces du prestataire ou
la capture staging. Le journal ne stocke aucun IBAN ni corps d'e-mail.

Après création atomique d'un abonnement manuel, un échec PDF/Billit ne transforme
plus le succès en erreur de souscription. La réponse conserve `ok: true` et
signale `INVOICE_PDF_PENDING`, `BILLIT_SEND_PENDING` ou
`BILLIT_REVIEW_REQUIRED`. Un nouvel appel autorisé de souscription identique
réutilise la facture et reprend les effets manquants. Un PDF déjà enregistré
n'est pas reconstruit ; une facture déjà envoyée/acceptée/rejetée par le circuit
Peppol n'est pas retransmise.

`invoice_peppol` porte la réservation exclusive de transmission Billit. Un
échec déterministe avant transmission ou un rejet HTTP client reste réessayable.
Une interruption réseau, un délai dépassé, une réponse serveur ambiguë ou un bail
`sending` abandonné passe en attente de rapprochement
(`BILLIT_DELIVERY_UNKNOWN`). Aucune retransmission automatique n'est autorisée
dans cet état : le prestataire peut avoir reçu la facture malgré l'erreur locale.
L'opérateur doit vérifier le numéro de facture dans Billit, conserver l'identité
prestataire si l'envoi existe, ou autoriser explicitement une reprise après avoir
confirmé son absence. Aucun appel Billit n'est permis en staging.

Les baux et les transitions sont accessibles uniquement aux RPC `service_role`.
Ces protections évitent les envois concurrents ; elles ne constituent pas une
garantie transactionnelle entre PostgreSQL et un prestataire externe.
