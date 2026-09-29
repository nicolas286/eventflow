# Code partagé des Edge Functions

Ce dossier distingue deux niveaux :

- `modules/` contient des briques techniques réutilisables sans règle métier
  Eventflow et sans lecture directe de l'environnement ;
- `app/` compose ces briques avec les choix Eventflow : origines CORS, messages,
  authentification, clients Supabase, IP client, rate limit et sécurité des
  appels internes et envois d'e-mail.

`modules/worker-auth` compare les jetons machine via des condensats SHA-256.
`app/internal-edge/` l'adapte aux erreurs Eventflow et conserve temporairement
l'acceptation de l'en-tête historique `x-service-token`.

Le code propre à un endpoint reste dans son dossier. Un repository ne rejoint
`_shared` que lorsqu'il sert réellement plusieurs Edge Functions.
