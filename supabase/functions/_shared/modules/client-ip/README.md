# Client IP

Résolution et normalisation d'une IP client derrière un proxy. Aucun header de
proxy n'est fiable par défaut.

Le header Netlify n'est accepté qu'avec une signature HS256 valide. Le header
`cf-connecting-ip` exige `trustCloudflareHeader: true`. `x-forwarded-for` et
`x-real-ip` exigent `allowUnverifiedProxyHeaders: true` et ne conviennent qu'à
un environnement dont le proxy écrase ces headers, ou au développement local.

Le module ne lit aucune variable d'environnement et ne journalise jamais l'IP.
Il utilise `node:net` pour la validation et Web Crypto pour la signature.

Attention : la signature Netlify vérifiée ici ne lie pas le header IP au
payload signé. Cette option ne suffit donc pas à établir la provenance de l'IP
à une origine joignable directement. Le resolver applicatif Eventflow
`../../app/client-ip.ts` ne l'utilise pas ; il n'active Cloudflare qu'avec une
attestation serveur explicite de la frontière d'entrée. Sans cette garantie,
les routes utilisent un quota de repli borné. Voir le rapport A8.
