# Mission — Sécurité et isolation des organisations

À appliquer aux changements Auth, rôles, RPC/RLS, Edge Functions, routes publiques, Storage, exports, paiements, e-mails et secrets. Inclure `netlify/functions` quand le partage est touché.

## Questions à démontrer

- Comment l'identité et l'organisation sont-elles établies ? Un ID client permet-il de lire ou modifier une autre organisation ?
- Les relations événement/commande/participant/billet empêchent-elles les références croisées ?
- Les policies RLS et grants protègent-ils aussi l'accès direct aux tables et RPC ?
- Un `service_role` contourne-t-il une autorisation manquante ? Un `SECURITY DEFINER` a-t-il un `search_path` et des grants maîtrisés ?
- Les routes anonymes, booking tokens, QR, exports et objets Storage révèlent-ils trop de données ?
- Les webhooks vérifient-ils le paiement auprès du prestataire, son organisation, son montant et son mode ? Les répétitions sont-elles sûres ?
- Secrets, logs, erreurs et liens restent-ils dans le bon environnement ? La capture staging reste-t-elle active ?

Les refus doivent être garantis côté serveur/base, pas seulement par l'UI. Utiliser au moins deux organisations synthétiques et les rôles réels pour les tests pertinents.

Livrable : surface examinée, mécanismes réels, scénarios négatifs, preuves et risques restants. Ne pas conclure « sécurisé » sur la seule présence d'une policy ou d'un nom de garde-fou.
