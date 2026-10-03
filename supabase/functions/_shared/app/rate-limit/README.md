# Rate limit Eventflow

Composition HTTP du compteur partagé : salage et hachage d'une clé métier,
consommation atomique avec le client `service_role`, journalisation sans clé ni
IP, et réponse `429 TOO_MANY_REQUESTS` avec `Retry-After`.

Le secret `RATE_LIMIT_SALT` doit être stable et propre à chaque environnement.

La matrice A8 se trouve dans `../config/rate-limits.ts` (`applicationRateLimits`).
Identité authentifiée puis organisation autorisée avant la clé `user:…:org:…`.
La RPC de consommation est un appel distinct de la transaction métier ; ses
erreurs ne donnent jamais un accès illimité. Panne, sel absent ou réponse RPC
invalide : `503 RATE_LIMIT_UNAVAILABLE`, `Retry-After: 30`. Dépassement valide :
`429 TOO_MANY_REQUESTS`, délai entier positif. Ces headers sont exposés au
navigateur ; les réponses restent `no-store`.

Le resolver applicatif `../client-ip.ts` ignore les headers proxy par défaut.
`RATE_LIMIT_TRUST_CLOUDFLARE_IP=1` est une attestation de configuration serveur,
à activer seulement après vérification d'une entrée obligatoire qui écrase
`CF-Connecting-IP`, y compris les chemins Worker/proxy et domaines alternatifs.
Les requêtes directes/locales sans cette garantie utilisent un compteur de
repli partagé par route, jamais un identifiant arbitraire reçu du client.
La signature Netlify existante ne lie pas l'IP au payload signé : elle ne sert
plus de preuve IP dans le resolver applicatif.

La purge `private.prune_rate_limits()` (sept jours) existe et est testée ;
aucun appel périodique versionné n'a été trouvé. Les fenêtres anciennes peuvent
donc s'accumuler. Voir le rapport A8 pour cette limite d'exploitation et les
protections Data API temporaires jusqu'à B0–B6.
