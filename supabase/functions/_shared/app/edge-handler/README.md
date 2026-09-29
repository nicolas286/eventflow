# Edge handler Eventflow

Façade commune des Edge Functions Eventflow. Elle compose HTTP/CORS, logs,
clients Supabase et résolution explicite du bearer.

Le mode d'authentification est obligatoire à chaque appel. Le client
`service_role` n'est transmis au handler que lorsque `serviceClient: true` est
déclaré explicitement. Les secrets internes, crons, webhooks Mollie et booking
tokens utilisent des gardes applicatives dédiées.
