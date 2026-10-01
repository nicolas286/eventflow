# Logger

Logger structuré minimal pour les runtimes Edge. Les champs de corrélation sont
réservés et `serializeError` borne les valeurs, gère les cycles et masque les
clés usuelles contenant des secrets ou des capacités Eventflow.

Le caviardage est appliqué automatiquement aux trois niveaux du logger, après
un éventuel filtre personnalisé, sans modifier les objets de l'appelant.
Il couvre les champs sensibles (y compris `api_key`/`X-API-Key`), les erreurs
imbriquées, messages, stacks et causes, ainsi que les chaînes contenant une clé
Stripe/Supabase reconnaissable, un JWT, une authentification Bearer/Basic, un
secret nommé, une clé privée PEM ou des identifiants dans une URL. Le masquage
précède la troncature. Les cycles et la profondeur sont bornés. L'ancien point
d'entrée `_shared/logger.ts` utilise la même implémentation.

Ce filet de sécurité ne reconnaît pas un secret opaque sans contexte dans une
chaîne libre. Ne pas journaliser de secrets, d'environnements complets ni de
requêtes brutes. Les appels directs à `console` ne passent pas par ce logger ;
les logs historiques ne sont pas réécrits.
