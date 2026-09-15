# Email gateway

Contrat d'envoi d'e-mail et adaptateur HTTP Resend sans dépendance à Eventflow,
à Deno.env, aux templates, à Storage ou au mode capture.

Le constructeur Resend accepte un `baseUrl`, un `fetch` et un délai injectables
pour les tests. Les erreurs fournisseur sont normalisées en `EmailGatewayError`
avec code, statut, caractère rejouable et réponse brute. Les pièces jointes,
tags et clés d'idempotence nécessaires à Eventflow font partie du contrat
portable.

La composition avec les secrets, la restriction des destinataires et le mode
capture vit dans `_shared/app/email.ts`.
