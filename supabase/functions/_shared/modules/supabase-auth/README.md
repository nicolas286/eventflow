# Supabase Bearer authentication

Parsing stricte d'un header Bearer et validation du jeton avec
`auth.getUser(token)`. Une absence de header retourne `null`; un header malformé
ou un jeton refusé produit `RequestAuthenticationError`.
