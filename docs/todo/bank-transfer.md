# Paiement par virement — suites hors chantier

- Ajouter une réauthentification avant toute modification des coordonnées bancaires lorsque le parcours Auth existant le permettra sans infrastructure spécifique.
- Faire valider puis mettre à jour la politique de confidentialité pour indiquer que les coordonnées bancaires fournies par l’organisateur sont communiquées uniquement aux participants concernés afin de payer leur réservation.
- Si une infrastructure de planification d’e-mails est généralisée, prévoir des rappels optionnels et un e-mail lors de l’expiration manuelle. Aucun cron dédié n’est introduit dans le chantier actuel.
- Concevoir, avec les règles comptables adéquates, une correction contrôlée d’une confirmation manuelle erronée. Le système actuel ne possède pas de parcours « dé-payer » sûr ; aucune inversion automatique n’est ajoutée ici.
