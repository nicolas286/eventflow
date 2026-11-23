# Hotfix conditions — validation du 23 novembre 2026

Le propriétaire a validé les captures locales puis autorisé la publication production. La branche part de `main` ; elle ne promeut pas le staging. Lecture et acceptation sont regroupées sur les parcours public et widget. Une tentative sans accord affiche une erreur ; aucune commande ne part avant les validations requises.

## Blocage CI découvert avant fusion

La [première CI de la PR #201](https://github.com/nicolas286/eventflow/actions/runs/45250697028) valide le frontend et la base jetable, mais refuse le module distant `https://esm.sh/pngjs@5.0.0/denonext/pngjs.mjs` pour différence d’intégrité.

- Ancienne empreinte SHA-256 : `031efe8b685dd2d8dd492ee49f0cbddc02dc815c6a95f348769a12f005e625cb`.
- Empreinte servie et revérifiée : `8508982830545aa92f309480dcaa27bff7eed6b4485c21d8006b6b6e3937a445` ; 31 250 octets, en-tête `Last-Modified` du 28 octobre 2026.
- Les 22 fichiers `sourcesContent` de la source map CDN correspondent exactement aux fichiers du [paquet npm `pngjs@5.0.0`](https://registry.npmjs.org/pngjs/5.0.0), installé séparément avec son intégrité npm.
- Le module ne déclare que les imports Node attendus (`process`, `buffer`, `util`, `stream`, `zlib`, `assert`). Aucun appel `fetch`, `XMLHttpRequest` ou `eval` n’a été trouvé.
- Comparaison locale de 16 cas (quatre dimensions, quatre types de couleur) : octets PNG encodés, décodage synchrone et décodage asynchrone identiques au paquet npm.

La première tentative actualise une seule empreinte de `deno.lock`. La comparaison ne prétend pas établir l’identité binaire avec l’ancien artefact CDN, indisponible localement.

## Contrôles avant publication

- Frontend : 123 tests Vitest, 16 contrôles de déploiement et build réussis ; avertissement existant de taille du bundle.
- Navigateur local avec API simulées : lecture, fermeture sans confirmation, acceptation manquante, acceptation puis retrait, payload, gratuit, charte, indisponibilité vendeur, mobile sans erreur masquée, nom long et widget sombre.
- Deno 2.9.6 : 126 tests réussis avec `--frozen-lockfile`, vérification de types et lint de 176 fichiers réussis.
- Revue du diff : PASS. Quatre usages frontend de `any` préexistants restent hors périmètre. Aucun changement SQL ni de contrat API.

Ces résultats précèdent le déploiement ; l’état final de publication est à vérifier dans GitHub Actions.

## Stabilisation après réponse CDN divergente

Après fusion de #201, la [CI sur `main`](https://github.com/nicolas286/eventflow/actions/runs/45251818011) reçoit l’ancienne empreinte tandis que le job de déploiement reçoit la nouvelle. Changer seulement le hash n’est donc pas une solution reproductible. Le [déploiement est annulé](https://github.com/nicolas286/eventflow/actions/runs/45251817990) avant le lien distant, les migrations et la publication des fonctions et du frontend. Le verrou existant d’inscriptions Auth avait déjà été réappliqué par le pipeline.

Le mapping transitoire exact `https://esm.sh/pngjs@^5.0.0?target=denonext` est résolu vers `npm:pngjs@5.0.0`. Le lockfile conserve l’intégrité SHA-512 du paquet officiel et retire les trois entrées CDN devenues inaccessibles dans ce graphe. `qrcode`, `pdf-lib`, les autres versions et les permissions sont conservés. La provenance du module runtime PNG change du CDN vers npm ; la comparaison de sources et de comportement ci-dessus couvre cette version. Les fonctions continuent d’utiliser leur import map existante dans `supabase/config.toml`.

Validation supplémentaire : 126 tests Edge réussis avec Deno 2.9.6, cache totalement neuf et `--frozen-lockfile`. Le graphe de génération des billets ne contient plus que `npm:/pngjs@5.0.0` pour PNG ; types et lint réussis. Aucun test n’a créé de commande réelle ni envoyé de message client.
