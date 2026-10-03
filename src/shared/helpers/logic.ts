import type { OrderPublicResponse } from "@contracts/orders-read";
type OrderStatus = OrderPublicResponse["status"];

/* ============================================================
   NUMERIC HELPERS
   ============================================================ */

/**
 * Convertit une valeur inconnue en entier "fini" (pas NaN / Infinity),
 * en retombant sur `fallback` si la conversion échoue.
 *
 * Utilitaire interne, utilisé par `clampInt`.
 */
function toFiniteInt(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(String(v ?? ""));
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

/**
 * Convertit une valeur inconnue en entier fini puis la borne entre `min` et `max`.
 */
export function clampInt(
  value: unknown,
  {
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    fallback = 0,
  }: { min?: number; max?: number; fallback?: number } = {}
) {
  const n = toFiniteInt(value, fallback);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/** Entier >= 0 */
export const nonNegInt = (v: unknown) => clampInt(v, { min: 0, fallback: 0 });

/** Entier >= 1 */
export const posInt = (v: unknown) => clampInt(v, { min: 1, fallback: 1 });

/* ============================================================
   GENERIC OBJECT HELPERS
   ============================================================ */

/**
 * Retourne la première valeur non null/undefined d'un objet pour une liste de clés.
 *
 * Exemple:
 *   getFirst(order, ["id", "orderId", "order_id"])
 */
export function getFirst<T = unknown>(
  obj: Record<string, unknown> | null | undefined,
  keys: readonly string[]
): T | undefined {
  if (!obj) return undefined;

  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null) return v as T;
  }

  return undefined;
}

/* ============================================================
   SORTING
   ============================================================ */

/**
 * Trie une liste d'items par `sortOrder` croissant (défensif).
 */
export function sortBySortOrder<T extends { sortOrder?: number | null }>(
  items: T[] | null | undefined
): T[] {
  return [...(items ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

/**
 * Normalise une valeur en clé de tri alpha:
 * - minuscules
 * - suppression des accents
 * - trim
 */
export function normalizeSortKey(v: unknown) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Trie n'importe quel tableau par ordre alphabétique.
 */
export function sortAlpha<T>(
  items: T[] | null | undefined,
  pick: (item: T) => unknown,
  locale: string = "fr"
): T[] {
  const arr = [...(items ?? [])];

  arr.sort((a, b) => {
    const ka = normalizeSortKey(pick(a));
    const kb = normalizeSortKey(pick(b));
    if (ka === kb) return 0;
    return ka.localeCompare(kb, locale, { sensitivity: "base" });
  });

  return arr;
}

/** Wrapper spécifique produits */
type SortableProduct = {
  sortOrder?: number | null;
};

export function sortProducts<T extends SortableProduct>(
  products: T[] | null | undefined
): T[] {
  const arr = [...(products ?? [])];

  arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return arr;
}
/* ============================================================
   STOCK
   ============================================================ */

/**
 * Calcule le stock restant.
 */
export function computeRemaining<
  T extends {
    stockQty?: number | null;
    soldQty?: number | null;
    reservedQty?: number | null;
  }
>(item: T): number | null {
  if (item.stockQty == null) return null;

  const remaining =
    (item.stockQty ?? 0) -
    (item.soldQty ?? 0) -
    (item.reservedQty ?? 0);

  return Math.max(0, remaining);
}

/* ============================================================
   QUANTITIES & PRICING
   ============================================================ */

export type QuantityMap = Record<string, unknown>;

/**
 * Transforme un objet de quantités en liste d'items valides.
 */
export function quantitiesToItems(quantities: QuantityMap) {
  return Object.entries(quantities ?? {})
    .map(([eventProductId, quantity]) => ({
      eventProductId,
      quantity: Number(quantity) || 0,
    }))
    .filter((x) => x.quantity > 0);
}

/** Somme des quantités */
export function sumItemQuantities(items: { quantity: number }[]) {
  return items.reduce((acc, it) => acc + it.quantity, 0);
}

/** Total en cents */
export function computeTotalCents(
  items: { eventProductId: string; quantity: number }[],
  products: { id: string; priceCents: number }[]
) {
  const productMap = new Map(products.map((p) => [p.id, p.priceCents ?? 0]));

  return items.reduce((acc, it) => {
    const price = productMap.get(it.eventProductId) ?? 0;
    return acc + it.quantity * price;
  }, 0);
}

/** Résout la devise */
export function resolveCurrency(products: { currency?: string }[], fallback = "EUR") {
  return products.find((p) => p.currency)?.currency ?? fallback;
}

/* ============================================================
   ATTENDEE SLOTS & DRAFTS
   ============================================================ */

export const DEFAULT_MAX_QTY = 99;

export type ExpectedSlot = { eventProductId: string };

export type AttendeeDraft = {
  eventProductId: string;
  values: Record<string, unknown>;
};

/**
 * Calcule les slots participants attendus.
 */
export function computeExpectedAttendeeSlots(
  products: {
    id: string;
    createsAttendees?: boolean;
    attendeesPerUnit?: number;
  }[],
  quantities: Record<string, unknown>
) {
  const slots: ExpectedSlot[] = [];

  for (const p of products) {
    if (!p.createsAttendees) continue;

    const qty = Number(quantities[p.id] ?? 0) || 0;
    const perUnit = Number(p.attendeesPerUnit ?? 0) || 0;
    const count = qty * perUnit;

    for (let i = 0; i < count; i++) {
      slots.push({ eventProductId: p.id });
    }
  }

  return slots;
}

/**
 * Réconcilie des drafts avec les slots attendus.
 */
export function reconcileAttendeesByIndex(
  prev: AttendeeDraft[],
  expectedSlots: ExpectedSlot[]
): AttendeeDraft[] {
  return expectedSlots.map((slot, idx) => {
    const old = prev[idx];
    if (old && old.eventProductId === slot.eventProductId) return old;
    return { eventProductId: slot.eventProductId, values: {} };
  });
}

/** Quantité max UI */
export function getMaxQty(remaining: number | null | undefined) {
  return remaining == null ? DEFAULT_MAX_QTY : Math.max(0, remaining);
}

/** Alias intentionnel */
export function resolveMaxQty(remaining: number | null | undefined) {
  return remaining == null ? DEFAULT_MAX_QTY : Math.max(0, remaining);
}

/** Calcule prochaine quantité */
export function computeNextQty(
  nextQty: number,
  remaining: number | null | undefined
) {
  const maxQty = resolveMaxQty(remaining);
  return clampInt(nextQty, { min: 0, max: maxQty, fallback: 0 });
}

/* ============================================================
   MISC
   ============================================================ */

/**
 * Génère une clé unique à partir d'une base.
 */
export function uniqueKey(base: string, existing: Set<string>) {
  const cleanBase = base.trim() || "option";

  const regex = new RegExp(`^${cleanBase}_(\\d+)$`);
  let max = 1;

  for (const key of existing) {
    if (key === cleanBase) continue;
    const match = key.match(regex);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }

  return max === 1 && !existing.has(cleanBase)
    ? cleanBase
    : `${cleanBase}_${max + 1}`;
}

/** Id client temporaire */
export function makeClientId() {
  return `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/** Indique si une commande est finale */
export function orderIsFinal(status: OrderStatus) {
  return (
    status === "paid" ||
    status === "failed" ||
    status === "canceled" ||
    status === "expired"
  );
}