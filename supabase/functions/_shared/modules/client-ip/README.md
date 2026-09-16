# Client IP

Résolution et normalisation d'une IP client derrière un proxy. Aucun header de
proxy n'est fiable par défaut.

Le header Netlify n'est accepté qu'avec une signature HS256 valide. Le header
`cf-connecting-ip` exige `trustCloudflareHeader: true`. `x-forwarded-for` et
`x-real-ip` exigent `allowUnverifiedProxyHeaders: true` et ne conviennent qu'à
un environnement dont le proxy écrase ces headers, ou au développement local.

Le module ne lit aucune variable d'environnement et ne journalise jamais l'IP.
Il utilise `node:net` pour la validation et Web Crypto pour la signature.
