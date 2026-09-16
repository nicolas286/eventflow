# Code partagé des Edge Functions

Ce dossier distingue deux niveaux :

- `modules/` contient des briques techniques réutilisables sans règle métier
  Eventflow et sans lecture directe de l'environnement ;
- `app/` compose ces briques avec les choix Eventflow : origines CORS, messages,
  authentification, clients Supabase, IP client, rate limit et sécurité des
  envois d'e-mail.

Le code propre à un endpoint reste dans son dossier. Un repository ne rejoint
`_shared` que lorsqu'il sert réellement plusieurs Edge Functions.
