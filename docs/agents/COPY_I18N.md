# Mission — Textes et internationalisation

Eventflow utilise actuellement des textes français dans le code ; aucun système FR/NL équivalent à Nexora n'est établi. Ne pas appeler un traducteur ou inventer des catalogues inexistants.

- Écrire un français simple, cohérent avec le vocabulaire de `docs/PROJECT.md`.
- Distinguer acheteur, participant, billet, commande et abonnement ; ne pas masquer ces différences dans les libellés.
- Décrire l'action et son résultat ; une erreur doit permettre de comprendre la prochaine action utile.
- Ne pas afficher code interne, SQL, stack, token ou réponse brute d'un prestataire à l'utilisateur.
- Respecter les formats monétaires et de date existants ; vérifier fuseau et conversions si le changement les concerne.
- Réutiliser les messages communs lorsqu'ils existent. Préparer une extraction future sans introduire une infrastructure i18n hors périmètre.

Livrable : textes avant/après, écran/contexte, ambiguïtés métier et vérification des contenus longs. Une adoption FR/NL fera l'objet d'une décision séparée.
