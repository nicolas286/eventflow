# Mission — Tests négatifs bornés

Uniquement sur une stack locale ou un staging autorisé et des fixtures synthétiques. Aucun test offensif sur production, aucune charge massive, aucun paiement live, envoi client ou exfiltration de données réelles.

Selon le changement, tenter :

- Utilisateur de A lisant/modifiant une ressource de B, via UI puis API/RPC directe.
- Appel anonyme ou rôle insuffisant sur une opération privilégiée.
- Payload falsifiant organisation, prix, statut payé ou quantité.
- Booking token/QR invalide et accès indu à une facture ou un export.
- Webhook répété, ordre d'événements inhabituel, incohérence montant/organisation/mode.
- Passage du mode test au mode live sur staging, sans émettre d'appel financier réel.

Prévoir limites de volume, fixtures identifiables et nettoyage des seules données créées pour le test. Ne pas supprimer les fixtures de démonstration partagées sans nécessité.

Livrable : préconditions, requête sans secrets, résultat attendu/observé, preuve, nettoyage et sévérité. Ne pas utiliser `service_role` pour simuler un utilisateur ordinaire ; le réserver au setup ou aux assertions administratives.
