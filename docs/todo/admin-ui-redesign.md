# Refonte visuelle Eventflow — administration et parcours client

**Statut : shell, vue d’ensemble et refonte visuelle de l’espace organisateur implémentés sur `dev`. La recette visuelle connectée et la refonte du parcours public restent à terminer.**

Ce chantier concerne à la fois l’espace utilisé par les organisateurs et le parcours public utilisé par leurs clients pour découvrir un événement, choisir des billets et terminer une inscription. Il est distinct du futur back-office interne Eventflow décrit dans [platform-admin.md](platform-admin.md).

## Objectif

Faire évoluer l’administration et la billetterie publique vers une interface SaaS plus lisible, plus crédible et plus efficace, tout en conservant :

- les parcours métier existants ;
- l’isolation par organisation ;
- la personnalisation des couleurs et du logo par le client ;
- les comportements mobile, chargement, erreur, vide et saisie non enregistrée ;
- l’architecture progressive du frontend, sans réécriture générale.

La refonte ne doit pas seulement « embellir » les écrans. Elle doit clarifier la hiérarchie, rendre la navigation prévisible, diminuer le nombre d’éléments qui se disputent l’attention et réduire les hésitations dans le tunnel d’achat.

## État observé

- `/admin` propose désormais une vue d’ensemble fondée sur les données déjà chargées : événements, commandes, recettes, prochains rendez-vous et préparation de l’espace public.
- Le shell organisateur repose désormais sur une sidebar desktop et un drawer mobile. Les destinations principales et la route active restent visibles.
- Les pages sont une succession de cartes de même poids visuel, avec peu de distinction entre contexte, actions primaires, données et réglages.
- Les valeurs visuelles sont dispersées dans de nombreux fichiers CSS : rayons, ombres, bordures, couleurs de texte, espacements et états ne forment pas encore un système cohérent.
- Le fond global combine gradients et plusieurs couches de grain. Il donne du caractère aux pages publiques, mais charge visuellement un outil de gestion dense.
- La couleur de l’organisation est injectée dans l’interface par `OrgThemeSync`. Ce principe est pertinent, mais la couleur primaire est parfois utilisée comme couleur d’interface générale plutôt que comme accent.
- Les statistiques actuelles de la page événements se limitent aux événements créés, publiés et brouillons.
- Les écrans contiennent déjà des composants et parcours utiles qu’il faut préserver : boutons, cartes, champs, messages, modales, éditeurs latéraux, onglets d’événement, tableaux et scanner QR.

## Ce que les références internes apportent

### Nexora

- Un shell applicatif stable composé d’une sidebar, d’une topbar et d’une zone de contenu.
- Une navigation visible avec icônes, libellé, route active et sections.
- Le logo et le nom de l’entreprise en haut, puis l’identité et les actions utilisateur en pied de sidebar.
- Une palette neutre pour la structure, avec les couleurs personnalisées utilisées comme accents.
- Des composants dédiés pour les en-têtes, métriques, tableaux, notifications et états transitoires.

### Immochat

- Une sidebar plus légère, très lisible, avec des séparateurs et des états actifs discrets.
- Une hiérarchie typographique plus calme : titres nets, petits libellés de section, métadonnées secondaires et boutons moins massifs.
- Un back-office plateforme visuellement et fonctionnellement séparé de l’espace client.
- Des tableaux, filtres, badges de statut et actions de ligne conçus comme une même famille visuelle.

Ces projets servent de références de rythme, de structure et de finition. Eventflow doit garder son propre vocabulaire métier, ses dépendances et son CSS colocalisé.

## Direction visuelle proposée

### 1. Construire un vrai shell d’administration

Sur ordinateur :

- sidebar fixe de 248 à 272 px ;
- topbar sobre dans la zone de contenu ;
- contenu scrollable indépendant, avec largeur utile maîtrisée ;
- route active immédiatement visible ;
- profil, rôle et déconnexion en pied de sidebar ;
- action « Voir la page publique » accessible sans être mêlée aux réglages.

Sur mobile et tablette :

- topbar compacte avec nom de la page et bouton menu ;
- sidebar transformée en drawer accessible au clavier ;
- fermeture après navigation ;
- actions primaires conservées dans l’en-tête de page ou une barre d’action adaptée, pas cachées dans le menu.

Le shell pourrait être découpé en composants ciblés : `AdminShell`, `AdminSidebar`, `AdminTopbar`, `AdminPageHeader`, `AdminNavItem` et `AdminUserMenu`.

### 2. Repenser l’architecture de navigation

Proposition de regroupement :

| Groupe       | Entrées                          |
| ------------ | -------------------------------- |
| Pilotage     | Vue d’ensemble, Événements       |
| Diffusion    | Widget, Apparence, Profil public |
| Organisation | Structure, Abonnement            |
| Compte       | Profil personnel, Déconnexion    |

La page d’un événement conserve une navigation secondaire propre : détails, billets, formulaire, codes promo, commandes/participants et contrôle des billets. Cette navigation ne doit pas encombrer la sidebar globale.

### 3. Ajouter une véritable vue d’ensemble organisateur

La route `/admin` pourrait devenir une page de pilotage et `/admin/events` rester la liste détaillée. Première version utile :

- prochain événement et état de publication ;
- nombre d’inscriptions ou de participants sur la période ;
- commandes payées, en attente et expirées ;
- montant encaissé ou volume de ventes, avec un libellé métier non ambigu ;
- taux de remplissage si une capacité fiable existe ;
- tâches à terminer : paiement non connecté, événement incomplet, facture ouverte, configuration publique manquante ;
- activité récente et raccourcis vers les actions fréquentes.

Les KPI ne doivent être affichés que lorsque leur définition et leur source sont fiables. Une métrique approximative nuit davantage à la confiance qu’un bloc absent.

### 4. Séparer identité client et lisibilité produit

La liberté de marque est conservée avec deux couches :

- **socle Eventflow neutre** : fonds, surfaces, texte, bordures, succès, avertissement, erreur et information ;
- **identité de l’organisation** : logo, couleur primaire, éventuelle couleur secondaire et accents sélectionnés.

La couleur client devrait servir principalement aux actions primaires, liens actifs, focus, graphiques et petits accents. Les grands fonds, tableaux, formulaires et textes restent neutres afin de garantir lisibilité et cohérence, même avec une couleur client très vive ou très sombre.

À prévoir :

- validation du format des couleurs ;
- calcul d’une couleur de contraste accessible ;
- nuances dérivées contrôlées pour les fonds légers et bordures ;
- aperçu clair dans l’écran Apparence ;
- valeurs de secours stables ;
- vérification WCAG des textes et focus ;
- possibilité future d’une couleur secondaire, sans la rendre nécessaire au premier lot.

### 5. Introduire des tokens sémantiques

Consolider progressivement les valeurs visuelles, sans conversion globale en CSS Modules ni changement de bibliothèque :

```css
--ef-bg-app
--ef-bg-surface
--ef-bg-subtle
--ef-text-primary
--ef-text-secondary
--ef-border-default
--ef-border-strong
--ef-shadow-sm
--ef-shadow-md
--ef-radius-sm
--ef-radius-md
--ef-radius-lg
--ef-space-1 ... --ef-space-8
--ef-success / --ef-warning / --ef-danger / --ef-info
--org-primary / --org-primary-contrast / --org-primary-soft
```

Les anciens tokens peuvent être raccordés progressivement à ce socle. Le but est d’éliminer les variantes presque identiques, pas de renommer tout le CSS en une seule PR.

### 6. Renforcer la hiérarchie des pages

Chaque écran devrait suivre une composition prévisible :

1. fil d’Ariane lorsque le contexte l’exige ;
2. titre, description courte et action primaire ;
3. alertes ou tâches importantes ;
4. métriques ou filtres ;
5. contenu principal ;
6. actions secondaires et dangereuses séparées.

Les cartes ne doivent plus envelopper systématiquement chaque bloc. Une bordure ou un fond de surface suffit souvent. Réserver ombres et élévation aux éléments réellement superposés : menus, modales, drawers et éditeurs latéraux.

### 7. Uniformiser les composants de données

Créer une famille cohérente, alimentée par les composants existants lorsque possible :

- `MetricCard` avec valeur, libellé, évolution et état de chargement ;
- `StatusBadge` sémantique ;
- `DataTable` avec en-tête, ligne interactive, actions, vide et responsive ;
- `FilterBar` cohérente ;
- `EmptyState` avec explication et action ;
- skeletons ou placeholders de chargement ;
- pagination et résumé de résultats ;
- graphiques simples seulement lorsque la comparaison temporelle apporte une information.

Sur petit écran, un tableau complexe doit devenir une liste structurée ou permettre un défilement explicitement assumé. Il ne faut pas simplement réduire la police.

### 8. Revoir les pages prioritaires

1. **Shell et liste des événements** : impact visuel immédiat, navigation et structure globale.
2. **Détail d’un événement** : page la plus riche, avec titre, statut, actions et onglets secondaires stables.
3. **Commandes et participants** : tableaux, filtres, exports, scanner et actions sensibles.
4. **Apparence et profil public** : aperçu en direct et explication claire de ce qui sera public.
5. **Organisation, abonnement et profil** : formulaires plus calmes, sections logiques et barre de sauvegarde cohérente.
6. **Parcours d’authentification et onboarding** : alignement visuel avec le nouveau produit, sans mélanger ce travail au back-office plateforme.

## Parcours client public

### Ce qui fonctionne déjà

- Les cartes d’événements avec bannière donnent immédiatement du contexte et une identité à chaque événement.
- Le logo, le nom et la couleur de l’organisateur sont repris dans le parcours.
- Toute la carte événement est interactive au clavier lorsque l’inscription est disponible.
- Les informations essentielles — date, lieu, durée et organisateur — sont présentes.
- Le parcours est découpé en trois étapes compréhensibles : billets, participants et paiement.
- Le récapitulatif fixé en bas maintient le total et l’action suivante visibles.
- Les états complet, clôturé et paiement indisponible existent déjà.

La refonte doit donc améliorer cette base plutôt que la remplacer par une page générique sans personnalité.

### Faiblesses observées

- La bannière complète et le bloc d’identité sont répétés sur les trois étapes, ce qui repousse l’action principale sous la ligne de flottaison, surtout sur mobile.
- L’étape est indiquée par un simple texte `1/3`, `2/3`, `3/3` plutôt que par une progression stable et navigable.
- Les cartes billet cumulent gradients, grain, badge, ombre, capsule de total et bloc de quantité. Trop d’éléments ont le même poids visuel.
- Le badge « Disponible » est répété sur chaque billet alors que l’état normal pourrait rester implicite.
- Le sélecteur de quantité contient un champ numérique large entre deux boutons ; il ressemble davantage à un formulaire technique qu’à un sélecteur d’achat.
- Le prix unitaire, le total de la ligne et le total fixe en bas peuvent être confondus.
- L’étape paiement empile plusieurs cartes — récapitulatif, code promo, charte, conditions, contact, anti-bot — ce qui donne une impression longue et administrative.
- Plusieurs styles utilisent encore un bleu ou un indigo fixe (`#2563eb`, bordure indigo des événements mis en avant), en contradiction avec la couleur choisie par l’organisation.
- Les hover des cartes événements sont définis à plusieurs endroits avec des transformations différentes, ce qui rend le comportement difficile à maîtriser.
- Avant la première tranche, `WidgetTicketCard` rendait les classes `widgetEventCard` et `widgetEventTitle`, tandis que sa feuille de style ciblait `widgetTicketCard` et `widgetTicketTitle`. Ce raccordement a été corrigé au démarrage du chantier.
- Le widget limite la sélection aux quatre premiers billets puis ouvre la page complète dans un nouvel onglet. Cette rupture peut surprendre l’utilisateur et fragmenter le tunnel.

### 1. Faire évoluer les cartes événements sans perdre les bannières

Conserver la bannière, mais rendre la carte plus informative et plus calme :

- ratio d’image stable, avec point focal et image de secours propre ;
- petit bloc date très lisible, superposé ou placé à gauche du contenu ;
- titre sur deux lignes maximum, lieu et horaire immédiatement scannables ;
- prix d’appel ou mention « Gratuit » si cette donnée peut être fournie sans requête par carte ;
- statut uniquement lorsqu’il apporte une information : bientôt complet, complet, inscriptions clôturées ou à venir ;
- action principale plus courte : « Voir les billets » ou « S’inscrire » ;
- carte sélectionnable entièrement, avec focus visible utilisant la couleur de l’organisation ;
- animation légère identique pour toutes les cartes, sans cumul de plusieurs `transform` concurrents.

Pour une organisation ayant peu d’événements, afficher directement les cartes. La barre de filtres complète peut apparaître seulement au-delà d’un certain volume ; avant cela, une recherche et des filtres rapides « À venir » / « Passés » suffisent.

### 2. Créer un shell de checkout commun

Les trois pages devraient partager une structure visuelle unique :

- en-tête événement complet sur la première étape ;
- en-tête compact sur les étapes suivantes, avec miniature, titre, date et retour ;
- stepper visible `Billets → Participants → Confirmation et paiement` ;
- contenu principal à gauche et résumé de commande sticky à droite sur desktop ;
- résumé compact et bouton sticky en bas sur mobile ;
- largeur de lecture limitée pour les formulaires ;
- conservation du brouillon et indication discrète lorsque la sélection est sauvegardée.

Le stepper peut permettre de revenir à une étape terminée, mais ne doit jamais permettre de sauter une validation métier.

### 3. Recomposer l’écran de sélection des billets

Proposition pour chaque ligne ou carte billet :

- nom et courte description à gauche ;
- prix unitaire mis en évidence ;
- disponibilité affichée seulement si limitée ou indisponible ;
- sélecteur compact `−  0  +`, sans champ libre visuellement dominant ;
- état sélectionné visible par une bordure et un fond dérivés de la couleur client ;
- total de ligne uniquement lorsque la quantité est supérieure à zéro ;
- explication humaine lorsque plusieurs participants sont créés par billet ;
- accordéon « Plus de détails » pour les descriptions longues.

Le résumé doit employer des libellés explicites :

- `2 billets` ;
- `Sous-total 40,00 €` ;
- `À payer maintenant 15,00 €` en cas d’acompte ;
- `Solde à régler plus tard 25,00 €` lorsque cette information est applicable.

Le bouton doit refléter l’action réelle : « Continuer vers les participants », « Continuer vers le paiement » ou « Confirmer l’inscription gratuite » plutôt qu’un générique « Continuer » partout.

### 4. Faciliter la saisie des participants

- Afficher un bloc repliable par participant avec un titre humain : `Participant 1 — Billet adulte`.
- Marquer les blocs complets et ceux qui contiennent une erreur.
- Ajouter « Utiliser les informations de l’acheteur » pour le premier participant.
- Proposer « Copier depuis le participant précédent » lorsque les champs s’y prêtent, sans copier les consentements sensibles.
- Garder les groupes de champs et leur description, mais réduire les cartes imbriquées et séparateurs inutiles.
- Afficher un résumé d’erreurs en haut après validation, avec lien ou focus vers le premier champ concerné.
- Sauvegarder le brouillon local au fil de la saisie et prévenir avant une perte réelle de données.

Sur mobile, un participant doit former une section claire et non une longue succession de champs sans repère.

### 5. Simplifier confirmation et paiement

Sur desktop :

- colonne principale pour contact, moyen de paiement et consentements ;
- résumé de commande sticky dans une colonne secondaire ;
- code promo sous forme d’action secondaire repliable ;
- total, acompte et solde regroupés dans le résumé ;
- charte et conditions présentées dans une même zone légale structurée ;
- CAPTCHA le moins intrusif possible, sans bloc visuel disproportionné.

Sur mobile, conserver le total et l’action finale visibles, mais permettre d’ouvrir le détail de la commande dans un drawer. Le libellé final doit distinguer :

- « Payer 40,00 € » ;
- « Confirmer et recevoir les instructions de virement » ;
- « Confirmer l’inscription gratuite ».

La réorganisation visuelle ne change pas les obligations actuelles de lecture et d’acceptation. Toute simplification de ces règles serait une décision métier et juridique séparée.

### 6. Refaire l’écran de confirmation comme une prochaine étape

L’écran de retour devrait commencer par un état humain, pas par les identifiants techniques :

- confirmation réussie, paiement en attente, virement attendu, paiement refusé ou traitement en cours ;
- explication courte de ce qui va se passer ensuite ;
- action principale adaptée : télécharger les billets, consulter la commande, réessayer ou revenir à l’événement ;
- confirmation de l’adresse e-mail utilisée ;
- instructions de virement avec boutons de copie pour IBAN, montant et communication ;
- identifiant de commande disponible dans une zone « Détails », sans être l’information dominante ;
- retour vers la page de l’organisateur ou l’événement plutôt que vers une URL Eventflow générique.

Les statuts techniques comme `awaiting_payment` doivent toujours être traduits en libellés utilisateur.

### 7. Harmoniser le widget avec le parcours complet

- Réutiliser les mêmes composants de présentation des événements, billets, quantités et totaux lorsque leurs contraintes le permettent.
- Corriger les classes incohérentes de `WidgetTicketCard` avant toute retouche esthétique.
- Afficher les billets suivants dans le widget avec « Voir plus » plutôt que forcer immédiatement un nouvel onglet.
- Si le passage vers la page complète reste nécessaire, annoncer clairement qu’il ouvre la billetterie complète et préserver la sélection.
- Garantir les mêmes couleurs, contrastes, messages d’état et libellés que le parcours public principal.
- Tester l’auto-resize, les petits conteneurs, le clavier et l’intégration sur un site tiers.

### 8. Renforcer confiance et accessibilité

- Indiquer clairement qui vend le billet et qui fournit la plateforme.
- Afficher les informations rassurantes au bon moment, sans répéter « paiement sécurisé » sur chaque carte.
- Utiliser la couleur client pour l’accent tout en conservant les couleurs sémantiques de succès, avertissement et erreur.
- Supprimer le bleu global imposé aux liens et dériver focus/liens du thème avec contraste contrôlé.
- Prévoir focus visible, labels associés, zones tactiles d’au moins 44 px et messages annoncés aux technologies d’assistance.
- Respecter `prefers-reduced-motion` pour les mouvements de cartes, drawers et transitions d’étapes.
- Prévoir des skeletons proches de la mise en page finale pour éviter les sauts au chargement.

### Ordre de traitement conseillé côté client

1. Corriger les incohérences CSS du widget et centraliser les tokens publics.
2. Créer le shell de checkout et le stepper partagé.
3. Recomposer la sélection des billets et son résumé.
4. Recomposer participants puis confirmation/paiement.
5. Refaire l’écran de retour de commande.
6. Affiner la page organisation, les cartes événement et les filtres.
7. Aligner complètement le widget et réaliser la recette embarquée.

## Proposition de déroulement

### État d’implémentation au 29 septembre 2026

- Le shell desktop/mobile, la sidebar, la topbar et le focus du drawer mobile sont en place.
- Le footer public a été retiré du layout organisateur afin que la sidebar reste attachée au viewport sur toute la page.
- La route `/admin` affiche une vraie vue d’ensemble avec les indicateurs fiables déjà disponibles, les prochains événements et les réglages publics à compléter, sans nouvel appel backend.
- Les écrans Événements, détail d’événement, Apparence, Widget, Profil organisateur, Profil personnel et Abonnement utilisent un en-tête de page commun.
- Une couche visuelle limitée à `.adminAppShell` harmonise cartes, formulaires, boutons, badges, listes, onglets, factures, éditeurs et états vides sans modifier le thème des pages publiques.
- Les états initiaux de chargement et d’erreur utilisent le même shell afin d’éviter le retour visuel à l’ancienne navigation.
- Les modales partagées de confirmation, suppression et changement de mot de passe utilisent un style commun, un focus initial, un piège de focus, la fermeture par Échap et la restitution du focus.
- Les parcours métier, routes, hooks et repositories sont inchangés.
- La validation navigateur connectée reste à effectuer : aucun navigateur contrôlable n’était disponible dans la session d’implémentation.

### Lot 0 — Inventaire et maquettes

- Capturer les écrans desktop/mobile et les états importants.
- Lister les composants et valeurs CSS réellement réutilisés.
- Définir la navigation, les wireframes et les tokens cibles.
- Valider trois écrans étalons : vue d’ensemble, liste des événements et détail d’événement.

### Lot 1 — Fondations visuelles

- Ajouter les tokens sémantiques.
- Harmoniser typographie, surfaces, boutons, champs, badges, cartes et focus.
- Retirer le grain du back-office tout en pouvant le conserver sur le public si souhaité.
- Mettre en place le shell responsive, sans modifier les données métier.

### Lot 2 — Navigation et événements

- Installer la sidebar et la topbar.
- Créer la vue d’ensemble organisateur avec les données déjà fiables.
- Recomposer liste et détail d’événement.
- Préserver routes, mutations, éditeurs et retours d’erreur existants.

### Lot 3 — Écrans de gestion

- Harmoniser commandes, participants, billets, formulaires et codes promo.
- Améliorer filtres, tables, vides, chargements et actions de masse éventuelles.
- Vérifier contenus longs, clavier, focus et mobile.

### Lot 4 — Réglages et finition

- Recomposer Apparence, Widget, Structure, Abonnement et Profil.
- Ajouter aperçu de marque et contrôle de contraste.
- Réaliser une recette visuelle complète et corriger les incohérences restantes.

### Lot 5 — Fondations du parcours client

- Centraliser les tokens publics et supprimer les couleurs fixes qui contredisent le thème client.
- Corriger les styles et classes du widget.
- Créer le shell de checkout, le stepper et le résumé partagé.
- Valider les écrans étalons billets desktop et mobile.

### Lot 6 — Tunnel d’inscription

- Recomposer billets, participants, paiement et confirmation sans changer les contrats métier.
- Adapter les libellés aux parcours gratuit, carte, acompte et virement.
- Vérifier reprise de brouillon, erreurs, retour arrière et double soumission.

### Lot 7 — Découverte et widget

- Affiner hero, filtres et cartes événement.
- Aligner le widget sur les composants et messages du parcours principal.
- Tester l’intégration embarquée, les tailles contraintes et l’ouverture éventuelle de la billetterie complète.

## Critères d’acceptation

- La destination courante et les destinations principales sont visibles sur desktop.
- L’usage mobile reste complet au clavier et au tactile.
- La couleur d’une organisation personnalise l’interface sans compromettre le contraste.
- Les actions primaires, secondaires et dangereuses sont distinguées.
- Chaque page possède des états chargement, erreur et vide cohérents.
- Aucun appel Supabase n’est déplacé dans un composant de présentation.
- Les routes et parcours métier existants restent fonctionnels.
- La progression Billets → Participants → Paiement est visible et le retour arrière conserve les données attendues.
- Les écrans gratuit, carte, acompte et virement utilisent un récapitulatif et un CTA sans ambiguïté.
- La confirmation traduit les statuts techniques et propose la prochaine action utile.
- Le widget et la billetterie complète présentent les mêmes billets, états et calculs.
- Les tests ciblés, `npm run build` et une recette visuelle desktop/mobile sont réalisés pour chaque lot.

## Hors périmètre initial

- Remplacement global des bibliothèques UI ou CSS.
- Adoption automatique de TanStack Query, de l’i18n ou de l’organisation de fichiers de Nexora.
- Refonte du site vitrine Eventflow et des pages légales hors éléments intégrés au checkout.
- Modification des règles de paiement ou des contrats métier.
- Développement du back-office interne Eventflow.
