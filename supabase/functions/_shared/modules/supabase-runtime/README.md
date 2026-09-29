# Supabase runtime

Factories de clients Supabase pour les runtimes serveur. La lecture de
l'environnement est injectée et les clients désactivent la persistance de
session, le refresh automatique et la détection de session dans l'URL.

Le module ne dépend d'aucun type `Database` généré. Un client `service_role`
reste une capacité serveur et ne doit jamais être exposé au navigateur.
