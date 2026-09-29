# Rate limit Eventflow

Composition HTTP du compteur partagé : salage et hachage d'une clé métier,
consommation atomique avec le client `service_role`, journalisation sans clé ni
IP, et réponse `429 TOO_MANY_REQUESTS` avec `Retry-After`.

Le secret `RATE_LIMIT_SALT` doit être stable et propre à chaque environnement.
