# 🧱 Frontend Architecture – Eventflow

> Dépôt : [nicolas286/eventflow](https://github.com/nicolas286/eventflow). Voir le [guide de déploiement staging / production](docs/deploiements.md).

## 🎯 Objectif

Mettre en place une architecture :

- claire  
- scalable  
- orientée feature  
- robuste aux refactors (imports stables via alias)

---

# 📁 Arborescence proposée

```
src/
│
├── app/
│   ├── routes/
│   ├── layouts/
│   ├── providers/
│   └── config/
│
├── modules/
│   ├── admin/
│   │   ├── events/
│   │   │   ├── pages/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── data/
│   │   │   └── schemas/
│   │   │
│   │   ├── billing/
│   │   ├── org/
│   │   └── subscription/
│   │
│   └── public/
│       ├── checkout/
│       ├── orgProfile/
│       └── events/
│
├── shared/
│   ├── ui/
│   │   ├── components/
│   │   ├── styles/
│   │   └── index.ts
│   │
│   ├── lib/
│   ├── hooks/
│   ├── zod/
│   └── types/
│
├── gateways/
│   └── repositories/
│
├── domain/            (⚠️ progressivement vidé)
│
└── styles/            (global uniquement)
```

---

# 🧠 Philosophie

## 1️⃣ Feature First

Tout ce qui appartient à une feature vit ensemble :

```
modules/admin/events/
  pages/
  components/
  hooks/
  data/
  schemas/
```

Un dev ouvre ce dossier → il comprend tout le scope.

---

## 2️⃣ Shared = socle global

Dans `shared/` on met uniquement :

- design system (`ui`)
- utilitaires purs
- hooks génériques
- schémas réutilisables
- types globaux

⚠️ Rien de spécifique à une feature ici.

---

## 3️⃣ UI générique vs UI métier

| Type                          | Où ?                                   |
|-------------------------------|------------------------------------------|
| Button, Input, Modal         | `shared/ui`                             |
| EventTicketEditor            | `modules/admin/events/components`       |
| StickySaveBar spécifique     | module concerné                         |

---

## 4️⃣ Hooks

| Type                          | Où ?                                   |
|-------------------------------|------------------------------------------|
| useDebounce, useIsMobile     | `shared/hooks`                          |
| useEventTicketsEditor        | `modules/admin/events/hooks`            |
| useEventQuery                | `modules/admin/events/data`             |

---

## 5️⃣ Data Layer

Dans chaque feature :

```
data/
  eventRepo.ts
  eventKeys.ts
  useEventQuery.ts
  useUpdateEvent.ts
```

Les composants ne parlent jamais directement à Supabase.

---

# 🔁 Règles simples pour le refactor

## ✅ 1. Interdire les imports longs relatifs

❌ Mauvais :

```ts
import { Button } from "../../../../ui/components/Button";
```

✅ Bon :

```ts
import { Button } from "@ui/components/Button";
```

---

## ✅ 2. Utiliser les alias

Exemples :

```ts
import { AdminEventPage } from "@admin/events";
import { formatMoney } from "@helpers/money";
import { EventSchema } from "@models/event.schema";
```

---

## ✅ 3. Barrel files (index.ts)

Chaque feature importante doit exposer un `index.ts`.

Exemple :

```
modules/admin/events/index.ts
```

```ts
export * from "./pages/AdminEventPage";
export * from "./hooks/useEventTicketsEditor";
```

Ensuite :

```ts
import { AdminEventPage } from "@admin/events";
```

---

## ✅ 4. Déplacement progressif

Refactor en 3 phases :

**Phase 1**  
Mettre en place les alias.

**Phase 2**  
Remplacer les imports relatifs par alias.

**Phase 3**  
Déplacer les dossiers vers `modules/` et `shared/`.

---

# 🚫 À éviter

- Trop d’alias ultra spécifiques (`@admin-pages`, `@admin-components`, etc.)
- Mélanger logique métier dans `shared/`
- Mettre du CSS de composant dans `/styles` global
- Créer un `index.ts` dans chaque petit dossier inutilement

---

# 🧩 Convention de nommage

| Type            | Suffixe           |
|-----------------|-------------------|
| Zod form        | `.schema.ts`      |
| DB row          | `.db.ts`          |
| API payload     | `.dto.ts`         |
| React Query     | `useXQuery.ts`    |
| Mutation        | `useXMutation.ts` |

---

# 🔥 Principe clé

Une feature = un dossier autonome.

Si tu supprimes `modules/admin/events`, rien d’autre ne doit casser sauf les imports qui l’utilisent.

---

# 🎯 Objectif long terme

- `domain/` disparaît progressivement  
- Les features deviennent isolables  
- L’archi reste stable même avec 3x plus de code