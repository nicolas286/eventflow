# Supabase rate limit

Compteur atomique à fenêtre fixe stocké dans PostgreSQL et helper de hachage
SHA-256. Le module ne résout pas l'IP, ne lit aucune variable d'environnement et
ne fabrique pas de réponse HTTP.

Eventflow installe `public.consume_rate_limit` par migration en réutilisant la
table historique `private.rate_limit_hits`. La RPC n'est exécutable que par
`service_role`. La clé brute n'est jamais stockée : l'appelant fournit un hash
salé avec un secret stable.
